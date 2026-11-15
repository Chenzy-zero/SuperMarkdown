const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../electron-builder.cjs');
const path = require('node:path');
const { pathsFromArguments, FileOpenQueue } = require('../src/app/open-files.cjs');

test('Windows 安装包注册四种 Markdown 扩展名及编辑器名称', () => {
  const associations = config.fileAssociations || config.win.fileAssociations || [];
  const extensions = associations.flatMap(item => Array.isArray(item.ext) ? item.ext : [item.ext]);
  for (const extension of ['md', 'markdown', 'mdown', 'mkd']) assert.ok(extensions.includes(extension), `缺少 ${extension} 文件关联`);
  assert.ok(associations.every(item => item.name && item.description));
});

test('开发启动跳过脚本和成对参数，按启动目录解析中文相对路径', () => {
  const directory = path.resolve('中文 目录');
  assert.deepEqual(pathsFromArguments(['electron', 'src/app/main.cjs', '--user-data-dir', 'profile', '--remote-debugging-port=1234', '文档.md'], directory, false), [path.join(directory, '文档.md')]);
});

test('打包启动保留完整路径与多文件顺序，去除重复参数', () => {
  const first = path.resolve('含 空格.md'), second = path.resolve('第二篇.MD');
  assert.deepEqual(pathsFromArguments(['SuperMarkdown.exe', first, second, first], process.cwd(), true), [first, second]);
});

test('双横线后允许以横线开头的文件名，忽略空值及空字符', () => {
  assert.deepEqual(pathsFromArguments(['app.exe', '', '\0', '--', '-文档.md'], process.cwd(), true), [path.resolve('-文档.md')]);
});

test('就绪前只排队，不读取文件；读取失败不会阻断后续文件', async () => {
  const first = path.resolve('不存在.md'), second = path.resolve('正常.md');
  const read = [], notices = [];
  const queue = new FileOpenQueue(async file => { read.push(file); if (file === first) throw new Error('文件不存在'); return { path: file }; }, () => notices.push(true));
  queue.add([first, second, second]);
  assert.equal(read.length, 0);
  const result = await queue.take();
  assert.equal(result.length, 2);
  assert.match(result[0].error, /不存在/);
  assert.equal(result[1].file.path, second);
  assert.equal(notices.length, 1);
});

test('读取期间新到达的系统文件请求留在下一批，不丢失', async () => {
  const first = path.resolve('第一篇.md'), second = path.resolve('第二篇.md');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new FileOpenQueue(async file => { if (file === first) await gate; return file; }, () => {});
  queue.add([first]); const reading = queue.take(); queue.add([second]); release();
  assert.deepEqual(await reading, [{ file: first }]);
  assert.deepEqual(await queue.take(), [{ file: second }]);
});
