const test = require('node:test');
const assert = require('node:assert/strict');

test('当前文件查找：中文、重复内容、字面量元字符与大小写', async () => {
  const { findMatches } = await import('../src/app/find-matches.mjs');
  assert.deepEqual(findMatches('中文 abC 中文 ABC', '中文'), [{ from: 0, to: 2 }, { from: 7, to: 9 }]);
  assert.deepEqual(findMatches('a.B a[B a.B', 'a.B'), [{ from: 0, to: 3 }, { from: 8, to: 11 }]);
  assert.deepEqual(findMatches('abc ABC AbC', 'abc').map(m => m.from), [0, 4, 8]);
  assert.deepEqual(findMatches('abc ABC AbC', 'abc', { caseSensitive: true }).map(m => m.from), [0]);
});

test('当前文件查找：CRLF、换行和非 BMP 字符保留准确偏移', async () => {
  const { findMatches } = await import('../src/app/find-matches.mjs');
  assert.deepEqual(findMatches('🙂a\r\n🙂a', '🙂a'), [{ from: 0, to: 3 }, { from: 5, to: 8 }]);
  assert.deepEqual(findMatches('a\nb\nc', '\nb'), [{ from: 1, to: 3 }]);
  assert.deepEqual(findMatches('aaaa', 'aa'), [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
});

test('当前文件查找：空查询和限制保护（1 MiB 文本）', async () => {
  const { findMatches } = await import('../src/app/find-matches.mjs');
  assert.deepEqual(findMatches('', 'test'), []);
  assert.deepEqual(findMatches('abc', ''), []);
  assert.deepEqual(findMatches('abc', 'a'.repeat(257)), []);
  const large = 'a'.repeat(1024 * 1024);
  const result = findMatches(large, 'a', { limit: 250 });
  assert.equal(result.length, 250);
  assert.deepEqual(result[249], { from: 249, to: 250 });
});
