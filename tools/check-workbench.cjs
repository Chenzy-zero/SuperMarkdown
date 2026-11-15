const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { connect, freePort, until, sleep } = require('./cdp.cjs');
const root = path.resolve(__dirname, '..');
const executable = process.argv[2] ? path.resolve(process.argv[2]) : require('electron');
const entry = process.argv[2] ? [] : [path.join(root, 'src/app/main.cjs')];
if (!process.argv[2]) require('./build-editor.cjs');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  const artifacts = path.join(root, '.prototype-artifacts');
  const directory = await fs.mkdtemp(path.join(artifacts, 'workbench-'));
  const folder = path.join(directory, '项目', '代码'); await fs.mkdir(folder, { recursive: true });
  const js = path.join(folder, 'demo.js'), python = path.join(folder, 'demo.py'), md = path.join(folder, '写作.md');
  const original = 'const title = "中文";\r\nfunction greet(name) {\r\n  return title + name;\r\n}\r\n';
  await fs.writeFile(js, original); await fs.writeFile(python, 'def greet(name):\n    # comment\n    return "hello" + name\n');
  await fs.writeFile(md, '# 标题\n\n可视编辑正文。\n');
  const profile = path.join(directory, 'profile'); let client; const children = [], checks = [];
  const check = (name, passed) => { checks.push({ name, passed: Boolean(passed) }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); };
  async function launch(file) {
    const port = await freePort(); const child = spawn(executable, [...entry, `--user-data-dir=${profile}`, '--file-opening-check', `--remote-debugging-port=${port}`, file], { env, windowsHide: true, stdio: 'ignore' });
    children.push(child); client = await connect(port);
    if (!await until(() => client.evaluate('Boolean(window.prototypeReady)'), 8000)) throw new Error('工作台未就绪');
    await client.evaluate('window.prototypeReady'); return child;
  }
  const evaluate = text => client.evaluate(text);
  const click = async selector => {
    const point = await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const key = async (key, modifiers = 0) => { await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers }); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers }); };
  const open = name => evaluate(`document.querySelector('#file-tree [data-file-id=${JSON.stringify(name)}]').click()`);
  const chooseMenu = async (menu, text) => { await click(`[data-menu="${menu}"]`); await evaluate(`[...document.querySelectorAll('#app-menu button')].find(node=>node.textContent.includes(${JSON.stringify(text)})).click()`); };
  const close = async () => { await evaluate('window.workspaceFiles.writeRecovery([]).then(()=>window.workspaceFiles.approveClose())').catch(() => {}); client.close(); client = null; await until(() => children.at(-1).exitCode !== null, 4000); };
  try {
    await launch(js);
    check('JavaScript 语法分别着色关键字、字符串和函数', await until(() => evaluate(`['tok-keyword','tok-string','tok-function'].every(name=>document.querySelector('#source .'+name))`)));
    check('代码区显示行号，原始 CRLF 内容尚未改动', await evaluate(`Boolean(document.querySelector('#source .cm-lineNumbers')) && !document.getElementById('editor-title').textContent.includes('●')`) && await fs.readFile(js, 'utf8') === original);
    await evaluate(`const editor=document.getElementById('source');editor.setSelectionRange(0,editor.value.indexOf('  return'));editor.focus()`);
    await click('#line-typing');
    check('选区末端在下一行行首时，只建立前两行光标', await evaluate(`document.getElementById('source').codeEditor.cursors===2`));
    await client.send('Input.insertText', { text: '#' });
    check('真实输入 # 同时写入每个选中行的最左侧', await until(() => evaluate(`document.getElementById('source').value.startsWith(${JSON.stringify('#const title = "中文";\n#function greet(name) {\n  return')})`)));
    await client.send('Input.insertText', { text: '中文' });
    check('继续输入中文时多个光标保持同步', await evaluate(`document.getElementById('source').value.startsWith('#中文const') && document.getElementById('source').value.includes(${JSON.stringify('\n#中文function')})`));
    await key('Escape');
    check('Esc 退出多行输入并恢复单光标', await evaluate(`!document.getElementById('source').codeEditor.batch && document.getElementById('source').codeEditor.cursors===1`));
    await key('z', 2);
    check('Ctrl+Z 一次撤销同组多行输入', await until(() => evaluate(`document.getElementById('source').value.startsWith('const title')`)));
    await key('y', 2); await click('#save-file');
    check('多行内容真实保存并保持原 CRLF', await until(async () => (await fs.readFile(js, 'utf8')).startsWith('#中文const title = "中文";\r\n#中文function')));
    await open('demo.py');
    check('切换 Python 后按 Python 语法显示注释与关键字', await until(() => evaluate(`document.querySelector('#source .tok-comment')?.textContent === '# comment' && document.querySelector('#source .tok-keyword')?.textContent === 'def'`)));
    await click('#parent-folder');
    check('上一级进入父目录，保留当前正文和标签页', await until(() => evaluate(`document.getElementById('folder-name').title===${JSON.stringify(path.dirname(folder))} && document.getElementById('source').value.startsWith('def greet')`)));
    await sleep(250); check('手动浏览上级目录不会立即被目录跟随拉回', await evaluate(`document.getElementById('folder-name').title===${JSON.stringify(path.dirname(folder))}`));
    await click('#source .cm-content');
    check('再次激活文件正文时恢复文件所在目录', await until(() => evaluate(`document.getElementById('folder-name').title===${JSON.stringify(folder)}`)));
    await open('写作.md'); await chooseMenu('view', '文档大纲');
    check('查看菜单可切换大纲且显示文档标题', await evaluate(`!document.getElementById('outline').hidden && document.getElementById('outline').textContent.includes('标题')`));
    await chooseMenu('view', '隐藏侧栏'); check('查看菜单可隐藏侧栏', await evaluate(`document.querySelector('aside').hidden`));
    await chooseMenu('view', '文件目录'); check('查看菜单可恢复目录', await evaluate(`!document.querySelector('aside').hidden && !document.getElementById('files').hidden`));
    await chooseMenu('view', '预览 + 源码同步');
    await evaluate(`const right=document.getElementById('right-source');right.focus();right.setSelectionRange(right.value.length,right.value.length)`);
    await client.send('Input.insertText', { text: '\n\n同步的中文正文。' });
    check('新源码组件的真实输入双向同步至可视正文', await until(() => evaluate(`document.querySelector('#rich').textContent.includes('同步的中文正文')`)));
    await click('#save-file'); await until(async () => (await fs.readFile(md, 'utf8')).includes('同步的中文正文'));
    for (const theme of ['light', 'dark', 'cream', 'gray']) {
      await click('[data-menu="theme"]'); await click(`[data-theme-option="${theme}"]`); await sleep(100);
      check(`主题 ${theme} 覆盖正文及源码背景`, await evaluate(`document.documentElement.dataset.theme==='${theme}' && getComputedStyle(document.querySelector('#rich .vditor-reset')).backgroundColor===getComputedStyle(document.querySelector('#right-source .cm-editor')).backgroundColor`));
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(artifacts, `theme-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await evaluate(`document.getElementById('layout-mode').value='single';document.getElementById('layout-mode').dispatchEvent(new Event('change'))`);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 700, deviceScaleFactor: 1, mobile: false });
    check('最小窗口下菜单、布局和多行输入按钮不超出窗口', await evaluate(`['.app-menus','#layout-mode','#line-typing','#mode-controls','#new-document','#save-as'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})`));
    await evaluate(`const node=document.getElementById('source');document.getElementById('source-mode').click();node.setSelectionRange(0,node.value.length);node.focus()`);
    await click('#line-typing'); await click('#visual-mode'); await sleep(50);
    check('切换回可视编辑后退出隐藏源码区的多行输入', await evaluate(`!document.getElementById('source').codeEditor.batch && document.getElementById('line-typing').getAttribute('aria-pressed')==='false'`));
    await chooseMenu('view', '文档大纲'); await close(); await launch(md);
    check('重启后记住科技灰主题及大纲视图', await evaluate(`document.documentElement.dataset.theme==='gray' && !document.getElementById('outline').hidden`));
    await fs.writeFile(path.join(artifacts, 'workbench-report.json'), JSON.stringify({ checks }, null, 2));
    if (!checks.every(item => item.passed)) process.exitCode = 1;
  } finally { if (client) await close(); for (const child of children) if (child.exitCode === null) child.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
