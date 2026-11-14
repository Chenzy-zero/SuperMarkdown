const { app, BrowserWindow, session, Menu, dialog, ipcMain, shell, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkspaceFiles } = require('./workspace-files.cjs');
const uxVerify = process.argv.includes('--ux-verify');
const verify = process.argv.includes('--verify') || uxVerify;
app.setName('SuperMarkdown');
const artifacts = verify && process.env.SUPERMARKDOWN_VERIFY_OUTPUT ? path.resolve(process.env.SUPERMARKDOWN_VERIFY_OUTPUT) :
  app.isPackaged ? path.join(app.getPath('userData'), 'verification') : path.resolve(__dirname, '../../.prototype-artifacts');
if (!app.isPackaged || verify) app.setPath('userData', path.join(artifacts, verify ? 'verify-profile' : 'profile'));
app.setAppUserModelId('local.supermarkdown.prototype');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const remoteRequests = [];
  const externalLinks = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const remote = /^https?:/i.test(details.url);
    if (remote) remoteRequests.push(details.url);
    callback({ cancel: remote });
  });
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1320, height: 940, minWidth: 880, minHeight: 620,
    show: !verify, backgroundColor: '#f6f7f5', title: 'SuperMarkdown · 编辑验证原型',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  const workspace = new WorkspaceFiles();
  const fixtureRoot = path.join(artifacts, 'workspace-fixture');
  if (verify) {
    await fs.mkdir(path.join(fixtureRoot, 'nested'), { recursive: true });
    await fs.rm(path.join(fixtureRoot, 'nested', '新建验证.md'), { force: true });
    await Promise.all([
      fs.writeFile(path.join(fixtureRoot, 'README.MD'), '# 文件夹里的 Markdown\n\n**可视编辑**正文。\n'),
      fs.writeFile(path.join(fixtureRoot, 'notes.txt'), '# 纯文本标题\r\n**不是加粗**\r\n'),
      fs.writeFile(path.join(fixtureRoot, 'main.js'), 'const value = "**不渲染**";\nconsole.log(value);\n'),
      fs.writeFile(path.join(fixtureRoot, 'custom.xyz'), '不依赖文本扩展名白名单。\n'),
      fs.writeFile(path.join(fixtureRoot, 'page.html'), '<script>window.__fileExecuted = true</script>\n'),
      fs.writeFile(path.join(fixtureRoot, 'legacy.txt'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a])),
      fs.writeFile(path.join(fixtureRoot, 'links.md'), '# 链接样本\n\n[本地文本](notes.txt) · [嵌套文本](nested/%E8%AF%B4%E6%98%8E.txt) · [网络](https://example.com/path?q=hello#part) · [父目录文件](../outside.txt)\n\n[标题跳转](#目标标题)\n\n' + '正文内容。\n\n'.repeat(30) + '## 目标标题\n\n链接目标。\n'),
      fs.writeFile(path.join(fixtureRoot, 'LICENSE'), '无扩展名的文本文件\n'),
      fs.writeFile(path.join(fixtureRoot, 'nested', '说明.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('带 BOM 的中文文本\r\n', 'utf16le')])),
      fs.writeFile(path.join(fixtureRoot, 'image.bin'), Buffer.from([0x89, 0x50, 0, 0x4e, 0x47, 0])),
      fs.writeFile(path.join(artifacts, 'outside.txt'), '路径范围检查样本\n'),
    ]);
  }
  function handle(channel, action) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.senderFrame !== window.webContents.mainFrame) return { error: '无法处理该窗口的请求。' };
      try { return await action(...args); }
      catch (error) {
        const messages = { EACCES: '没有权限访问该文件。', EPERM: '暂时无法访问该文件。', ENOENT: '文件或文件夹已不存在。', ENOTDIR: '请选择一个文件夹。', EEXIST: '同名文件已存在，请换一个文件名。' };
        return { error: messages[error.code] || error.message };
      }
    });
  }
  handle('workspace:choose-folder', async () => {
    const result = verify ? { canceled: false, filePaths: [fixtureRoot] } :
      await dialog.showOpenDialog(window, { title: '打开文本文件所在的文件夹', buttonLabel: '打开文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return workspace.openFolder(result.filePaths[0]);
  });
  handle('workspace:list', id => workspace.list(id));
  handle('workspace:read', id => workspace.read(id));
  handle('workspace:create-markdown', ({ directoryId, name }) => workspace.createMarkdown(directoryId, name));
  handle('workspace:entry-action', async ({ action, id }) => {
    const entry = await workspace.resolve(id);
    if (action === 'copy-path') { if (!verify) await clipboard.writeText(entry.fullPath); }
    else if (action === 'reveal') { if (!verify) shell.showItemInFolder(entry.fullPath); }
    else throw new Error('不支持这个文件操作。');
    return { ok: true };
  });
  handle('workspace:describe-link', ({ href, fromKey }) => workspace.describeLink(href, fromKey));
  handle('workspace:activate-link', async ({ href, fromKey }) => {
    const link = workspace.describeLink(href, fromKey);
    if (link.type === 'external') {
      if (verify) externalLinks.push(link.target);
      else await shell.openExternal(link.target);
      return link;
    }
    if (link.type === 'anchor') return link;
    if ((await fs.stat(link.path)).isDirectory()) return { type: 'folder', folder: await workspace.openFolder(link.path) };
    return { type: 'file', file: await workspace.readAbsolute(link.path), fragment: link.fragment };
  });
  handle('workspace:file-action', async ({ action, key }) => {
    const file = workspace.knownFile(key);
    if (action === 'copy-path') { if (!verify) await clipboard.writeText(file.path); }
    else if (action === 'reveal') { if (!verify) shell.showItemInFolder(file.path); }
    else throw new Error('不支持这个文件操作。');
    return { ok: true };
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error('Renderer:', details.message);
  });
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (uxVerify) window.setContentSize(1920, 1080);
  if (verify) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('原型载入超时')), 30000));
    try {
      const report = await Promise.race([
        window.webContents.executeJavaScript('window.prototypeReady.then(() => window.runPrototypeChecks())'),
        timeout,
      ]);
      report.remoteRequests = remoteRequests;
      report.externalLinks = externalLinks;
      if (uxVerify) {
        const ux = await window.webContents.executeJavaScript('window.runPrototypeUXChecks()');
        report.checks.push(...ux.checks);
        report.ux = ux.observations;
        const workspaceChecks = await window.webContents.executeJavaScript('window.runPrototypeWorkspaceChecks()');
        report.checks.push(...workspaceChecks.checks);
        const layoutChecks = await window.webContents.executeJavaScript('window.runPrototypeLayoutChecks()');
        report.checks.push(...layoutChecks.checks);
      }
      report.checks.push({ name: '文件浏览和内存编辑未改写磁盘原文件', passed: (await fs.readFile(path.join(fixtureRoot, 'notes.txt'), 'utf8')) === '# 纯文本标题\r\n**不是加粗**\r\n' });
      if (remoteRequests.length) throw new Error('原型请求了远程资源：' + remoteRequests.join(', '));
      await fs.mkdir(artifacts, { recursive: true });
      await fs.writeFile(path.join(artifacts, 'editor.png'), (await window.webContents.capturePage()).toPNG());
      const plainTextOpened = await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('[data-file-id="main.js"]').click();
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
          if (!document.getElementById('source').hidden && document.getElementById('source').value.startsWith('const value')) {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return document.getElementById('mode-controls').hidden;
          }
        }
        return false;
      })()`);
      report.checks.push({ name: '通过目录按钮点击实际打开代码文件的纯文本视图', passed: plainTextOpened });
      await fs.writeFile(path.join(artifacts, 'plain-text.png'), (await window.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
      app.exit(report.checks.every(item => item.passed) ? 0 : 1);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
