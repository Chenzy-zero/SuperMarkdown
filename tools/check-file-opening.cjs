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
    else request?.resolve(result.result);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { close: () => socket.close(), send, evaluate: expression => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then(result => result.result?.value) };
}

(async () => {
  const parent = path.join(root, '.prototype-artifacts'); await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'file-opening-'));
  const fixtures = path.join(directory, '中文 空格目录'); await fs.mkdir(fixtures);
  const first = path.join(fixtures, '首个 文档.md'), second = path.join(fixtures, '第二个 文档.MD');
  await fs.writeFile(first, '# 首个文件标题\n\n首个文件正文。\n');
  await fs.writeFile(second, '# 第二个文件标题\n\n第二个文件正文。\n');
  await fs.writeFile(path.join(fixtures, '同级说明.txt'), '同级文本文件原样打开。\n');
  await fs.writeFile(path.join(fixtures, '同级代码.js'), 'const sibling = true;\n');
  const leftFolder = path.join(directory, '左侧目录'), rightFolder = path.join(directory, '右侧目录');
  await fs.mkdir(leftFolder); await fs.mkdir(rightFolder);
  const droppedLeft = path.join(leftFolder, '拖入左侧.md'), droppedRight = path.join(rightFolder, '拖入右侧.md');
  const droppedExtra = path.join(leftFolder, '第二篇拖入.md');
  await fs.writeFile(droppedLeft, '# 拖入左侧正文\n'); await fs.writeFile(droppedRight, '# 拖入右侧正文\n');
  await fs.writeFile(droppedExtra, '# 多文件拖入正文\n');
  const profile = path.join(directory, 'profile'), port = await freePort();
  const args = [...entry, `--user-data-dir=${profile}`, '--file-opening-check'];
  const child = spawn(executable, [...args, `--remote-debugging-port=${port}`, first], { env, cwd: fixtures, windowsHide: true, stdio: 'ignore' });
  let client, restarted; const checks = [], check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  try {
    client = await connect(port);
    const visibleHeading = title => client.evaluate(`document.querySelector('#rich:not([hidden]) h1')?.textContent === ${JSON.stringify(title)}`);
    check('冷启动接收中文及空格文件路径，并显示实际 Markdown 内容', await until(() => visibleHeading('首个文件标题')));
    check('系统打开文档后侧栏展示所在目录和所有同级文本', await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(fixtures)} && ['首个 文档.md','第二个 文档.MD','同级说明.txt','同级代码.js'].every(name => [...document.querySelectorAll('#file-tree [data-file-id]')].some(node => node.dataset.fileId === name))`)));
    const hasSibling = await client.evaluate(`Boolean(document.querySelector('#file-tree [data-file-id="同级说明.txt"]'))`);
    if (hasSibling) {
      await client.evaluate(`document.querySelector('#file-tree [data-file-id="同级说明.txt"]').click()`);
      check('侧栏可切换同级非 Markdown 文件并以纯文本显示', await until(() => client.evaluate(`!document.getElementById('source').hidden && document.getElementById('source').value.includes('同级文本文件原样打开')`)));
      await client.evaluate(`document.querySelector('#tabs [aria-label="关闭 同级说明.txt"]').click()`);
      await until(() => client.evaluate(`document.querySelectorAll('#tabs .document-tab').length === 1`));
    } else check('侧栏可切换同级非 Markdown 文件并以纯文本显示', false);
    check('文件信息和新建打开保存、撤销重做、布局合并为一行', await client.evaluate(`(() => { const ids=['editor-title','save-file','undo','layout-mode']; const nodes=ids.map(id=>document.getElementById(id)); return nodes.every(node=>node.closest('#document-toolbar')) && Math.max(...nodes.map(node=>{const r=node.getBoundingClientRect();return r.top+r.height/2}))-Math.min(...nodes.map(node=>{const r=node.getBoundingClientRect();return r.top+r.height/2})) < 3; })()`));
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
    await client.evaluate(`document.getElementById('layout-mode').value='files'; document.getElementById('layout-mode').dispatchEvent(new Event('change'))`);
    const drop = async (side, files) => {
      const point = await client.evaluate(`(() => {const r=document.querySelector('#${side}-pane .pane-content').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(100,r.height/2)}})()`);
      const data = { items: [], files, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver']) await client.send('Input.dispatchDragEvent', { type, ...point, data });
      const highlighted = await client.evaluate(`document.getElementById('${side}-pane').classList.contains('file-drop-target')`);
      await client.send('Input.dispatchDragEvent', { type: 'drop', ...point, data });
      return highlighted;
    };
    check('本地文件拖动时高亮接收区域', await drop('left', [droppedLeft]));
    check('实际 OS 文件拖入左侧，打开左侧并展示所在目录', await until(() => client.evaluate(`document.querySelector('#rich:not([hidden]) h1')?.textContent === '拖入左侧正文' && document.getElementById('folder-name').title === ${JSON.stringify(leftFolder)}`)));
    await drop('right', [droppedRight]);
    check('拖入右侧只替换右侧文档并切换到该文件的目录', await until(() => client.evaluate(`document.querySelector('#right-rich:not([hidden]) h1')?.textContent === '拖入右侧正文' && document.querySelector('#rich h1')?.textContent === '拖入左侧正文' && document.getElementById('folder-name').title === ${JSON.stringify(rightFolder)}`)));
    await client.evaluate(`document.getElementById('right-pane').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.getElementById('source-mode').click();const node=document.getElementById('right-source');node.value='# 右侧未保存修改';node.dispatchEvent(new InputEvent('input',{bubbles:true}));`);
    const count = await client.evaluate(`document.querySelectorAll('#tabs .document-tab').length`);
    await drop('right', [droppedRight]);
    check('重复拖入不创建重复标签，也不覆盖该侧未保存内容', await until(() => client.evaluate(`document.querySelectorAll('#tabs .document-tab').length === ${count} && !document.getElementById('right-source').hidden && document.getElementById('right-source').value.includes('右侧未保存修改')`)));
    await drop('left', [droppedLeft, droppedExtra]);
    check('同时拖入多个文件，按同一侧打开并保留另一侧编辑', await until(() => client.evaluate(`document.querySelector('#rich:not([hidden]) h1')?.textContent === '多文件拖入正文' && document.getElementById('right-source').value.includes('右侧未保存修改')`)));
    const clickPane = async side => {
      const point = await client.evaluate(`(() => {const r=document.querySelector('#${side}-pane .pane-heading').getBoundingClientRect();return {x:r.left+35,y:r.top+r.height/2}})()`);
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    await clickPane('right');
    check('点击右侧编辑区后目录跟随右侧活动文件并高亮它', await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(rightFolder)} && document.querySelector('#file-tree button.active')?.dataset.fileId === '拖入右侧.md'`)));
    await clickPane('left');
    check('点击左侧编辑区后目录切回左侧活动文件的目录', await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(leftFolder)} && document.querySelector('#file-tree button.active')?.dataset.fileId === '第二篇拖入.md'`)));
    const clickTab = name => client.evaluate(`[...document.querySelectorAll('#tabs .tab-select')].find(node=>node.textContent.startsWith(${JSON.stringify(name)})).click()`);
    await clickTab('首个 文档.md');
    check('切换文件标签后侧栏展示该文件父目录且保留编辑内容', await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(fixtures)} && document.getElementById('source').value.includes('未保存的正在编辑内容')`)));
    await clickTab('拖入右侧.md');
    check('切换到右侧文档标签时也同步目录且保留右侧未保存内容', await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(rightFolder)} && document.getElementById('right-source').value.includes('右侧未保存修改')`)));
    await client.evaluate(`for(const name of ['首个 文档.md','第二篇拖入.md','拖入右侧.md','第二篇拖入.md']) [...document.querySelectorAll('#tabs .tab-select')].find(node=>node.textContent.startsWith(name)).click()`);
    await until(() => client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(leftFolder)}`));
    await sleep(300);
    check('快速交替切换后目录保持在最后激活文件，旧结果不回退', await client.evaluate(`document.getElementById('folder-name').title === ${JSON.stringify(leftFolder)} && document.querySelector('#file-tree button.active')?.dataset.fileId === '第二篇拖入.md'`));
    await client.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 700, deviceScaleFactor: 1, mobile: false });
    check('最小窗口宽度下工具行不换行且操作按钮完整可见', await client.evaluate(`(() => {const bar=document.getElementById('document-toolbar');if(!bar)return false;const r=bar.getBoundingClientRect();return r.height<=52 && ['new-document','open-file','save-file','save-as','undo','redo','layout-mode'].every(id=>{const b=document.getElementById(id).getBoundingClientRect();return b.left>=r.left&&b.right<=innerWidth&&b.top>=r.top&&b.bottom<=r.bottom;})})()`));
    await client.send('Emulation.clearDeviceMetricsOverride', {});
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(parent, 'workspace-dragging.png'), Buffer.from(screenshot.data, 'base64'));
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
