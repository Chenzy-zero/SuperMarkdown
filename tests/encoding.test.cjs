const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkspaceFiles } = require('../src/app/workspace-files.cjs');
const { encodeText } = require('../src/app/file-persistence.cjs');
const formats = require('../src/app/encoding-formats.json');
async function fixture() {
  const root = path.resolve(__dirname, '../.prototype-artifacts'); await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'encoding-'));
}
for (const format of formats) test(`显式转换 ${format.label} 后保存、检查和再次编辑保持内容、BOM 与编码`, async () => {
  const root = await fixture(), filename = path.join(root, '文档.txt');
  await fs.writeFile(filename, 'original');
  const workspace = new WorkspaceFiles(), file = await workspace.readAbsolute(filename);
  const text = format.encoding === 'ascii' ? 'hello\r\nworld' : format.encoding === 'big5' ? '繁體中文\r\n資料' :
    ['latin1', 'windows-1252'].includes(format.encoding) ? 'café ÿ\r\n' : '中文\r\n内容';
  const saved = await workspace.save(file.key, text, file.revision, format);
  assert.equal(saved.content, text); assert.equal(saved.encoding, format.encoding); assert.equal(saved.bom, format.bom);
  assert.deepEqual(await fs.readFile(filename), encodeText(text, format.encoding, format.bom));
  assert.equal((await workspace.inspect(saved.key)).content, text);
  const again = await workspace.save(saved.key, text + '!', saved.revision);
  assert.equal(again.encoding, format.encoding); assert.equal(again.content, text + '!');
});
test('ASCII 和 Latin-1 无法编码中文时不写入文件，也不改变其保存编码', async () => {
  const root = await fixture(), filename = path.join(root, '中文.md'); await fs.writeFile(filename, '中文🙂');
  const workspace = new WorkspaceFiles(), file = await workspace.readAbsolute(filename);
  for (const encoding of ['ascii', 'latin1']) await assert.rejects(workspace.save(file.key, file.content, file.revision, { encoding, bom: false }), /无法完整保存/);
  assert.equal(await fs.readFile(filename, 'utf8'), '中文🙂'); assert.equal(workspace.knownFile(file.key).encoding, 'utf-8');
});
test('按 Latin-1 重新读取只改变解释方式，不改写原始字节；失败的 UTF-8 读取保留已选编码', async () => {
  const root = await fixture(), filename = path.join(root, 'western.txt'); const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]); await fs.writeFile(filename, bytes);
  const workspace = new WorkspaceFiles(), file = await workspace.readAbsolute(filename);
  const reread = await workspace.reloadEncoding(file.key, 'latin1'); assert.equal(reread.content, 'café');
  assert.deepEqual(await fs.readFile(filename), bytes);
  await assert.rejects(workspace.reloadEncoding(file.key, 'utf-8'), /无法完整读取/);
  assert.equal(workspace.knownFile(file.key).selectedEncoding, 'latin1');
});
test('编码转换同样检测磁盘冲突，不覆盖外部修改', async () => {
  const root = await fixture(), filename = path.join(root, 'conflict.md'); await fs.writeFile(filename, 'original');
  const workspace = new WorkspaceFiles(), file = await workspace.readAbsolute(filename); await fs.writeFile(filename, 'external');
  await assert.rejects(workspace.save(file.key, 'converted', file.revision, formats[2]), { code: 'FILE_CONFLICT' });
  assert.equal(await fs.readFile(filename, 'utf8'), 'external');
});
