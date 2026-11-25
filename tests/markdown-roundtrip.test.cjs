const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const load = filename => readFileSync(join(__dirname, 'fixtures', filename), 'utf8');

test('回归语料覆盖嵌套列表、表格、引用、链接、中文、代码、Mermaid、LaTeX 与脚注', async () => {
  const markdown = load('markdown-roundtrip.md');
  assert.ok(markdown.includes('第二层'));
  assert.ok(markdown.includes('| :--- | ---: | :---: |'));
  assert.ok(markdown.includes('> 引用的第一行'));
  assert.ok(markdown.includes('[链接]('));
  assert.ok(markdown.includes('🙂'));
  assert.ok(markdown.includes('~~~js'));
  assert.ok(markdown.includes('~~~mermaid'));
  assert.ok(markdown.includes('$$'));
  assert.ok(markdown.includes('[^1]:'));
  const { protectedBlocks } = await import('../src/app/protected-blocks.mjs');
  const { pipeTableBlocks } = await import('../src/app/markdown-tables.mjs');
  assert.deepEqual(protectedBlocks(markdown).map(block => block.key.split('\n')[0]), ['mermaid', 'math']);
  assert.equal(pipeTableBlocks(markdown).length, 1, '围栏中的伪表格不应算真实表格');
});

test('只浏览与切换模式不写入任何历史快照，也不会规范化 LF/CRLF 原文', async () => {
  const { DocumentHistory } = await import('../src/app/history.mjs');
  for (const filename of ['markdown-roundtrip.md', 'markdown-roundtrip-crlf.md']) {
    const markdown = load(filename);
    const history = new DocumentHistory(markdown);
    const savedText = markdown;
    history.closeGroup(); // view -> source
    history.closeGroup(); // source -> view
    const changed = history.record(markdown, markdown.length, 'source');
    assert.equal(changed, false);
    assert.equal(history.current.markdown, savedText);
    assert.equal(history.canUndo, false);
    assert.equal(history.canRedo, false);
  }
  const crlf = load('markdown-roundtrip-crlf.md');
  assert.ok(crlf.includes('\r\n'));
  assert.ok(!/(?<!\r)\n/.test(crlf));
});

test('普通正文编辑仍原样保留 Mermaid 与 LaTeX 围栏、行尾两个空格', async () => {
  const { protectedBlocks, preserveProtectedBlocks } = await import('../src/app/protected-blocks.mjs');
  const original = load('markdown-roundtrip.md');
  const before = protectedBlocks(original);
  const normalized = original.replace('重复词 **强调**', '新增正文 **强调**')
    .replace('A[开始] --> B[完成]  ', 'A[开始] --> B[完成]')
    .replace('\\frac{a}{b} = \\sqrt{x}  ', '\\frac{a}{b} = \\sqrt{x}');
  const restored = preserveProtectedBlocks(original, normalized);
  for (const block of before) assert.ok(restored.includes(block.raw));
  assert.ok(restored.includes('新增正文'));
  assert.throws(() => preserveProtectedBlocks(original, original.replace('flowchart LR', 'flowchart TB')),
    /源码模式/);
});

test('可视编辑修改普通段落后不应顺带重写未编辑的原始表格', async () => {
  const { preserveUnchangedTables } = await import('../src/app/markdown-tables.mjs');
  const original = load('markdown-roundtrip-crlf.md');
  const rendered = original.replace(/\r\n/g, '\n')
    .replace('中文🙂 CRLF 保留', '中文🙂 CRLF 增补')
    .replace('| 左 | 右 |', '|左|右|')
    .replace('| :--- | ---: |', '|:---|---:|');
  const restored = preserveUnchangedTables(original, rendered);
  assert.ok(restored.includes('| 左 | 右 |\r\n| :--- | ---: |\r\n| 一 | 二 |\r\n'));
  assert.ok(restored.includes('中文🙂 CRLF 增补'));
  assert.ok(!restored.includes('|左|右|'));
});

test('模式切换关闭 Undo 合并组，不会将可视和源码的两次编辑压成一次', async () => {
  const { DocumentHistory } = await import('../src/app/history.mjs');
  const base = '# 标题\n\n原文\n';
  const history = new DocumentHistory(base);
  history.record('# 标题\n\n新正文\n', 10, 'visual');
  history.closeGroup(); // switch mode
  history.record('# 标题\n\n新正文\n\n源码追加\n', 14, 'source');
  history.closeGroup(); // switch back
  assert.equal(history.undo().markdown, '# 标题\n\n新正文\n');
  assert.equal(history.undo().markdown, base);
  assert.equal(history.redo().markdown, '# 标题\n\n新正文\n');
  assert.equal(history.redo().markdown, '# 标题\n\n新正文\n\n源码追加\n');
});
