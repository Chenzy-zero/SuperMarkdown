// 原型验证边界：顶层 Mermaid 围栏与独占行 $$ 公式。
// 普通代码块内的示例文本不作为公式处理；嵌套块及其他扩展语法待验证。
export function protectedBlocks(markdown) {
  const lines = [...markdown.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter(match => match[0].length)
    .map(match => ({ text: match[0].replace(/\r?\n$/, ''), start: match.index }));
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].text.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
    const math = /^ {0,3}\$\$\s*$/.test(lines[i].text);
    if (!fence && !math) continue;
    const delimiter = fence?.[1];
    const language = fence?.[2].trim();
    const endPattern = fence
      ? new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}\\s*$`)
      : /^ {0,3}\$\$\s*$/;
    let end = i + 1;
    while (end < lines.length && !endPattern.test(lines[end].text)) end++;
    if (end === lines.length) break;
    if (math || language === 'mermaid') {
      const startOffset = lines[i].start;
      const endOffset = lines[end].start + lines[end].text.length;
      const body = lines.slice(i + 1, end).map(line => line.text.trimEnd()).join('\n');
      blocks.push({
        start: startOffset, end: endOffset,
        raw: markdown.slice(startOffset, endOffset),
        key: `${math ? 'math' : 'mermaid'}\n${body}`,
      });
    }
    i = end;
  }
  return blocks;
}

export function preserveProtectedBlocks(previous, rendered) {
  const before = protectedBlocks(previous);
  const after = protectedBlocks(rendered);
  if (before.length !== after.length || before.some((block, i) => block.key !== after[i].key)) {
    throw new Error('公式或流程图内容请在源码模式中修改。');
  }
  let result = rendered;
  for (let i = after.length - 1; i >= 0; i--) {
    result = result.slice(0, after[i].start) + before[i].raw + result.slice(after[i].end);
  }
  return result;
}
