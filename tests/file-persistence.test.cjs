const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkspaceFiles } = require('../src/app/workspace-files.cjs');
const { encodeText, revisionOf, writeAtomic, RecoveryStore } = require('../src/app/file-persistence.cjs');

async function fixture() {
  const parent = path.resolve(__dirname, '../.prototype-artifacts');
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, 'storage-'));
}

test('上级导航列出父目录，不改变已打开文件的保存身份，也拒绝未打开的任意路径', async () => {
  const root = await fixture(), child = path.join(root, '子目录'); await fs.mkdir(child);
  const filename = path.join(child, '正文.md'); await fs.writeFile(filename, '原文');
  await fs.writeFile(path.join(root, '同级.txt'), '父目录文本');
  const workspace = new WorkspaceFiles(); await workspace.openFolder(child);
  const file = await workspace.read('正文.md');
  const parent = await workspace.parentFolder(child);
  assert.equal(parent.path, root); assert.ok(parent.entries.some(entry => entry.name === '同级.txt'));
  await workspace.save(file.key, '继续编辑', file.revision);
  assert.equal(await fs.readFile(filename, 'utf8'), '继续编辑');
  await assert.rejects(workspace.parentFolder(path.dirname(root)), /请先打开/);
});

for (const [encoding, bom] of [['utf-8', false], ['utf-8', true], ['utf-16le', true], ['utf-16be', true], ['gb18030', false]]) {
  test(`保存后重新打开保留中文、编码、BOM 和 CRLF：${encoding}/${bom}`, async () => {
    const root = await fixture(), target = path.join(root, '中文.txt');
    const original = '第一行\r\n**普通文本**\r\n';
    await fs.writeFile(target, encodeText(original, encoding, bom));
    const workspace = new WorkspaceFiles();
    const opened = await workspace.readAbsolute(target);
    const edited = original + '新增中文\r\n';
    const saved = await workspace.save(opened.key, edited, opened.revision);
    const reopened = await new WorkspaceFiles().readAbsolute(target);
    assert.equal(reopened.content, edited);
    assert.equal(saved.revision, reopened.revision);
    assert.equal(reopened.encoding, encoding);
    assert.equal(reopened.bom, bom);
    assert.deepEqual(await fs.readFile(target), encodeText(edited, encoding, bom));
  });
}

test('另存为不修改原文件，并保存为 UTF-8 普通文本', async () => {
  const root = await fixture(), source = path.join(root, '源.js'), destination = path.join(root, '另存.js');
  await fs.writeFile(source, 'const 原文 = 1;\n');
  const workspace = new WorkspaceFiles();
  const saved = await workspace.saveAs(destination, 'const 新内容 = 2;\n', null);
  assert.equal(saved.kind, 'text');
  assert.equal(await fs.readFile(source, 'utf8'), 'const 原文 = 1;\n');
  assert.equal(await fs.readFile(destination, 'utf8'), 'const 新内容 = 2;\n');
});

test('检测外部修改且不覆盖磁盘文件，包含同长度修改', async () => {
  const root = await fixture(), target = path.join(root, '文档.md');
  await fs.writeFile(target, 'initial');
  const workspace = new WorkspaceFiles(), opened = await workspace.readAbsolute(target);
  await fs.writeFile(target, 'outside');
  await assert.rejects(workspace.save(opened.key, 'my edits', opened.revision), { code: 'FILE_CONFLICT' });
  assert.equal(await fs.readFile(target, 'utf8'), 'outside');
  assert.equal((await workspace.inspect(opened.key)).content, 'outside');
});

test('原文件删除后保存不会擅自重建', async () => {
  const root = await fixture(), target = path.join(root, '删除.md');
  await fs.writeFile(target, 'original');
  const workspace = new WorkspaceFiles(), opened = await workspace.readAbsolute(target);
  await fs.unlink(target);
  await assert.rejects(workspace.save(opened.key, 'retained', opened.revision), { code: 'FILE_MISSING' });
  assert.deepEqual(await workspace.inspect(opened.key), { missing: true });
});

