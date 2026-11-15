const { app, BrowserWindow, session, Menu, dialog, ipcMain, shell, clipboard, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WorkspaceFiles } = require('./workspace-files.cjs');
const { Preferences } = require('./preferences.cjs');
const { RecoveryStore, diskRevision } = require('./file-persistence.cjs');
const { pathsFromArguments, FileOpenQueue } = require('./open-files.cjs');
const uxVerify = process.argv.includes('--ux-verify');
const recoveryPrepare = process.argv.includes('--recovery-prepare');
const recoveryVerify = process.argv.includes('--recovery-verify');
const startupVerify = process.argv.includes('--startup-verify');
const verify = process.argv.includes('--verify') || uxVerify || recoveryPrepare || recoveryVerify || startupVerify;
app.setName('SuperMarkdown');
const artifacts = verify && process.env.SUPERMARKDOWN_VERIFY_OUTPUT ? path.resolve(process.env.SUPERMARKDOWN_VERIFY_OUTPUT) :
  app.isPackaged ? path.join(app.getPath('userData'), 'verification') : path.resolve(__dirname, '../../.prototype-artifacts');
if ((!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) || verify) app.setPath('userData', path.join(artifacts, verify ? 'verify-profile' : 'profile'));
app.setAppUserModelId('local.supermarkdown.prototype');
app.disableHardwareAcceleration();
let appWindow, workspace;
const requestedFiles = pathsFromArguments(process.argv, process.cwd(), app.isPackaged);
const opening = new FileOpenQueue(filename => workspace.readAbsolute(filename), () => {
  if (appWindow && !appWindow.isDestroyed()) appWindow.webContents.send('application:files-pending');
});
opening.add(requestedFiles);
app.on('second-instance', (_event, commandLine, workingDirectory, additionalData) => {
  opening.add(Array.isArray(additionalData?.files) ? additionalData.files : pathsFromArguments(commandLine, workingDirectory, app.isPackaged));
  if (appWindow && !appWindow.isDestroyed() && !process.argv.includes('--file-opening-check')) {
    if (appWindow.isMinimized()) appWindow.restore(); appWindow.show(); appWindow.focus();
  }
});
app.on('open-file', (event, filename) => { event.preventDefault(); opening.add([filename]); });
const ownsInstance = verify || app.requestSingleInstanceLock({ files: requestedFiles });
if (!ownsInstance) app.quit();

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const remoteRequests = [];
  const externalLinks = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const remote = /^https?:/i.test(details.url);
    if (remote) remoteRequests.push(details.url);
    callback({ cancel: remote });
  });
  Menu.setApplicationMenu(null);
  const preferences = new Preferences(app.getPath('userData'));
  if (!verify) await preferences.read();
  const updateAppearance = () => { nativeTheme.themeSource = ['dark', 'gray'].includes(preferences.value.theme) ? 'dark' : 'light'; };
  updateAppearance();
  const window = new BrowserWindow({
    width: 1320, height: 940, minWidth: 880, minHeight: 620,
    show: !verify && !process.argv.includes('--file-opening-check'), backgroundColor: '#f6f7f5', title: 'SuperMarkdown',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  appWindow = window;
  workspace = new WorkspaceFiles();
  const recovery = new RecoveryStore(app.getPath('userData'));
  if (verify && !recoveryVerify) await recovery.write([]);
  let recovered = [], recoveryError = '';
  try {
    recovered = await recovery.read();
    for (const item of recovered) if (item.file?.path) workspace.openedFiles.set(item.file.key, { ...item.file });
  } catch (error) { recoveryError = error.message; }
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
        return { error: messages[error.code] || error.message, code: error.code };
      }
    });
  }
  handle('workspace:choose-folder', async () => {
    const result = verify ? { canceled: false, filePaths: [fixtureRoot] } :
      await dialog.showOpenDialog(window, { title: '打开文本文件所在的文件夹', buttonLabel: '打开文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return workspace.openFolder(result.filePaths[0]);
  });
  handle('application:startup', () => ({ verify: verify && !startupVerify, drafts: recovered, recoveryError, preferences: preferences.value }));
  handle('application:preferences', async value => { const result = await preferences.write(value); updateAppearance(); return result; });
  handle('workspace:parent-folder', root => workspace.parentFolder(root));
  handle('workspace:active-folder', key => workspace.folderForFile(key, false));
  async function withFileFolder(file) {
    try {
      const folder = await workspace.folderForFile(file.key);
      return { file: { ...file, root: folder.path, id: path.basename(file.path) }, folder };
    } catch (error) { return { file, folderError: `已打开文件，但无法读取所在目录：${error.message}` }; }
  }
  handle('application:take-open-files', async () => {
    const results = await opening.take();
    for (let i = 0; i < results.length; i++) if (results[i].file) results[i] = await withFileFolder(results[i].file);
    return results;
  });
  handle('application:default-apps', async () => {
    if (!verify) await shell.openExternal('ms-settings:defaultapps');
    return { ok: true };
  });
  handle('workspace:open-file', async () => {
    const result = verify ? { canceled: false, filePaths: [path.join(fixtureRoot, 'README.MD')] } :
      await dialog.showOpenDialog(window, { title: '打开文本文件', properties: ['openFile'], filters: [{ name: '文本文件', extensions: ['md', 'txt', '*'] }] });
    return result.canceled ? null : withFileFolder(await workspace.readAbsolute(result.filePaths[0]));
  });
  handle('workspace:open-dropped', async paths => {
    if (!Array.isArray(paths) || !paths.length) throw new Error('请从资源管理器拖入本地文本文件。');
    const results = [];
    for (const filename of paths) {
      try {
        if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('拖入的文件路径无效。');
        results.push(await withFileFolder(await workspace.readAbsolute(filename)));
      } catch (error) { results.push({ error: `无法打开 ${typeof filename === 'string' ? path.basename(filename) : '文件'}：${error.message}` }); }
    }
    return results;
  });
  let testDelay = 0, cancelNextSave = false, closeApprovals = 0;
  handle('workspace:save', async request => {
    if (verify && testDelay) await new Promise(resolve => setTimeout(resolve, testDelay));
    return workspace.save(request.key, request.content, request.revision, request.format);
  });
  handle('workspace:reload-encoding', ({ key, encoding }) => workspace.reloadEncoding(key, encoding));
  handle('workspace:inspect', key => workspace.inspect(key));
  let saveDialogNumber = 0;
  handle('workspace:save-as', async ({ name, content, key, openKeys = [], format }) => {
    if (verify && cancelNextSave) { cancelNextSave = false; return null; }
    const current = key ? workspace.knownFile(key) : null;
    const result = verify ? { canceled: false, filePath: path.join(fixtureRoot, `另存-${++saveDialogNumber}-${path.basename(name)}`) } :
      await dialog.showSaveDialog(window, { title: '另存为', defaultPath: current?.path || name,
        filters: [{ name: '文本文件', extensions: [path.extname(name).slice(1) || 'md'] }, { name: '所有文件', extensions: ['*'] }] });
    if (result.canceled || !result.filePath) return null;
    const target = path.join(await fs.realpath(path.dirname(result.filePath)), path.basename(result.filePath));
    const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (openKeys.some(openKey => openKey !== key && normalized(workspace.knownFile(openKey).path) === normalized(target))) {
      throw new Error('目标文件已在其他标签页打开，请选择其他位置。');
    }
    const before = await diskRevision(target);
    return workspace.saveAs(target, content, before.revision, format);
  });
  handle('recovery:write', documents => recovery.write(documents));
  handle('recovery:read', () => recovery.read());
  let closingWindow = false;
  window.on('close', event => {
    if (closingWindow) return;
    event.preventDefault(); window.webContents.send('application:request-close');
  });
  handle('application:close-approved', () => {
    closeApprovals++;
    if (!verify) { closingWindow = true; window.close(); }
    return { ok: true };
  });
  if (verify) handle('testing:files', async ({ action, key, content, delay }) => {
    if (action === 'delay') { testDelay = delay; return { ok: true }; }
    if (action === 'cancel-save') { cancelNextSave = true; return { ok: true }; }
    if (action === 'close-window') { window.close(); return { ok: true }; }
    if (action === 'close-count') return { count: closeApprovals };
    const target = workspace.knownFile(key).path;
    const relative = path.relative(fixtureRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('仅允许修改验证样本。');
    if (action === 'write') await fs.writeFile(target, content);
    else if (action === 'delete') await fs.unlink(target);
    else if (action === 'readonly') await fs.chmod(target, 0o444);
    else if (action === 'writable') await fs.chmod(target, 0o666);
    else throw new Error('未知验证操作。');
    return { ok: true };
  });
  handle('workspace:list', (id, root) => workspace.list(id, root));
  handle('workspace:read', (id, root) => workspace.read(id, root));
  handle('workspace:create-markdown', ({ directoryId, name, root }) => workspace.createMarkdown(directoryId, name, root));
  handle('workspace:entry-action', async ({ action, id, root }) => {
    const entry = await workspace.resolve(id, root);
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
  if (startupVerify) {
    try {
      const result = await window.webContents.executeJavaScript('window.prototypeReady.then(() => window.startupSmokeCheck())');
      console.log(JSON.stringify(result));
      app.exit(result.checks.every(item => item.passed) ? 0 : 1);
    } catch (error) { console.error(error); app.exit(1); }
    return;
  }
  if (recoveryPrepare || recoveryVerify) {
    try {
      const result = await window.webContents.executeJavaScript(`window.prototypeReady.then(() => window.${recoveryPrepare ? 'prepareRecoveryCheck' : 'verifyRecoveryCheck'}())`);
      if (recoveryVerify) {
        await fs.writeFile(path.join(artifacts, 'recovery-report.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
      }
      // 直接结束进程，刻意绕过正常关闭和草稿清理，下一次启动验证恢复路径。
      app.exit(result.checks?.some(item => !item.passed) ? 1 : 0);
    } catch (error) { console.error(error); app.exit(1); }
    return;
  }
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
      if (uxVerify) {
        const storage = await window.webContents.executeJavaScript('window.runStorageChecks()');
        report.checks.push(...storage.checks);
      }
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
