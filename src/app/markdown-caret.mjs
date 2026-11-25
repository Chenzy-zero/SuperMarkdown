// Best-effort offset mapping between rendered text and source Markdown.
// Use occurrence order, not String#indexOf's first match: two identical
// paragraphs must not always send the cursor to the first paragraph.
// Neither mapper rewrites the Markdown or relies on Vditor's serializer.

function occurrenceCount(text, needle) {
  if (!needle) return 0;
  let count = 0, from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    count++;
    from = index + 1;
  }
  return count;
}

function nthOccurrence(text, needle, rank) {
  if (!needle || rank < 1) return -1;
  let from = 0;
  while (rank-- > 0) {
    const index = text.indexOf(needle, from);
    if (index < 0) return -1;
    if (!rank) return index;
    from = index + 1;
  }
  return -1;
}

function candidates(prefix) {
  // Do not allocate a full-document substring or arrays of every match when a
  // highly repetitive multi-MiB document is edited in rich mode.
  const lengths = [64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
  return [...new Set(lengths.filter(length => length <= prefix.length))]
    .sort((left, right) => right - left)
    .map(length => prefix.slice(-length))
    .filter(token => token.trim());
}

// Markdown offsets are UTF-16 code units and include CRLF's extra CR,
// whereas the CodeMirror source buffer and rendered text use LF.
export function sourceOffsetFromLf(markdown, offset) {
  const target = Math.max(0, offset);
  let original = 0, normalized = 0;
  while (original < markdown.length && normalized < target) {
    if (markdown[original] === '\r' && markdown[original + 1] === '\n') original++;
    original++; normalized++;
  }
  return original;
}

export function lfOffsetFromSource(markdown, offset) {
  return markdown.slice(0, Math.max(0, Math.min(offset, markdown.length)))
    .replace(/\r\n?/g, '\n').length;
}

// The prefix must be the DOM Range's visible text through selection.focus,
// not a slice of root.textContent; Range includes virtual block separators.
export function visualCaretToSource(markdown, visiblePrefix, previousOffset = 0) {
  const source = String(markdown);
  const normalized = source.replace(/\r\n?/g, '\n');
  const prefix = String(visiblePrefix || '').replace(/\r\n?/g, '\n');
  if (!prefix) return 0;

  for (const token of candidates(prefix)) {
    const seen = occurrenceCount(prefix, token);
    const at = nthOccurrence(normalized, token, seen);
    if (at >= 0) return sourceOffsetFromLf(source, at + token.length);
  }
  return Math.max(0, Math.min(source.length, previousOffset));
}

export function sourceCaretToVisual(markdown, renderedText, sourceOffset) {
  const source = String(markdown).replace(/\r\n?/g, '\n');
  const position = lfOffsetFromSource(String(markdown), sourceOffset);
  const prefix = source.slice(0, position).replace(/[\s*_~)\]]+$/g, '');
  const visible = String(renderedText || '');
  if (!prefix) return 0;

  for (const token of candidates(prefix)) {
    const seen = occurrenceCount(prefix, token);
    const at = nthOccurrence(visible, token, seen);
    if (at >= 0) return at + token.length;
  }
  return Math.max(0, Math.min(visible.length, position));
}

// Read the actual focus endpoint (rather than selection.anchor or a substring
// of textContent). It handles backward selections and preserves block breaks.
export function renderedSelectionPrefix(root, selection) {
  if (!root || !selection?.focusNode || !root.contains(selection.focusNode)) return null;
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return range.toString();
  } catch {
    return null;
  }
}

// Image insertion requires a provable source span, unlike best-effort cursor
// restoration. Accept only text-only paragraphs / ATX headings whose complete
// DOM block sequence exactly matches the source; refuse richer structures.
export function visualDropCaretToSource(markdown, root, selection) {
  if (!root || !selection?.focusNode || !root.contains(selection.focusNode)) return null;
  const source = String(markdown).replace(/\r\n?/g, '\n');
  const blocks = [...source.matchAll(/[^\n]+(?:\n(?![ \t]*\n)[^\n]+)*/g)];
  const nodes = [...root.childNodes].filter(node => node.nodeType !== 3 || node.textContent.trim());
  if (nodes.length !== blocks.length) return null;
  let selected = null;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index], block = blocks[index];
    const heading = /^(#{1,6}) ([^\n]*)$/.exec(block[0]);
    const expectedTag = heading ? 'H' + heading[1].length : 'P';
    const prefixLength = heading ? heading[1].length + 1 : 0;
    const text = heading ? heading[2] : block[0];
    if (node.nodeType !== 1 || node.tagName !== expectedTag
      || [...node.childNodes].some(child => child.nodeType !== 3)
      || node.textContent !== text) return null;
    if (node === selection.focusNode || node.contains(selection.focusNode)) {
      const prefix = renderedSelectionPrefix(node, selection);
      if (prefix === null || !text.startsWith(prefix)) return null;
      selected = block.index + prefixLength + prefix.length;
    }
  }
  return selected === null ? null : sourceOffsetFromLf(String(markdown), selected);
}
