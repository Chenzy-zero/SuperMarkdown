const test = require('node:test');
const assert = require('node:assert/strict');

test('可视光标重复段落定位到第 N 次出现，而不是第一个匹配', async () => {
  const { visualCaretToSource, sourceCaretToVisual } = await import('../src/app/markdown-caret.mjs');
  const markdown = '重复词\n\n重复词\n\n重复词';
  const rendered = '重复词重复词重复词';
  assert.equal(visualCaretToSource(markdown, '重复词'), '重复词'.length);
  assert.equal(visualCaretToSource(markdown, '重复词重复词'), '重复词\n\n重复词'.length);
  assert.equal(visualCaretToSource(markdown, rendered), markdown.length);
  assert.equal(sourceCaretToVisual(markdown, rendered, markdown.length), rendered.length);
  assert.equal(sourceCaretToVisual(markdown, rendered, '重复词\n\n重复词'.length), '重复词重复词'.length);
});

test('中文与非 BMP 字符使用 UTF-16 偏移，源码 CRLF 与可视 LF 映射稳定', async () => {
  const { visualCaretToSource, sourceCaretToVisual, sourceOffsetFromLf, lfOffsetFromSource } =
    await import('../src/app/markdown-caret.mjs');
  const markdown = '中文🙂\r\n\r\n中文🙂';
  const rendered = '中文🙂中文🙂';
  assert.equal(visualCaretToSource(markdown, rendered), markdown.length);
  assert.equal(sourceCaretToVisual(markdown, rendered, markdown.length), rendered.length);
  assert.equal(sourceOffsetFromLf(markdown, '中文🙂\n\n'.length), '中文🙂\r\n\r\n'.length);
  assert.equal(lfOffsetFromSource(markdown, markdown.length), '中文🙂\n\n中文🙂'.length);
});

test('标题和重复链接文字跨模式定位不固定跳到第一处', async () => {
  const { visualCaretToSource, sourceCaretToVisual } = await import('../src/app/markdown-caret.mjs');
  const markdown = '# 标题\n\n[链接](a.md)\n\n[链接](b.md)';
  const rendered = '标题链接链接';
  const second = markdown.lastIndexOf('链接') + '链接'.length;
  assert.equal(visualCaretToSource(markdown, rendered), second);
  assert.equal(sourceCaretToVisual(markdown, rendered, second), rendered.length);
});

test('映射无法可靠匹配时保留已有合法光标位置，而非跳入其他语法块', async () => {
  const { visualCaretToSource, sourceCaretToVisual } = await import('../src/app/markdown-caret.mjs');
  assert.equal(visualCaretToSource('![](/path)', '不存在', 6), 6);
  assert.equal(visualCaretToSource('![](/path)', '不存在', 999), '![](/path)'.length);
  assert.equal(visualCaretToSource('hello', ''), 0);
  assert.equal(sourceCaretToVisual('hello', '', 3), 0);
});

test('长篇重复段落映射不产生超大匹配数组，仍定位末尾', async () => {
  const { visualCaretToSource, sourceCaretToVisual } = await import('../src/app/markdown-caret.mjs');
  const markdown = Array(5000).fill('重复').join('\n\n');
  const rendered = '重复'.repeat(5000);
  assert.equal(visualCaretToSource(markdown, rendered), markdown.length);
  assert.equal(sourceCaretToVisual(markdown, rendered, markdown.length), rendered.length);
});
