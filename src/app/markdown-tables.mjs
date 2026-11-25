// Preserve original pipe-table formatting when unrelated rich-text edits
// cause Vditor to reserialize a table without changing its contents.
// Actual table edits are kept; source-mode edits do not call this helper.

function linesOf(markdown) {
  return [...String(markdown).matchAll(/[^\n]*(?:\n|$)/g)]
    .filter(match => match[0])
    .map(match => ({
      line: match[0].replace(/\r?\n$/, ''),
      start: match.index, end: match.index + match[0].length,
    }));
}

function tableCells(line) {
  const text = String(line).trim();
  if (!text.includes('|')) return null;
  const outer = text.startsWith('|') ? text.slice(1) : text;
  const cells = [];
  let cell = '', pipes = 0;
  for (let i = 0; i < outer.length; i++) {
    const char = outer[i];
    if (char !== '|') { cell += char; continue; }
    let slashes = 0;
    for (let j = i - 1; j >= 0 && outer[j] === '\\'; j--) slashes++;
    if (slashes % 2) { cell += char; continue; }
    pipes++;
    cells.push(cell.trim());
    cell = '';
  }
  if (cell.trim() || !outer.endsWith('|')) cells.push(cell.trim());
  return pipes || text.startsWith('|') ? cells : null;
}

function delimiterCells(line) {
  const cells = tableCells(line);
  if (!cells?.length || !cells.every(value => /^:?-{3,}:?$/.test(value))) return null;
  return cells.map(value => {
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none';
  });
}

export function pipeTableBlocks(markdown) {
  const lines = linesOf(markdown);
  const blocks = [];
  let fence = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    const fenceOpen = lines[i].line.match(/^ {0,3}([\x60]{3,}|~{3,})[^\r\n]*$/);
    if (fence) {
      if (new RegExp('^ {0,3}' + fence[0] + '{' + fence[1] + ',}\\s*$')
        .test(lines[i].line)) fence = null;
      continue;
    }
    if (fenceOpen) {
      fence = [fenceOpen[1][0], fenceOpen[1].length];
      continue;
    }
    const header = tableCells(lines[i].line);
    const aligns = delimiterCells(lines[i + 1].line);
    if (!header?.length || !aligns || header.length !== aligns.length) continue;
    const rows = [];
    let end = i + 2;
    while (end < lines.length) {
      const cells = tableCells(lines[end].line);
      if (!cells || cells.length !== header.length) break;
      rows.push(cells);
      end++;
    }
    const first = lines[i].start, last = lines[end - 1].end;
    blocks.push({
      start: first, end: last, raw: markdown.slice(first, last),
      signature: JSON.stringify({ header, aligns, rows }),
    });
    i = end - 1;
  }
  return blocks;
}

export function preserveUnchangedTables(previous, rendered) {
  const before = pipeTableBlocks(previous);
  const after = pipeTableBlocks(rendered);
  if (before.length !== after.length) return rendered;
  let result = rendered;
  for (let i = after.length - 1; i >= 0; i--) {
    if (before[i].signature !== after[i].signature) continue;
    result = result.slice(0, after[i].start) + before[i].raw + result.slice(after[i].end);
  }
  return result;
}
