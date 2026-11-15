const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const entry = process.argv[2] ? [] : [path.join(root, 'src/app/main.cjs')];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, limit = 5000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { try { if (await action()) return true; } catch {} await sleep(80); }
  return false;
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function connect(port) {
  let page;
  if (!await until(async () => { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page'); return page?.webSocketDebuggerUrl; }, 12000)) throw new Error('无法连接隔离测试窗口。');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map();
  socket.onclose = () => { for (const request of pending.values()) request.reject(new Error('测试窗口已关闭。')); pending.clear(); };
  socket.onmessage = event => {
    const result = JSON.parse(event.data); if (!result.id) return;
    const request = pending.get(result.id); pending.delete(result.id);
    if (result.error || result.result?.exceptionDetails) request?.reject(new Error(JSON.stringify(result.error || result.result.exceptionDetails)));
    else request?.resolve(result.result?.result?.value);
  };
  return { close: () => socket.close(), evaluate: expression => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  }) };
}

(async () => {
  const parent = path.join(root, '.prototype-artifacts'); await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'file-opening-'));
  const fixtures = path.join(directory, '中文 空格目录'); await fs.mkdir(fixtures);
  const first = path.join(fixtures, '首个 文档.md'), second = path.join(fixtures, '第二个 文档.MD');
  await fs.writeFile(first, '# 首个文件标题\n\n首个文件正文。\n');
  await fs.writeFile(second, '# 第二个文件标题\n\n第二个文件正文。\n');
  const profile = path.join(directory, 'profile'), port = await freePort();
  const args = [...entry, `--user-data-dir=${profile}`, '--file-opening-check'];
  const child = spawn(executable, [...args, `--remote-debugging-port=${port}`, first], { env, cwd: fixtures, windowsHide: true, stdio: 'ignore' });
  let client, restarted; const checks = [], check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  try {
    client = await connect(port);
    const visibleHeading = title => client.evaluate(`document.querySelector('#rich:not([hidden]) h1')?.textContent === ${JSON.stringify(title)}`);
    check('冷启动接收中文及空格文件路径，并显示实际 Markdown 内容', await until(() => visibleHeading('首个文件标题')));
    await client.evaluate(`(() => {
      if (!document.querySelector('#tabs .tab-select')) document.getElementById('new-document').click();
      document.getElementById('source-mode').click();
      const source = document.getElementById('source'); source.value = '# 首个文件标题\\n\\n未保存的正在编辑内容';
      source.dispatchEvent(new InputEvent('input', { bubbles: true }));
    })()`);
    const launch = file => new Promise((resolve, reject) => {
      const other = spawn(executable, [...args, file], { env, cwd: fixtures, windowsHide: true, stdio: 'ignore' });
      other.on('error', reject); other.on('exit', resolve);
      setTimeout(() => { if (other.exitCode === null) { other.kill(); reject(new Error('第二个进程未转交给已打开窗口。')); } }, 8000).unref();
    });
    await launch(path.basename(second));
    check('已运行时第二个进程转交相对路径并打开第二篇文档', await until(() => visibleHeading('第二个文件标题')));
    await launch(first);
    check('重复打开同一文件复用标签页并保留未保存内容', await until(() => client.evaluate(`document.querySelectorAll('#tabs .document-tab').length === 2 && document.getElementById('source').value.includes('未保存的正在编辑内容') && !document.getElementById('source').hidden`)));
    check('从系统打开文件不会写回未保存的内容', (await fs.readFile(first, 'utf8')) === '# 首个文件标题\n\n首个文件正文。\n');
    await launch(path.join(fixtures, '已删除 文件.md'));
    check('系统请求的文件不存在时保留当前文档并显示错误', await until(() => client.evaluate(`document.querySelectorAll('#tabs .document-tab').length === 2 && document.getElementById('status').textContent.includes('已删除 文件.md')`)));
    const savedFile = await client.evaluate(`window.workspaceFiles.inspect(${JSON.stringify(process.platform === 'win32' ? first.toLowerCase() : first)})`);
    await client.evaluate('window.workspaceFiles.writeRecovery([]).then(() => window.workspaceFiles.approveClose())').catch(() => {}); client.close(); client = null;
    if (!await until(() => child.exitCode !== null, 3000)) throw new Error('测试窗口未结束。');
    const draft = { key: savedFile.key, name: savedFile.name, kind: savedFile.kind, file: savedFile,
      savedText: savedFile.content, content: '# 从草稿恢复的未保存内容\n', mode: 'source', lineEnding: '\n' };
    await fs.writeFile(path.join(profile, 'drafts.json'), JSON.stringify({ version: 1, documents: [draft] }));
    const restartPort = await freePort();
    restarted = spawn(executable, [...args, `--remote-debugging-port=${restartPort}`, first], { env, cwd: fixtures, windowsHide: true, stdio: 'ignore' });
    client = await connect(restartPort);
    check('恢复草稿提示期间系统打开请求会等待，不抢占工作区', await until(() => client.evaluate(`document.getElementById('recovery-dialog').open && document.querySelectorAll('#tabs .document-tab').length === 0`)));
    await client.evaluate(`document.getElementById('recovery-restore').click()`);
    check('恢复后重复打开文件保留草稿内容并只显示一个标签页', await until(() => client.evaluate(`document.querySelectorAll('#tabs .document-tab').length === 1 && !document.getElementById('source').hidden && document.getElementById('source').value.includes('从草稿恢复的未保存内容')`)));
    await fs.writeFile(path.join(parent, 'file-opening-report.json'), JSON.stringify({ checks }, null, 2));
    console.log(JSON.stringify({ checks }, null, 2));
    if (!checks.every(item => item.passed)) process.exitCode = 1;
  } finally {
    if (client) { await client.evaluate('window.workspaceFiles.writeRecovery([]).then(() => window.workspaceFiles.approveClose())').catch(() => {}); client.close(); }
    for (const childProcess of [child, restarted].filter(Boolean)) if (!await until(() => childProcess.exitCode !== null, 3000)) childProcess.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