test('同时保存使用同一基线时只允许一份写入，临时文件不残留', async () => {
  const root = await fixture(), target = path.join(root, '并发.md');
  await fs.writeFile(target, 'base');
  const revision = revisionOf(Buffer.from('base'));
  const results = await Promise.allSettled([writeAtomic(target, Buffer.from('first'), revision), writeAtomic(target, Buffer.from('second'), revision)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'FILE_CONFLICT');
  assert.deepEqual(await fs.readdir(root), ['并发.md']);
});

test('无效编码内容在写入前被拒绝，原文件完整', async () => {
  const root = await fixture(), target = path.join(root, '字符.txt');
  await fs.writeFile(target, 'original');
  const workspace = new WorkspaceFiles(), opened = await workspace.readAbsolute(target);
  await assert.rejects(workspace.save(opened.key, '\uD800', opened.revision), /无法完整保存/);
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});

test('临时文件创建失败时不会截断目标文件', async () => {
  const root = await fixture(), target = path.join(root, 'x'.repeat(220) + '.md');
  await fs.writeFile(target, 'original');
  await assert.rejects(writeAtomic(target, Buffer.from('modified'), revisionOf(Buffer.from('original'))));
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
});

test('恢复草稿跨存储实例保留有名、未命名文档及保存基线', async () => {
  const root = await fixture();
  const entries = [{ key: 'untitled:1', name: '未命名.md', content: '# 新内容', savedText: '', kind: 'markdown', file: null },
    { key: 'saved', name: '文件.md', content: '修改', savedText: '原文', kind: 'markdown', file: { path: 'document.md', revision: 'old' } }];
  await new RecoveryStore(root).write(entries);
  assert.deepEqual(await new RecoveryStore(root).read(), entries);
  await new RecoveryStore(root).write([]);
  assert.deepEqual(await new RecoveryStore(root).read(), []);
});

test('连续草稿快照按顺序提交，最后一份可恢复', async () => {
  const root = await fixture(), store = new RecoveryStore(root);
  const entry = { key: 'a', name: 'a.md', savedText: '' };
  await Promise.all([store.write([{ ...entry, content: 'one' }]), store.write([{ ...entry, content: 'two' }])]);
  assert.equal((await new RecoveryStore(root).read())[0].content, 'two');
});

test('损坏的恢复文件不会被静默清空', async () => {
  const root = await fixture(), store = new RecoveryStore(root);
  await fs.writeFile(store.path, '{broken');
  await assert.rejects(store.read());
  assert.equal(await fs.readFile(store.path, 'utf8'), '{broken');
});

test('切换文件夹后按明确目录读取同名文件，不串到新目录', async () => {
  const root = await fixture(), first = path.join(root, '目录一'), second = path.join(root, '目录二');
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.writeFile(path.join(first, '同名.md'), '第一篇');
  await fs.writeFile(path.join(second, '同名.md'), '第二篇');
  const workspace = new WorkspaceFiles();
  const left = await workspace.openFolder(first), right = await workspace.openFolder(second);
  assert.equal((await workspace.read('同名.md', left.path)).content, '第一篇');
  assert.equal((await workspace.read('同名.md', right.path)).content, '第二篇');
  const created = await workspace.createMarkdown('', '明确目录', left.path);
  assert.equal(created.path, path.join(first, '明确目录.md'));
  await assert.rejects(fs.stat(path.join(second, '明确目录.md')), { code: 'ENOENT' });
});

test('目录上下文只允许已经打开的目录，仍拒绝越界读取', async () => {
  const root = await fixture(), first = path.join(root, '允许'), other = path.join(root, '未打开');
  await fs.mkdir(first); await fs.mkdir(other);
  await fs.writeFile(path.join(other, '文档.md'), '不能读取');
  const workspace = new WorkspaceFiles(); await workspace.openFolder(first);
  await assert.rejects(workspace.read('文档.md', other), /请先打开这个文件夹/);
  await assert.rejects(workspace.read('../未打开/文档.md', first), /当前文件夹/);
});

test('定位外部打开文件的父目录后，保存仍使用该目录的文件身份', async () => {
  const root = await fixture(), target = path.join(root, '文档.md'); await fs.writeFile(target, '原文');
  const workspace = new WorkspaceFiles(), file = await workspace.readAbsolute(target);
  const folder = await workspace.folderForFile(file.key);
  assert.equal(folder.path, root); assert.ok(folder.entries.some(entry => entry.id === '文档.md'));
  const saved = await workspace.save(file.key, '修改', file.revision);
  assert.equal(saved.root, root); assert.equal(saved.id, '文档.md');
});

test('焦点目录读取不改变其他进行中文件操作的默认目录', async () => {
  const root = await fixture(), first = path.join(root, '焦点目录'), second = path.join(root, '已选目录');
  await fs.mkdir(first); await fs.mkdir(second);
  await fs.writeFile(path.join(first, '文件.md'), '内容');
  const workspace = new WorkspaceFiles(); await workspace.openFolder(second);
  const file = await workspace.readAbsolute(path.join(first, '文件.md'));
  assert.equal(file.directory, first);
  const folder = await workspace.folderForFile(file.key, false);
  assert.equal(folder.path, first); assert.equal(workspace.root, second);
  assert.equal((await workspace.read('文件.md', first)).content, '内容');
});
