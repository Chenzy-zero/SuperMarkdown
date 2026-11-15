const test = require('node:test');
const assert = require('node:assert/strict');
const { documentStats } = require('../src/app/document-stats.mjs');
test('统计空文档、末尾空行、中英文及表情，对 CRLF 与 LF 使用相同口径', () => {
  assert.deepEqual(documentStats(''), { lines: 1, characters: 0 });
  assert.deepEqual(documentStats('中文🙂\r\nabc\r\n'), { lines: 3, characters: 8 });
  assert.deepEqual(documentStats('中文🙂\nabc\n'), { lines: 3, characters: 8 });
  assert.deepEqual(documentStats('a\rb'), { lines: 2, characters: 3 });
});
