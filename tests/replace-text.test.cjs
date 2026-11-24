const test = require('node:test');
const assert = require('node:assert/strict');

test('单次替换：字面量内容、UTF-16 光标偏移、空字符串与边界拒绝', async () => {
  const { replaceAt } = await import('../src/app/replace-text.mjs');
  assert.deepEqual(replaceAt('a🙂b', { from: 1, to: 3 }, '中文'), {
    text: 'a中文b', count: 1, caret: 3,
  });
  assert.deepEqual(replaceAt('ababa', { from: 0, to: 3 }, ''), {
    text: 'ba', count: 1, caret: 0,
  });
  assert.throws(() => replaceAt('abc', { from: 1, to: 9 }, 'x'), /位置无效/);
  assert.throws(() => replaceAt('abc', { from: -1, to: 2 }, 'x'), /位置无效/);
});

test('全部替换：不解释正则符号或 $& 等替换表达式，尊重大小写', async () => {
  const { replaceAllLiteral } = await import('../src/app/replace-text.mjs');
  assert.deepEqual(replaceAllLiteral('a.b A.B a.b', 'a.b', '$&'), {
    text: '$& $& $&', count: 3, caret: 8,
  });
  const sensitive = replaceAllLiteral('abc ABC abc', 'abc', '*', { caseSensitive: true });
  assert.deepEqual(sensitive, { text: '* ABC *', count: 2, caret: 7 });
  const deleted = replaceAllLiteral('a b a', 'a', '');
  assert.deepEqual(deleted, { text: ' b ', count: 2, caret: 3 });
});

test('全部替换：Unicode/CRLF 与上限保护，不允许悄悄只修改前 2000 项', async () => {
  const { replaceAllLiteral } = await import('../src/app/replace-text.mjs');
  assert.deepEqual(replaceAllLiteral('🙂x\r\n🙂x', '🙂x', '中文').text, '中文\r\n中文');
  assert.deepEqual(replaceAllLiteral('foo', '', 'x'), { text: 'foo', count: 0, caret: 0 });
  assert.deepEqual(replaceAllLiteral('foo', 'missing', 'x'), { text: 'foo', count: 0, caret: 0 });
  assert.throws(() => replaceAllLiteral('a'.repeat(2001), 'a', 'b'), /超过 2000 处/);
  assert.equal(replaceAllLiteral('a'.repeat(2000), 'a', 'b').text, 'b'.repeat(2000));
});

test('全部替换作为一次独立撤销记录，撤销/重做不破坏之前的输入历史', async () => {
  const { DocumentHistory } = await import('../src/app/history.mjs');
  const { replaceAllLiteral } = await import('../src/app/replace-text.mjs');
  const history = new DocumentHistory('alpha alpha');
  history.record('alpha alpha!', 12, 'source');
  history.closeGroup();
  const result = replaceAllLiteral(history.current.markdown, 'alpha', 'beta');
  history.record(result.text, result.caret, null);
  history.closeGroup();
  assert.equal(history.current.markdown, 'beta beta!');
  assert.equal(history.undo().markdown, 'alpha alpha!');
  assert.equal(history.undo().markdown, 'alpha alpha');
  assert.equal(history.redo().markdown, 'alpha alpha!');
  assert.equal(history.redo().markdown, 'beta beta!');
});
