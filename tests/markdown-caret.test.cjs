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

function plainDropDom(blocks, focusIndex, focusOffset) {
  const nodes = blocks.map(([tagName, textContent, rich = false]) => {
    const text = { nodeType: rich ? 1 : 3, textContent };
    const node = { nodeType: 1, tagName, textContent, childNodes: [text],
      contains: item => item === text,
      ownerDocument: { createRange: () => ({
        selectNodeContents() {}, setEnd(_node, offset) { this.offset = offset; },
        toString() { return textContent.slice(0, this.offset); },
      }) },
    };
    return node;
  });
  const root = { childNodes: nodes, contains: node => nodes.some(item => item === node || item.contains(node)) };
  return { root, selection: { focusNode: nodes[focusIndex].childNodes[0], focusOffset } };
}

test('visual image drops map repeated plain blocks and CRLF by exact DOM/source spans', async () => {
  const { visualDropCaretToSource } = await import('../src/app/markdown-caret.mjs');
  const word = 'abcdefghijklmnopqrstuvwx';
  const markdown = word + '\r\n\r\n' + word;
  const { root, selection } = plainDropDom([['P', word], ['P', word]], 1, word.length);
  assert.equal(visualDropCaretToSource(markdown, root, selection), markdown.length);
  const heading = plainDropDom([['H1', 'hello'], ['P', 'world']], 1, 5);
  assert.equal(visualDropCaretToSource('# hello\r\n\r\nworld', heading.root, heading.selection), '# hello\r\n\r\nworld'.length);
});

test('visual image drops refuse hidden URLs, rich text, and unmatched source blocks', async () => {
  const { visualDropCaretToSource } = await import('../src/app/markdown-caret.mjs');
  const word = 'abcdefghijklmnopqrstuvwx';
  for (const markdown of [
    `[${word}](${word})\n\n${word}`,
    `[${word}](${word})\n\nabcdefghijkl**mnop**qrstuvwx`,
  ]) {
    const { root, selection } = plainDropDom([['P', word, true], ['P', word]], 1, word.length);
    assert.equal(visualDropCaretToSource(markdown, root, selection), null);
  }
  const mismatch = plainDropDom([['P', 'hello'], ['P', 'world']], 1, 5);
  assert.equal(visualDropCaretToSource('hello\nworld', mismatch.root, mismatch.selection), null);
});
