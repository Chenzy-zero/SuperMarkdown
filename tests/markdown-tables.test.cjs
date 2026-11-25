const test = require('node:test');
const assert = require('node:assert/strict');

test('修改普通正文时未编辑的表格按原始字节保留，包含对齐、CRLF 和空格', async () => {
  const { preserveUnchangedTables } = await import('../src/app/markdown-tables.mjs');
  const original = '开头\r\n\r\n| 名称  | 数量 |\r\n| :--- | ---: |\r\n| 苹果 |  3  |\r\n\r\n末尾\r\n';
  const rendered = '开头新增\n\n| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |\n\n末尾\n';
  const kept = preserveUnchangedTables(original, rendered);
  assert.match(kept, /^\u5f00\u5934\u65b0\u589e\n\n/);
  assert.ok(kept.includes('| 名称  | 数量 |\r\n| :--- | ---: |\r\n| 苹果 |  3  |\r\n'));
  assert.ok(kept.includes('末尾\n'));
});

test('可视表格单元格编辑后保留新内容，不以旧表格覆盖', async () => {
  const { preserveUnchangedTables } = await import('../src/app/markdown-tables.mjs');
  const oldText = '| 名 | 数 |\n| --- | ---: |\n| 甲 | 1 |\n';
  const edited = '| 名 | 数 |\n| --- | ---: |\n| 甲 | 2 |\n';
  assert.equal(preserveUnchangedTables(oldText, edited), edited);
  const added = '| 名 | 数 |\n| --- | ---: |\n| 甲 | 1 |\n| 乙 | 2 |\n';
  assert.equal(preserveUnchangedTables(oldText, added), added);
  const deleted = '| 名 | 数 |\n| --- | ---: |\n';
  assert.equal(preserveUnchangedTables(oldText, deleted), deleted);
});

test('两个表格只还原未变的那一个；表格增删或列数变化不错误套用旧内容', async () => {
  const { preserveUnchangedTables, pipeTableBlocks } = await import('../src/app/markdown-tables.mjs');
  const oldText = '| A | B |\n| --- | --- |\n| x | y |\n\n| 名 | 分 |\n| --- | ---: |\n| 甲 | 1 |\n';
  const edited = '| A| B|\n|---|---|\n|x|y|\n\n| 名 | 分 |\n| --- | ---: |\n| 甲 | 2 |\n';
  const preserved = preserveUnchangedTables(oldText, edited);
  assert.ok(preserved.startsWith('| A | B |\n| --- | --- |\n| x | y |\n'));
  assert.ok(preserved.includes('| 甲 | 2 |'));
  const another = edited + '\n| 新 | 表 |\n| --- | --- |\n';
  assert.equal(preserveUnchangedTables(oldText, another), another);
  assert.equal(pipeTableBlocks(oldText).length, 2);
});

test('代码围栏中的伪表格不会被当作 Markdown 表格替换', async () => {
  const { pipeTableBlocks, preserveUnchangedTables } = await import('../src/app/markdown-tables.mjs');
  const raw = ['~~~text', '| 表 | 格 |', '| --- | --- |', '| X | Y |', '~~~',
    '', '| 真 | 表 |', '| --- | --- |', '| a | b |', ''].join('\n');
  const tables = pipeTableBlocks(raw);
  assert.equal(tables.length, 1);
  assert.match(tables[0].raw, /真/);
  const changed = raw.replace('| X | Y |', '| X | Z |');
  assert.equal(preserveUnchangedTables(raw, changed), changed);
});

test('重复表格单元格中转义竖线不错误拆列', async () => {
  const { pipeTableBlocks } = await import('../src/app/markdown-tables.mjs');
  const md = '| 标题 | 值 |\n| --- | --- |\n| 文字\\|保留 | 2 |\n';
  assert.equal(pipeTableBlocks(md).length, 1);
  assert.equal(JSON.parse(pipeTableBlocks(md)[0].signature).rows[0].length, 2);
});
