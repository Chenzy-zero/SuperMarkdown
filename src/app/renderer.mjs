import { icon } from './icons.mjs';
import { bindWorkbench } from './workbench.mjs';
import { DocumentHistory } from './history.mjs';
import { sample, compatibility, suggestedScale } from './samples.mjs';
import { preserveProtectedBlocks, protectedBlocks } from './protected-blocks.mjs';
import { runUXChecks } from './ux-checks.mjs';
import { runWorkspaceChecks } from './workspace-checks.mjs';
import { SecondaryPane } from './secondary-pane.mjs';
import { bindToolbarTooltip } from './toolbar-tooltip.mjs';
import { runLayoutChecks } from './layout-checks.mjs';
import { bindPaneDivider } from './pane-divider.mjs';
import { runStorageChecks } from './storage-checks.mjs';
import { bindFileDrop } from './file-drop.mjs';
import { ActiveFolderFollower } from './active-folder.mjs';
window.runPrototypeUXChecks = runUXChecks;
window.runPrototypeWorkspaceChecks = runWorkspaceChecks;
window.runPrototypeLayoutChecks = runLayoutChecks;
window.runStorageChecks = () => {
  const scope = rootFolder?.path;
  return runStorageChecks({ current: focusedDoc, documents: () => documents, isDirty, setLayout, saveDocument, closeDocuments,
    openWorkspaceFile: id => openWorkspaceFile(id, 'left', scope), flushRecovery, restoreDrafts, scanExternalFiles });
};

const $ = id => document.getElementById(id);
const startup = unwrap(await window.workspaceFiles.startup());
function createDocument(name, content, kind = 'markdown', key = `demo:${name}`, file = null) {
  return {
    name, kind, key, file, mode: kind === 'markdown' ? 'visual' : 'text',
    history: new DocumentHistory(content), savedText: content,
    lineEnding: content.includes('\r\n') && !/(?<!\r)\n/.test(content) ? '\r\n' : '\n',
  };
}
const documents = startup.verify ? [
  createDocument('开始写作.md', sample),
  createDocument('内容保留样本.md', compatibility),
  createDocument('长文样本.md', suggestedScale),
] : [];
let activeIndex = documents.length ? 0 : -1;
let mode = 'visual';
let richDirty = false;
let sourceDirty = false;
let rootFolder = null;
let openRequest = 0;
let loading = false;
let composing = false;
let engine;
let linkAnchor = null;
let linkPoint = null;
let linkSequence = 0;
let closingTabs = false;
let closingCompletion = Promise.resolve();
let resolveCloseDialog = null;
let resolveConflict = null;
let recoveryReady = !startup.drafts.length && !startup.recoveryError;
let recoveryTimer = null, lastRecovery = null, recoveryFailure = startup.recoveryError || '';
let scanning = false;
let incomingReady = false, incomingBusy = false, incomingScheduled = false;
let secondary = null;
let activePane = 'left';
let layout = 'single';
let newFileDirectory = '';
let newFileRoot = null;
const droppedRequests = [];
let newFileSide = 'left';
const source = $('source');
SuperMarkdownCode.attach(source);
SuperMarkdownCode.attach($('right-source'));
let workbench;
const doc = () => documents[activeIndex];
const focusedDoc = () => activePane === 'right' ? secondary?.document : doc();
const richRoot = () => document.querySelector('.vditor-wysiwyg > .vditor-reset');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let resolveReady;
window.prototypeReady = new Promise(resolve => { resolveReady = resolve; });

function unwrap(result) {
  if (result?.error) throw Object.assign(new Error(result.error), { code: result.code });
  return result;
}

function showError(error) { $('status').textContent = error.message || '暂时无法打开该文件。'; }

function activeFolderTarget() {
  const item = focusedDoc();
  return { identity: `${activePane}:${item?.key || ''}:${item?.file?.path || ''}`, key: item?.file?.key, directory: item?.file?.directory };
}
const folderFollower = new ActiveFolderFollower({
  current: activeFolderTarget, root: () => rootFolder?.path,
  load: key => window.workspaceFiles.activeFolder(key).then(unwrap),
  align: (target, directory) => {
    const item = focusedDoc();
    if (item?.file?.key === target.key) item.file = { ...item.file, directory, root: directory, id: item.file.name };
  },
  apply: folder => applyFolder(folder, { reveal: false }), onError: showError,
});

function focusPane(side) {
  if (side === activePane) { folderFollower.follow(true); return; }
  if (activePane === 'right') secondary?.capture(); else capture();
  activePane = side;
  focusedDoc()?.history.closeGroup();
  updateUI();
}

function syncSecondary() {
  if (!secondary) return;
  if (layout === 'sync') {
    const key = doc()?.key || null;
    if (secondary.key !== key || secondary.mode !== 'source') secondary.bind(key, 'source');
    else secondary.refresh();
  } else if (layout === 'files') secondary.refresh();
}

function setLayout(next, { autoPick = true } = {}) {
  capture(); secondary?.capture();
  const selected = focusedDoc() || doc();
  if (next === 'sync' && selected?.kind !== 'markdown') {
    $('layout-mode').value = layout; showError(new Error('预览与源码同步布局适用于 Markdown 文档。')); return;
  }
  const previous = layout;
  layout = next; $('layout-mode').value = next; $('editors').dataset.layout = next;
  $('right-pane').hidden = next === 'single';
  $('left-pane').querySelector('.pane-heading').hidden = next === 'single';
  if (next === 'sync') {
    activeIndex = documents.indexOf(selected); mode = 'visual'; selected.mode = 'visual';
    activePane = 'left'; secondary?.bind(selected.key, 'source');
  } else if (next === 'single') {
    if (!doc() && selected) activeIndex = documents.indexOf(selected);
    activePane = 'left'; mode = doc()?.mode || 'visual'; secondary?.bind(null);
  } else {
    if (previous === 'sync') secondary?.bind(null);
    if (autoPick && !secondary?.document) {
      const other = documents.find(item => item.key !== doc()?.key);
      secondary?.bind(other?.key || null);
    }
  }
  render({ focus: false });
}

function moveFileRight(key) {
  capture(); secondary?.capture();
  const item = documents.find(entry => entry.key === key);
  if (!item) return;
  setLayout('files', { autoPick: false });
  secondary?.bind(key);
  if (doc()?.key === key) {
    activeIndex = documents.findIndex(entry => entry.key !== key);
    mode = doc()?.mode || 'visual';
    render({ focus: false });
  }
  focusPane('right'); secondary?.focus(); updateUI();
}

function promptNewMarkdown(directoryId = '', scope = rootFolder?.path) {
  if (!rootFolder) { showError(new Error('请先打开工作文件夹。')); return; }
  newFileDirectory = directoryId; newFileSide = activePane; newFileRoot = scope;
  $('new-file-title').textContent = `新建 Markdown · ${directoryId || rootFolder.name}`;
  $('new-file-name').value = '未命名.md'; $('new-file-error').textContent = '';
  $('new-file-dialog').showModal(); $('new-file-name').focus(); $('new-file-name').select();
}

async function revealTreeEntry(id) {
  const parts = id.split('/').slice(0, -1);
  for (let i = 0; i < parts.length; i++) {
    const directoryId = parts.slice(0, i + 1).join('/');
    const details = [...$('file-tree').querySelectorAll('details')].find(node => node.dataset.directoryId === directoryId);
    if (!details) break;
    details.open = true; await details.loadChildren?.();
  }
}

function showFileMenu(event, entry) {
  event.preventDefault(); event.stopPropagation(); $('tab-menu').hidden = true;
  const directoryId = entry.type === 'directory' ? entry.id : entry.id.split('/').slice(0, -1).join('/');
  const actions = entry.type === 'file' ? [
    ['打开', () => openWorkspaceFile(entry.id, 'left', entry.root)],
    ['在右侧打开', () => openWorkspaceFile(entry.id, 'right', entry.root)],
  ] : [];
  actions.push(
    ['新建 Markdown 文件', () => promptNewMarkdown(directoryId, entry.root || rootFolder?.path)],
    ['复制完整路径', () => window.workspaceFiles.entryAction({ action: 'copy-path', id: entry.id, root: entry.root || rootFolder?.path }).then(unwrap)],
    ['在文件夹中显示', () => window.workspaceFiles.entryAction({ action: 'reveal', id: entry.id, root: entry.root || rootFolder?.path }).then(unwrap)],
    ['刷新目录', refreshFolder],
  );
  const menu = $('file-menu');
  menu.replaceChildren(...actions.map(([label, action]) => {
    const button = document.createElement('button'); button.textContent = label; button.setAttribute('role', 'menuitem');
    button.onclick = () => { menu.hidden = true; Promise.resolve(action()).catch(showError); };
    return button;
  }));
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button').focus();
}

function clearLinkPreview() {
  linkSequence++; linkAnchor = null; linkPoint = null;
  $('link-target').hidden = true; $('link-target').textContent = '';
}

function positionLinkPreview() {
  const tooltip = $('link-target');
  if (tooltip.hidden || !linkPoint) return;
  const rect = tooltip.getBoundingClientRect();
  let left = linkPoint.x + 14;
  let top = linkPoint.y + 18;
  if (left + rect.width > innerWidth - 12) left = linkPoint.x - rect.width - 14;
  if (top + rect.height > innerHeight - 12) top = linkPoint.y - rect.height - 14;
  tooltip.style.left = `${Math.max(12, Math.min(left, innerWidth - rect.width - 12))}px`;
  tooltip.style.top = `${Math.max(12, Math.min(top, innerHeight - rect.height - 12))}px`;
}

async function previewLink(anchor, event, fromKey = doc()?.key) {
  const sameAnchor = linkAnchor === anchor;
  linkAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  linkPoint = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom };
  if (sameAnchor) { positionLinkPreview(); return; }
  const request = { href: anchor.getAttribute('href'), fromKey };
  const sequence = ++linkSequence;
  $('link-target').hidden = true;
  try {
    const link = unwrap(await window.workspaceFiles.describeLink(request));
    if (sequence !== linkSequence) return;
    $('link-target').textContent = link.target;
    $('link-target').hidden = false;
    positionLinkPreview();
  } catch { if (sequence === linkSequence) clearLinkPreview(); }
}

function hideFloatingMenu(viewEngine = engine) {
  const wysiwyg = viewEngine?.vditor.wysiwyg;
  if (!wysiwyg) return;
  clearTimeout(wysiwyg.hlToolbarTimeoutId);
  wysiwyg.popover.style.display = 'none';
  wysiwyg.selectPopover.style.display = 'none';
}

function jumpToHeading(heading) {
  if (!heading) { showError(new Error('未找到链接指向的标题。')); return; }
  hideFloatingMenu();
  const root = richRoot();
  root.parentElement.classList.add('outline-navigation');
  root.scrollTop += heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 64;
}

function jumpToFragment(fragment, side = 'left') {
  const item = side === 'right' ? secondary?.document : doc();
  if (!fragment || item?.kind !== 'markdown') return;
  if (side === 'right') secondary.setMode('visual');
  else if (mode !== 'visual') setMode('visual');
  const slug = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-');
  const root = side === 'right' ? secondary.root : richRoot();
  const heading = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(node => node.id === fragment || slug(node.textContent) === fragment || node.textContent === fragment);
  if (side === 'right') secondary.jump(heading); else jumpToHeading(heading);
}

function acceptFile(file, side = 'left') {
  let index = documents.findIndex(item => item.key === file.key);
  if (index < 0) {
    index = documents.length;
    documents.push(createDocument(file.name, file.content, file.kind, file.key, file));
  } else if (documents[index].file) {
    documents[index].file = { ...documents[index].file, root: file.root, id: file.id };
  }
  if (side === 'right') moveFileRight(file.key); else selectDocument(index, { forceLeft: true });
  return index;
}

function acceptExternal(result, side = 'left') {
  if (result.folder) applyFolder(result.folder, { reveal: false });
  if (result.file) acceptFile(result.file, side);
  if (result.error || result.folderError) showError(new Error(result.error || result.folderError));
}

async function drainOpenFiles() {
  incomingScheduled = true;
  if (!incomingReady || incomingBusy || document.querySelector('dialog[open]')) return;
  incomingBusy = true;
  try {
    do {
      incomingScheduled = false;
      const results = [...droppedRequests.splice(0), ...unwrap(await window.workspaceFiles.takeOpenFiles())];
      for (const result of results) acceptExternal(result, result.side || 'left');
      if (results.length) incomingScheduled = true;
    } while (incomingScheduled && !document.querySelector('dialog[open]'));
  } catch (error) { showError(error); } finally { incomingBusy = false; }
}

async function activateLink(request, side = 'left') {
  const sequence = ++openRequest;
  try {
    const result = unwrap(await window.workspaceFiles.activateLink(request));
    if (sequence !== openRequest) return;
    if (result.type === 'file') { acceptFile(result.file, side); jumpToFragment(result.fragment, side); }
    else if (result.type === 'folder') applyFolder(result.folder);
    else if (result.type === 'anchor') jumpToFragment(result.fragment, side);
    else if (result.type === 'external') $('status').textContent = '已交由默认浏览器打开。';
  } catch (error) { showError(error); }
}

function isDirty(item) { return item.history.current.markdown !== item.savedText; }

function recoverySnapshot() {
  return documents.filter(isDirty).map(item => ({ key: item.key, name: item.name, kind: item.kind, file: item.file,
    savedText: item.savedText, content: item.history.current.markdown, mode: item.mode, lineEnding: item.lineEnding }));
}
async function flushRecovery() {
  if (!recoveryReady) return;
  capture(); secondary?.capture(); clearTimeout(recoveryTimer); recoveryTimer = null;
  const entries = recoverySnapshot(), serialized = JSON.stringify(entries);
  if (serialized === lastRecovery) return;
  try { unwrap(await window.workspaceFiles.writeRecovery(entries)); lastRecovery = serialized; recoveryFailure = ''; }
  catch (error) { recoveryFailure = `恢复草稿写入失败：${error.message}`; showError(error); throw error; }
}
function scheduleRecovery() {
  if (!recoveryReady || recoveryTimer !== null) return;
  recoveryTimer = setTimeout(() => { recoveryTimer = null; flushRecovery().catch(() => {}); }, 400);
}
function newDocument() {
  capture(); secondary?.capture();
  const item = createDocument('未命名.md', '', 'markdown', `untitled:${crypto.randomUUID()}`);
  documents.push(item); selectDocument(documents.length - 1, { forceLeft: true });
}
async function openFile() {
  try { const result = unwrap(await window.workspaceFiles.openFile()); if (result) { droppedRequests.push(result); await drainOpenFiles(); } } catch (error) { showError(error); }
}
function askConflict(item) {
  if (resolveConflict || document.querySelector('dialog[open]')) return Promise.resolve('cancel');
  $('conflict-message').textContent = `${item.name} 已被其他程序修改。当前编辑内容仍保留，可重新载入磁盘版本或另存为。`;
  return new Promise(resolve => { resolveConflict = resolve; $('file-conflict').showModal(); });
}
function finishConflict(action) { const resolve = resolveConflict; resolveConflict = null; $('file-conflict').close(); resolve?.(action); }
function applyDisk(item, file) {
  item.file = file; item.savedText = file.content; item.history = new DocumentHistory(file.content);
  item.lineEnding = file.content.includes('\r\n') && !/(?<!\r)\n/.test(file.content) ? '\r\n' : '\n';
  item.externalChanged = false; item.missing = false;
  item.saveError = '';
  if (item === doc()) render({ focus: false }); else { secondary?.refresh({ force: true }); updateUI(); }
}
async function reloadDocument(item) {
  const file = unwrap(await window.workspaceFiles.inspect(item.file.key));
  if (file.missing) { item.missing = true; throw new Error('原文件已不存在，当前内容仍保留，请另存为。'); }
  applyDisk(item, file); await flushRecovery();
}
async function saveDocument(item = focusedDoc(), saveAs = false) {
  if (!item) return false;
  if (item.saving) { await item.saving; return isDirty(item) ? saveDocument(item, saveAs) : true; }
  capture(); secondary?.capture();
  const snapshot = item.history.current.markdown;
  item.saveError = '';
  const action = (async () => {
    try {
      const request = { name: item.name, content: snapshot, key: item.file?.key,
        revision: item.file?.revision, openKeys: documents.flatMap(entry => entry.file ? [entry.file.key] : []) };
      const result = unwrap(await (saveAs || !item.file ? window.workspaceFiles.saveAs(request) : window.workspaceFiles.save(request)));
      if (!result) return false;
      const oldKey = item.key, oldKind = item.kind;
      item.key = result.key; item.file = result; item.name = result.name; item.savedText = snapshot;
      item.kind = result.kind; item.externalChanged = false; item.missing = false; item.history.closeGroup();
      if (secondary?.key === oldKey) {
        const state = secondary.states.get(oldKey); if (state) secondary.states.set(item.key, state);
        secondary.key = item.key;
      }
      if (item.kind === 'text') { item.mode = 'text'; if (item === doc()) mode = 'text'; }
      if (oldKind !== item.kind) {
        item.mode = item.kind === 'markdown' ? 'source' : 'text';
        if (item === doc()) mode = item.mode;
        if (secondary?.key === item.key) secondary.mode = item.mode;
        if (layout === 'sync') { layout = 'single'; $('layout-mode').value = layout; $('editors').dataset.layout = layout; secondary.bind(null); activePane = 'left'; }
        render({ focus: false });
      }
      if (rootFolder) await refreshFolder();
      updateUI(); await flushRecovery(); $('status').textContent = `已保存 · ${result.path}`;
      return true;
    } catch (error) {
      if (error.code === 'FILE_MISSING') { item.missing = true; return 'missing'; }
      if (error.code === 'FILE_CONFLICT') { item.externalChanged = true; return 'conflict'; }
      item.saveError = error.message; showError(error); return false;
    }
  })();
  item.saving = action; updateUI();
  let result;
  try { result = await action; } finally { item.saving = null; updateUI(); }
  if (result === 'missing') return saveDocument(item, true);
  if (result === 'conflict') {
    const choice = await askConflict(item);
    if (choice === 'save-as') return saveDocument(item, true);
    if (choice === 'reload') { try { await reloadDocument(item); } catch (error) { showError(error); } }
    return false;
  }
  return result;
}

async function scanExternalFiles(prompt = false) {
  if (scanning || composing || document.querySelector('dialog[open]')) return;
  scanning = true; capture(); secondary?.capture();
  try {
    for (const item of documents.filter(entry => entry.file && !entry.saving)) {
      const file = unwrap(await window.workspaceFiles.inspect(item.file.key));
      if (!documents.includes(item)) continue;
      if (file.missing) { item.missing = true; continue; }
      if (file.revision === item.file.revision) continue;
      if (!isDirty(item)) applyDisk(item, file);
      else {
        item.externalChanged = true;
        if (prompt && item.notifiedRevision !== file.revision) {
          item.notifiedRevision = file.revision;
          const choice = await askConflict(item);
          if (choice === 'save-as') await saveDocument(item, true);
          else if (choice === 'reload') await reloadDocument(item);
        }
      }
    }
    updateUI();
  } catch (error) { showError(error); } finally { scanning = false; }
}

function restoreDrafts(entries) {
  for (const entry of entries) {
    if (documents.some(item => item.key === entry.key)) continue;
    const item = createDocument(entry.name, entry.savedText, entry.kind, entry.key, entry.file);
    item.history.record(entry.content); item.mode = entry.mode; item.lineEnding = entry.lineEnding;
    documents.push(item);
  }
  recoveryReady = true;
  if (documents.length) selectDocument(documents.length - 1, { forceLeft: true });
  scheduleRecovery();
}

function finishCloseDialog(action) {
  const resolve = resolveCloseDialog;
  resolveCloseDialog = null;
  $('close-confirm').close(action);
  resolve?.(action);
}

async function closeDocuments(keys) {
  if (closingTabs) { await closingCompletion; return closeDocuments(keys); }
  capture(); secondary?.capture();
  const requested = new Set(keys);
  const targets = documents.filter(item => requested.has(item.key));
  if (!targets.length) return true;
  closingTabs = true;
  let finishClosing;
  closingCompletion = new Promise(resolve => { finishClosing = resolve; });
  try {
    const dirty = targets.filter(isDirty);
    if (dirty.length) {
      $('close-message').textContent = `${dirty.map(item => item.name).join('、')} 有未保存的修改，是否保存后关闭？`;
      const choice = await new Promise(resolve => {
        const dialog = $('close-confirm');
        resolveCloseDialog = resolve;
        dialog.returnValue = ''; dialog.showModal();
      });
      if (choice === 'cancel') return false;
      if (choice === 'save') for (const item of dirty) if (!await saveDocument(item) || isDirty(item)) return false;
    }
    openRequest++;
    const activeKey = doc()?.key;
    const previousIndex = activeIndex;
    for (let i = documents.length - 1; i >= 0; i--) if (targets.includes(documents[i])) documents.splice(i, 1);
    const surviving = documents.findIndex(item => item.key === activeKey);
    activeIndex = surviving >= 0 ? surviving : Math.min(previousIndex, documents.length - 1);
    if (secondary?.key && !secondary.document) { secondary.bind(null); activePane = 'left'; }
    if (layout === 'sync' && doc()?.kind !== 'markdown') {
      layout = 'single'; activePane = 'left'; secondary?.bind(null);
      $('layout-mode').value = layout; $('editors').dataset.layout = layout;
    }
    mode = doc()?.mode || 'visual'; render(); await flushRecovery(); return true;
  } finally { closingTabs = false; finishClosing(); }
}

function showTabMenu(event, key) {
  event.preventDefault(); $('file-menu').hidden = true;
  const index = documents.findIndex(item => item.key === key);
  if (index < 0) return;
  if (focusedDoc()?.key !== key) selectDocument(index);
  const item = documents[index];
  const menu = $('tab-menu');
  const commands = [
    ['关闭', () => closeDocuments([key])],
    ['关闭其他标签页', () => closeDocuments(documents.filter(entry => entry.key !== key).map(entry => entry.key))],
    ['关闭右侧标签页', () => closeDocuments(documents.slice(documents.indexOf(item) + 1).map(entry => entry.key))],
    ['关闭全部标签页', () => closeDocuments(documents.map(entry => entry.key))],
    ['移到右侧显示', () => moveFileRight(key)],
    ['在左侧打开', () => selectDocument(documents.indexOf(item), { forceLeft: true })],
    ['预览 + 源码同步', () => { selectDocument(documents.indexOf(item), { forceLeft: true }); setLayout('sync'); }, item.kind !== 'markdown'],
    ['复制完整路径', () => window.workspaceFiles.fileAction({ action: 'copy-path', key }).then(unwrap), !item.file],
    ['在文件夹中显示', () => window.workspaceFiles.fileAction({ action: 'reveal', key }).then(unwrap), !item.file],
  ];
  menu.replaceChildren(...commands.map(([label, action, disabled]) => {
    const button = document.createElement('button'); button.textContent = label;
    button.setAttribute('role', 'menuitem'); button.disabled = Boolean(disabled);
    button.onclick = () => { menu.hidden = true; Promise.resolve(action()).catch(showError); };
    return button;
  }));
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector('button:not(:disabled)').focus();
}

function renderTree(entries, container, scope = rootFolder?.path) {
  container.replaceChildren(...entries.map(entry => {
    if (entry.type === 'directory') {
      const details = document.createElement('details');
      details.dataset.directoryId = entry.id;
      const summary = document.createElement('summary');
      summary.append(icon('folder'), document.createTextNode(entry.name));
      const children = document.createElement('div');
      children.className = 'tree-children';
      let loaded = false;
      let pending = null;
      details.loadChildren = () => {
        if (loaded) return Promise.resolve();
        if (!pending) pending = window.workspaceFiles.list(entry.id, scope).then(unwrap).then(nested => {
          renderTree(nested, children, scope); loaded = true;
        }).finally(() => { pending = null; });
        return pending;
      };
      details.addEventListener('toggle', async () => {
        if (!details.open) return;
        try { await details.loadChildren(); } catch (error) { showError(error); }
      });
      details.append(summary, children);
      summary.oncontextmenu = event => showFileMenu(event, { ...entry, root: scope });
      return details;
    }
    const button = document.createElement('button');
    button.append(icon('file'), document.createTextNode(entry.name));
    button.title = entry.id;
    button.dataset.fileId = entry.id;
    button.onclick = () => openWorkspaceFile(entry.id, 'left', scope).catch(showError);
    button.oncontextmenu = event => showFileMenu(event, { ...entry, root: scope });
    return button;
  }));
  if (!entries.length) {
    const note = document.createElement('p'); note.className = 'empty-note';
    note.textContent = '没有可读取的文本文件。'; container.append(note);
  }
}

async function chooseFolder() {
  $('choose-folder').disabled = true;
  try {
    const folder = unwrap(await window.workspaceFiles.chooseFolder());
    if (!folder) return;
    applyFolder(folder);
  } catch (error) { showError(error); }
  finally { $('choose-folder').disabled = false; }
}

function applyFolder(folder, { reveal = true } = {}) {
  rootFolder = folder;
  $('refresh-folder').disabled = false;
  $('new-markdown').disabled = false;
  $('parent-folder').disabled = /^[A-Za-z]:[\\/]?$/.test(folder.path) || folder.path === '/';
  $('folder-name').textContent = folder.path; $('folder-name').title = folder.path;
  $('examples-section').open = false; renderTree(folder.entries, $('file-tree'));
  if (reveal) {
    workbench?.sidebar('files');
    $('files').hidden = false; $('outline').hidden = true;
    $('files-tab').setAttribute('aria-selected', 'true'); $('outline-tab').setAttribute('aria-selected', 'false');
  }
  updateUI();
}

async function openWorkspaceFile(id, side = 'left', scope = rootFolder?.path) {
  const request = ++openRequest;
  const file = unwrap(await window.workspaceFiles.read(id, scope));
  if (request !== openRequest) return -1;
  return acceptFile(file, side);
}

async function refreshFolder() {
  if (!rootFolder) return;
  $('refresh-folder').disabled = true;
  try {
    const scope = rootFolder.path;
    const entries = unwrap(await window.workspaceFiles.list('', scope));
    if (rootFolder.path === scope) renderTree(entries, $('file-tree'), scope);
    updateUI();
  } catch (error) { showError(error); }
  finally { $('refresh-folder').disabled = false; }
}

function textCaret(root) {
  const selection = getSelection();
  if (!selection.rangeCount || !root.contains(selection.anchorNode)) return 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function restoreTextCaret(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (offset <= node.length) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    offset -= node.length;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

// 仅验证普通段落定位；复杂语法、选区及不可渲染块的映射仍需进一步验证。
function richCaretToMarkdown() {
  const root = richRoot();
  const offset = textCaret(root);
  const text = root.textContent.slice(0, offset);
  const tail = text.slice(-24);
  const markdown = doc().history.current.markdown;
  const position = tail ? markdown.indexOf(tail) : 0;
  return position < 0 ? Math.min(offset, markdown.length) : position + tail.length;
}

function markdownCaretToRich(offset) {
  const markdown = doc().history.current.markdown;
  const before = markdown.slice(0, offset);
  const tail = before.split('\n').at(-1).replace(/^\s{0,3}#{1,6}\s+/, '');
  const text = richRoot().textContent;
  const position = tail ? text.indexOf(tail) : 0;
  restoreTextCaret(richRoot(), position < 0 ? 0 : position + tail.length);
}

function capture() {
  if (loading || !engine || !doc()) return;
  const before = doc().history.current.markdown;
  if (mode !== 'visual') {
    const caret = source.value.slice(0, source.selectionStart).replace(/\n/g, doc().lineEnding).length;
    if (sourceDirty) {
      doc().history.record(source.value.replace(/\n/g, doc().lineEnding), caret, mode);
      sourceDirty = false;
    } else doc().history.current.caret = caret;
    doc().scrollTop = source.scrollTop;
  } else {
    doc().visualScrollTop = richRoot().scrollTop;
    if (richDirty) {
      try {
        const markdown = preserveProtectedBlocks(doc().history.current.markdown, engine.getValue()).replace(/\r?\n/g, doc().lineEnding);
        doc().history.record(markdown, richCaretToMarkdown(), 'visual');
      } catch (error) {
        richDirty = false;
        render();
        $('status').textContent = error.message;
        return;
      }
      richDirty = false;
    } else if (richRoot().contains(getSelection().anchorNode)) {
      doc().history.current.caret = richCaretToMarkdown();
    }
  }
  if (doc().history.current.markdown !== before) secondary?.refresh();
}

function updateUI() {
  folderFollower.follow();
  workbench?.update();
  source.codeEditor.setContext(doc()).catch(showError);
  const active = focusedDoc();
  const viewMode = activePane === 'right' ? secondary?.mode : mode;
  const plainText = active?.kind === 'text';
  $('mode-controls').hidden = plainText || !active || layout === 'sync';
  $('text-mode-label').hidden = !plainText;
  $('mode-shortcut').hidden = plainText || !active || layout === 'sync';
  $('editor-title').textContent = active?.name || '开始写作';
  $('editor-hint').textContent = active?.file?.path || '新建文档，或打开本地文件和文件夹。';
  $('editor-hint').title = $('editor-hint').textContent;
  $('editor-title').title = active?.file?.path || active?.name || '';
  $('visual-mode').setAttribute('aria-pressed', String(viewMode === 'visual'));
  $('source-mode').setAttribute('aria-pressed', String(viewMode === 'source'));
  $('undo').disabled = !active?.history.canUndo;
  $('redo').disabled = !active?.history.canRedo;
  const modeLabel = plainText ? '纯文本' : viewMode === 'visual' ? '可视编辑' : '源码模式';
  $('save-file').disabled = !active || Boolean(active.saving);
  $('save-as').disabled = !active || Boolean(active.saving);
  const stateLabel = active?.saving ? '正在保存…' : active?.saveError ? `保存失败：${active.saveError}` : active?.missing ? '原文件已不存在，请另存为' : active?.externalChanged ? '磁盘文件已变化，保存前需要处理' : active && isDirty(active) ? '未保存' : active && !active.file ? '未命名' : '已保存';
  $('status').textContent = recoveryFailure || (active ? `${modeLabel}${active.file ? ` · ${active.file.encoding}` : ''} · ${stateLabel}` : '没有打开的文档');
  document.title = active ? `${isDirty(active) ? '● ' : ''}${active.name} — SuperMarkdown` : 'SuperMarkdown';
  source.setAttribute('aria-label', doc()?.kind === 'text' ? '纯文本内容' : 'Markdown 源码');
  source.classList.toggle('markdown-source', doc()?.kind === 'markdown');
  $('left-pane-name').textContent = doc() ? `左侧 · ${doc().name}` : '左侧';
  $('left-pane').classList.toggle('active-pane', activePane === 'left');
  $('right-pane').classList.toggle('active-pane', activePane === 'right');
  $('layout-hint').textContent = layout === 'sync' ? '同一文档，左右均可编辑，内容同步' : layout === 'files' ? '点击左侧或右侧正文选择当前编辑区域' : '';
  $('layout-mode').title = $('layout-hint').textContent || '选择正文显示布局';
  $('word-count').textContent = active ? `${active.history.current.markdown.length.toLocaleString()} 字符` : '';
  for (const id of ['examples', 'tabs']) {
    $(id).replaceChildren(...documents.flatMap((item, i) => {
      if (id === 'examples' && item.file) return [];
      const button = document.createElement('button');
      const dirty = isDirty(item);
      button.textContent = (id === 'examples' ? '▤  ' : '') + item.name + (dirty ? ' ·' : '');
      button.title = item.file?.path || item.name;
      button.className = item.key === active?.key ? 'active' : '';
      button.onclick = () => selectDocument(i);
      if (id === 'examples') return [button];
      const tab = document.createElement('div'); tab.className = 'document-tab' + (item.key === active?.key ? ' active' : '');
      tab.dataset.documentKey = item.key;
      button.className = 'tab-select'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(item.key === active?.key));
      if (layout === 'files' && item.key === secondary?.key) button.textContent += ' [右侧]';
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
      close.setAttribute('aria-label', `关闭 ${item.name}`); close.title = `关闭 ${item.name}`;
      close.onclick = () => closeDocuments([item.key]);
      tab.oncontextmenu = event => showTabMenu(event, item.key);
      tab.onauxclick = event => { if (event.button === 1) { event.preventDefault(); closeDocuments([item.key]); } };
      tab.append(button, close);
      return [tab];
    }));
  }
  $('file-tree').querySelectorAll('button[data-file-id]').forEach(button => {
    const activeId = active?.file?.directory === rootFolder?.path ? active.file.name : active?.file?.root === rootFolder?.path ? active.file.id : null;
    button.classList.toggle('active', Boolean(activeId) && button.dataset.fileId === activeId);
  });
  const headings = plainText || !active ? [] : [...active.history.current.markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  $('outline').replaceChildren(...headings.map((match, headingIndex) => {
    const button = document.createElement('button');
    button.textContent = match[2];
    button.style.paddingLeft = `${12 + (match[1].length - 1) * 12}px`;
    button.onclick = () => {
      if (activePane === 'right') {
        const heading = [...secondary.root.querySelectorAll('h1,h2,h3,h4,h5,h6')][headingIndex];
        secondary.jump(heading, match.index);
      } else if (mode === 'source') {
        source.focus();
        source.setSelectionRange(match.index, match.index);
        const lineHeight = parseFloat(getComputedStyle(source).lineHeight);
        source.scrollTop = doc().history.current.markdown.slice(0, match.index).split('\n').length * lineHeight - 60;
      } else {
        jumpToHeading([...richRoot().querySelectorAll('h1,h2,h3,h4,h5,h6')][headingIndex]);
      }
    };
    return button;
  }));
  if (plainText) {
    const note = document.createElement('p'); note.className = 'empty-note';
    note.textContent = '纯文本文件不提供 Markdown 标题大纲。';
    $('outline').append(note);
  }
  scheduleRecovery();
}

function render({ focus = true } = {}) {
  $('right-pane').hidden = layout === 'single';
  $('left-pane').querySelector('.pane-heading').hidden = layout === 'single';
  clearLinkPreview(); hideFloatingMenu();
  $('empty-state').hidden = Boolean(doc());
  if (!doc()) {
    $('rich').hidden = true; source.hidden = true; source.value = '';
    syncSecondary(); updateUI(); return;
  }
  loading = true;
  const state = doc().history.current;
  source.value = state.markdown;
  if (mode === 'visual') {
    richRoot().parentElement.classList.add('outline-navigation');
    engine.setValue(state.markdown, true);
    richRoot().querySelectorAll('code.language-mermaid, [data-type="math-block"]').forEach(node => {
      const block = node.closest('.vditor-wysiwyg__block') || node;
      block.setAttribute('contenteditable', 'false');
      block.setAttribute('title', '切换源码模式修改此内容');
    });
  }
  $('rich').hidden = mode !== 'visual';
  source.hidden = mode === 'visual';
  if (mode !== 'visual') {
    if (focus) source.focus();
    const caret = state.markdown.slice(0, state.caret).replace(/\r\n/g, '\n').length;
    source.setSelectionRange(caret, caret);
    source.scrollTop = doc().scrollTop ?? 0;
  } else {
    if (focus) { engine.focus(); markdownCaretToRich(state.caret); }
    richRoot().scrollTop = doc().visualScrollTop ?? 0;
  }
  richDirty = false;
  sourceDirty = false;
  loading = false;
  syncSecondary();
  updateUI();
}

function setMode(next) {
  if (layout === 'sync') return;
  if (activePane === 'right') { secondary?.setMode(next); return; }
  if (next === mode || composing || !doc() || doc().kind !== 'markdown') return;
  capture();
  doc().history.closeGroup();
  mode = next;
  doc().mode = next;
  render();
}

function selectDocument(index, { forceLeft = false } = {}) {
  if (!documents[index]) return;
  if (!forceLeft && layout === 'files' && secondary?.key === documents[index].key) { secondary.focus(); updateUI(); return; }
  capture(); secondary?.capture();
  if (doc()) { doc().history.closeGroup(); doc().mode = mode; }
  activeIndex = index;
  activePane = 'left';
  mode = doc().mode;
  if (layout === 'sync') {
    if (doc().kind !== 'markdown') { layout = 'single'; $('layout-mode').value = 'single'; $('editors').dataset.layout = 'single'; $('right-pane').hidden = true; secondary?.bind(null); }
    else { mode = 'visual'; doc().mode = 'visual'; }
  }
  render();
  folderFollower.follow(true);
}

function undo() { if (activePane === 'right') secondary?.undoRedo('undo'); else if (doc()) { capture(); doc().history.undo(); render(); } }
function redo() { if (activePane === 'right') secondary?.undoRedo('redo'); else if (doc()) { capture(); doc().history.redo(); render(); } }

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!document.querySelector('dialog[open]') && !event.isComposing && focusedDoc()) closeDocuments([focusedDoc().key]);
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape') { $('tab-menu').hidden = true; $('file-menu').hidden = true; clearLinkPreview(); }
  if (!(event.ctrlKey || event.metaKey) || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (['s', 'o', 'n'].includes(key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (key === 's') saveDocument(focusedDoc(), event.shiftKey);
    else if (key === 'o') openFile(); else newDocument();
    return;
  }
  if (key === 'z' || key === 'y') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'y' || event.shiftKey) redo(); else undo();
  }
  if (key === 'm' && event.shiftKey) {
    event.preventDefault(); event.stopImmediatePropagation();
    setMode((activePane === 'right' ? secondary?.mode : mode) === 'visual' ? 'source' : 'visual');
  }
}, true);

document.addEventListener('editor-batch-boundary', () => focusedDoc()?.history.closeGroup());
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; setTimeout(() => { capture(); updateUI(); }, 0); });
source.addEventListener('input', event => { if (event.target !== source) return; sourceDirty = true; if (!event.isComposing) { capture(); updateUI(); } });
$('rich').addEventListener('input', () => { if (!loading) richDirty = true; }, true);
for (const id of ['visual-mode', 'source-mode', 'undo', 'redo']) {
  $(id).addEventListener('pointerdown', event => { if (activePane === 'right') secondary?.capture(); else capture(); event.preventDefault(); });
}
$('visual-mode').onclick = () => setMode('visual');
$('source-mode').onclick = () => setMode('source');
$('undo').onclick = undo;
$('redo').onclick = redo;
$('close-cancel').onclick = () => finishCloseDialog('cancel');
$('close-discard').onclick = () => finishCloseDialog('discard');
$('close-save').onclick = () => finishCloseDialog('save');
$('close-confirm').addEventListener('cancel', event => { event.preventDefault(); finishCloseDialog('cancel'); });
for (const id of ['save-file', 'save-as', 'open-file', 'new-document']) $(id).addEventListener('pointerdown', event => { capture(); secondary?.capture(); event.preventDefault(); });
$('save-file').onclick = () => saveDocument();
$('save-as').onclick = () => saveDocument(focusedDoc(), true);
$('open-file').onclick = openFile;
$('new-document').onclick = newDocument;
$('conflict-cancel').onclick = () => finishConflict('cancel');
$('conflict-reload').onclick = () => finishConflict('reload');
$('conflict-save-as').onclick = () => finishConflict('save-as');
$('file-conflict').addEventListener('cancel', event => { event.preventDefault(); finishConflict('cancel'); });
$('recovery-restore').onclick = () => { $('recovery-dialog').close(); restoreDrafts(startup.drafts); };
$('recovery-discard').onclick = () => { $('recovery-dialog').close(); recoveryReady = true; flushRecovery().catch(showError); };
$('recovery-dialog').addEventListener('cancel', event => event.preventDefault());
$('examples-section').hidden = !startup.verify;
window.workspaceFiles.onFilesPending(drainOpenFiles);
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', drainOpenFiles);
$('default-markdown').onclick = async () => {
  try {
    unwrap(await window.workspaceFiles.openDefaultApps());
    $('status').textContent = '请在 Windows 默认应用中搜索 .md，选择 SuperMarkdown，并确认为默认打开方式。';
  } catch (error) { showError(error); }
};
window.workspaceFiles.onCloseRequested(async () => {
  if (document.querySelector('dialog[open]') || closingTabs) return;
  try {
    if (await closeDocuments(documents.map(item => item.key))) { await flushRecovery(); unwrap(await window.workspaceFiles.approveClose()); }
  } catch (error) { showError(error); }
});
if (!startup.verify) {
  window.addEventListener('focus', () => scanExternalFiles(true));
  setInterval(() => { if (!document.hidden) scanExternalFiles(); }, 2500);
}
document.addEventListener('pointerdown', event => { for (const id of ['tab-menu', 'file-menu']) if (!$(id).contains(event.target)) $(id).hidden = true; });
$('tab-menu').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...$('tab-menu').querySelectorAll('button:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
});
$('choose-folder').onclick = chooseFolder;
$('refresh-folder').onclick = refreshFolder;
$('new-markdown').onclick = () => promptNewMarkdown('');
$('new-file-cancel').onclick = () => $('new-file-dialog').close();
$('new-file-form').onsubmit = async event => {
  event.preventDefault();
  const submit = $('new-file-form').querySelector('[type="submit"]'); submit.disabled = true;
  $('new-file-cancel').disabled = true;
  try {
    const file = unwrap(await window.workspaceFiles.createMarkdown({ directoryId: newFileDirectory, name: $('new-file-name').value, root: newFileRoot }));
    await refreshFolder(); await revealTreeEntry(file.id);
    $('new-file-dialog').close(); acceptFile(file, newFileSide);
  } catch (error) { $('new-file-error').textContent = error.message; }
  finally { submit.disabled = false; $('new-file-cancel').disabled = false; }
};
$('file-tree').oncontextmenu = event => { if (rootFolder) showFileMenu(event, { id: '', type: 'directory' }); };
$('folder-name').oncontextmenu = event => { if (rootFolder) showFileMenu(event, { id: '', type: 'directory' }); };
$('layout-mode').onchange = () => setLayout($('layout-mode').value);
$('close-right-pane').onclick = () => setLayout('single');
for (const side of ['left', 'right']) {
  $(`${side}-pane`).addEventListener('pointerdown', () => focusPane(side), true);
  $(`${side}-pane`).addEventListener('focusin', () => focusPane(side));
}
bindToolbarTooltip();
bindPaneDivider();
bindFileDrop({
  getActiveSide: () => layout === 'files' ? activePane : 'left', onError: showError,
  openFiles: async (files, side) => {
    const results = unwrap(await window.workspaceFiles.openDroppedFiles(files));
    droppedRequests.push(...results.map(result => ({ ...result, side })));
    await drainOpenFiles();
  },
});
for (const [id, files] of [['files-tab', true], ['outline-tab', false]]) {
  $(id).onclick = () => {
    $('files').hidden = !files; $('outline').hidden = files;
    $('files-tab').setAttribute('aria-selected', String(files));
    $('outline-tab').setAttribute('aria-selected', String(!files));
  };
}


$('parent-folder').onclick = async () => {
  const scope = rootFolder?.path; if (!scope) return;
  $('parent-folder').disabled = true;
  const navigation = folderFollower.browse();
  try { const folder = unwrap(await window.workspaceFiles.parentFolder(scope)); if (rootFolder?.path === scope && navigation === folderFollower.sequence) applyFolder(folder); }
  catch (error) { showError(error); }
  finally { $('parent-folder').disabled = !rootFolder || /^[A-Za-z]:[\\/]?$/.test(rootFolder.path) || rootFolder.path === '/'; }
};
workbench = bindWorkbench({ preferences: startup.preferences, setMode, setLayout,
  getEditor: () => (activePane === 'right' ? $('right-source') : source).codeEditor,
  getDocument: focusedDoc, getMode: () => activePane === 'right' ? secondary?.mode : mode,
  getLayout: () => layout, closeCurrent: () => focusedDoc() && closeDocuments([focusedDoc().key]), onError: showError });

const cdn = new URL('../../node_modules/vditor', location.href).href;
function bindEditorControls(root = richRoot(), viewEngine = engine, getDocument = doc, side = 'left') {
  root.addEventListener('pointerdown', () => root.parentElement.classList.remove('outline-navigation'), true);
  root.addEventListener('keydown', () => root.parentElement.classList.remove('outline-navigation'), true);
  for (const name of ['mouseover', 'focusin']) root.addEventListener(name, event => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor && root.contains(anchor)) previewLink(anchor, event, getDocument()?.key);
  });
  root.addEventListener('mousemove', event => {
    if (linkAnchor?.contains(event.target)) {
      linkPoint = { x: event.clientX, y: event.clientY };
      positionLinkPreview();
    }
  });
  for (const name of ['mouseout', 'focusout']) root.addEventListener(name, event => {
    if (linkAnchor?.contains(event.target) && !linkAnchor.contains(event.relatedTarget)) clearLinkPreview();
  });
  root.addEventListener('scroll', clearLinkPreview, { passive: true });
  window.addEventListener('blur', clearLinkPreview);
  window.addEventListener('resize', clearLinkPreview);
  root.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor && root.contains(anchor)) {
      event.preventDefault(); event.stopImmediatePropagation(); hideFloatingMenu(viewEngine); clearLinkPreview();
      activateLink({ href: anchor.getAttribute('href'), fromKey: getDocument()?.key }, side);
    } else root.parentElement.classList.remove('outline-navigation');
  }, true);
  const popover = viewEngine.vditor.wysiwyg.popover;
  let scheduled = false;
  const place = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (getComputedStyle(popover).display === 'none') return;
      const selection = getSelection();
      const element = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
      const block = element?.closest('table,h1,h2,h3,h4,h5,h6,blockquote,pre');
      if (!block || !root.contains(block)) return;
      const pane = root.getBoundingClientRect();
      const parent = root.parentElement.getBoundingClientRect();
      const anchor = block.getBoundingClientRect();
      const menu = popover.getBoundingClientRect();
      let top = anchor.top - menu.height - 8;
      if (top < pane.top + 8) top = (element.closest('tr') || block).getBoundingClientRect().bottom + 8;
      top = Math.max(pane.top + 8, Math.min(top, pane.bottom - menu.height - 8));
      const left = Math.max(pane.left + 8, Math.min(anchor.left, pane.right - menu.width - 8));
      const nextTop = top - parent.top; const nextLeft = left - parent.left;
      if (Math.abs(parseFloat(popover.style.top) - nextTop) > .5 || !popover.style.top) popover.style.top = `${nextTop}px`;
      if (Math.abs(parseFloat(popover.style.left) - nextLeft) > .5 || !popover.style.left) popover.style.left = `${nextLeft}px`;
    });
  };
  new MutationObserver(place).observe(popover, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
  new ResizeObserver(place).observe(popover);
  root.addEventListener('scroll', place);
  window.addEventListener('resize', place);
}
engine = new Vditor('rich', {
  cdn, lang: 'zh_CN', mode: 'wysiwyg', height: '100%', icon: '',
  value: sample, cache: { enable: false }, undoDelay: 200,
  link: { isOpen: false },
  toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', '|', 'quote', 'line', 'inline-code', 'code', 'link', 'table'],
  preview: {
    mode: 'editor', hljs: { enable: false }, actions: [],
    markdown: { codeBlockPreview: false, mathBlockPreview: false, inlineMath: false, autoSpace: false, fixTermTypo: false },
  },
  input: () => { if (!loading && !composing && mode === 'visual') { richDirty = true; capture(); updateUI(); } },
  after: () => {
    render(); bindEditorControls();
    secondary = new SecondaryPane({
      cdn, getDocument: key => documents.find(item => item.key === key),
      onFocus: () => focusPane('right'),
      onChange: item => { if (doc()?.key === item.key) render({ focus: false }); else updateUI(); },
      onState: updateUI, onError: showError,
      onReady: (root, viewEngine) => bindEditorControls(root, viewEngine, () => secondary.document, 'right'),
    });
    secondary.ready.then(async () => {
      incomingReady = true;
      if (startup.drafts.length) {
        $('recovery-message').textContent = `上次留下了 ${startup.drafts.length} 篇未保存的文档，是否恢复？`;
        $('recovery-dialog').showModal();
      } else if (startup.recoveryError) showError(new Error(startup.recoveryError));
      await drainOpenFiles();
      resolveReady();
    });
  },
});

window.startupSmokeCheck = async () => {
  const checks = [], check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  check('正常启动显示空状态并隐藏验证示例', documents.length === 0 && !$('empty-state').hidden && $('examples-section').hidden);
  newDocument(); setMode('source');
  source.value = '# 正常启动写作\n'; source.dispatchEvent(new InputEvent('input', { bubbles: true }));
  check('正常启动路径可新建并保存文档', await saveDocument() && !isDirty(doc()));
  check('保存结果实际可重新打开', (await window.workspaceFiles.inspect(doc().file.key)).content === '# 正常启动写作\n');
  return { checks };
};

window.prepareRecoveryCheck = async () => {
  await chooseFolder(); await openWorkspaceFile('README.MD'); setMode('source');
  source.value += '\n已命名文档的跨进程草稿\n'; source.dispatchEvent(new InputEvent('input', { bubbles: true }));
  newDocument(); setMode('source');
  source.value = '# 未命名跨进程恢复\n'; source.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await flushRecovery(); return { prepared: true };
};
window.verifyRecoveryCheck = async () => {
  const checks = [], check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  check('重新启动进程后主动提示恢复未保存文档', $('recovery-dialog').open && startup.drafts.length === 2);
  $('recovery-restore').click();
  const named = documents.find(item => item.history.current.markdown.includes('已命名文档的跨进程草稿'));
  const untitled = documents.find(item => item.history.current.markdown.includes('未命名跨进程恢复'));
  check('恢复有名和未命名文档，保留未保存状态', named && untitled && isDirty(named) && isDirty(untitled));
  check('恢复不会擅自改写原磁盘文件', named && !(await window.workspaceFiles.inspect(named.file.key)).content.includes('跨进程草稿'));
  check('跨进程恢复后的两篇文档都能继续保存', named && untitled && await saveDocument(named) && await saveDocument(untitled));
  return { checks };
};

window.runPrototypeChecks = async () => {
  let fixtureScope;
  const openFixtureFile = id => openWorkspaceFile(id, 'left', fixtureScope);
  const checks = [];
  const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  check('真实可视编辑区域已载入', richRoot().isContentEditable);
  check('本地工具栏图标正常载入', document.getElementById('vditor-icon-bold'));
  check('标题、粗体和表格由编辑器实际渲染', richRoot().querySelector('h1') && richRoot().querySelector('strong') && richRoot().querySelectorAll('table td').length === 6);
  const original = doc().history.current.markdown;
  setMode('source');
  check('进入源码模式不改写正文', source.value === original);
  setMode('visual');
  check('无编辑往返不改写正文', doc().history.current.markdown === original);

  // 用实际 contenteditable 输入通道编辑，而不是只操作历史模型。
  const paragraph = [...richRoot().querySelectorAll('p')].find(node => node.textContent.includes('这是一份'));
  const range = document.createRange();
  range.selectNodeContents(paragraph); range.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  document.execCommand('insertText', false, '中文编辑验证');
  await sleep(350);
  capture();
  const richVersion = doc().history.current.markdown;
  check('可视编辑真实输入进入共享文档', richVersion.includes('中文编辑验证'));
  setMode('source');
  source.value += '\n源码追加内容\n';
  source.setSelectionRange(source.value.length, source.value.length);
  source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '源码追加内容' }));
  const sourceVersion = doc().history.current.markdown;
  setMode('visual');
  check('源码修改显示于可视编辑区域', richRoot().textContent.includes('源码追加内容'));
  undo(); check('跨模式撤销源码编辑', doc().history.current.markdown === richVersion);
  undo(); check('继续撤销可视编辑', doc().history.current.markdown === original);
  redo(); redo(); check('跨模式重做两次编辑', doc().history.current.markdown === sourceVersion);
  undo();
  setMode('source');
  source.value += '\n分支修改\n'; source.dispatchEvent(new InputEvent('input', { bubbles: true }));
  check('撤销后新编辑清除旧重做分支', !doc().history.canRedo);
  selectDocument(1); selectDocument(0);
  check('标签页切换保留修改', doc().history.current.markdown.includes('分支修改'));

  selectDocument(1); setMode('visual');
  const output = engine.getValue();
  const mermaidRaw = '~~~mermaid\nflowchart LR\n  A[开始] --> B[完成]  \n~~~';
  const mathRaw = '$$\nx  =  y + 1  \n$$';
  const observations = {
    nativeMermaidPreservedExactly: output.includes(mermaidRaw),
    nativeMathPreservedExactly: output.includes(mathRaw),
    nativeRoundTrip: output,
    caretMapping: '仅为普通段落的文本定位；重复文本、复杂格式和完整选区尚未验证',
    chineseIME: '实际中文输入法的候选、组合及撤销行为尚需人工验证；自动检查仅覆盖中文文本输入',
  };
  const ordinary = [...richRoot().querySelectorAll('p')].find(node => node.textContent.includes('编辑这一段'));
  const compatibilityRange = document.createRange();
  compatibilityRange.selectNodeContents(ordinary); compatibilityRange.collapse(false);
  getSelection().removeAllRanges(); getSelection().addRange(compatibilityRange);
  document.execCommand('insertText', false, '追加正文');
  await sleep(350); capture();
  check('编辑普通正文成功，原始 Mermaid 围栏和行尾空格保留', doc().history.current.markdown.includes('追加正文') && doc().history.current.markdown.includes(mermaidRaw));
  check('编辑普通正文后，公式片段原样保留', doc().history.current.markdown.includes(mathRaw));
  setMode('source'); setMode('visual');
  check('有保护片段时跨模式往返保持原文', doc().history.current.markdown.includes(mermaidRaw) && doc().history.current.markdown.includes(mathRaw));
  check('普通代码块内的公式示例不被当作独立公式', protectedBlocks('```text\n$$\nx=1\n$$\n```').length === 0);
  const beforeRemoval = doc().history.current.markdown;
  richRoot().querySelector('code.language-mermaid').closest('.vditor-wysiwyg__block').remove();
  richRoot().dispatchEvent(new InputEvent('input', { bubbles: true })); capture();
  check('可视模式删除保护片段时保留原文并提示源码编辑', doc().history.current.markdown === beforeRemoval && $('status').textContent.includes('源码模式'));
  selectDocument(2);
  const start = performance.now(); render();
  const renderCallMilliseconds = Math.round(performance.now() - start);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  observations.textSample = { characters: suggestedScale.length, renderCallMilliseconds, scope: '已载入编辑器的同步渲染调用，仅文字样本，非首次打开、输入延迟或完整性能验收' };
  selectDocument(0);
  documents[0].history = new DocumentHistory(sample);
  mode = 'visual'; render();
  await sleep(350);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check('验证结束已恢复干净的示例文档', doc().history.current.markdown === sample && !richRoot().textContent.includes('中文编辑验证'));
  await chooseFolder(); fixtureScope = rootFolder.path;
  const listed = [...$('file-tree').querySelectorAll('[data-file-id]')].map(button => button.dataset.fileId);
  check('真实目录列出 Markdown、TXT、代码、未知扩展名及无扩展名文本', ['README.MD', 'notes.txt', 'main.js', 'custom.xyz', 'LICENSE'].every(id => listed.includes(id)));
  check('二进制文件不会作为文本列出', !listed.includes('image.bin'));
  const nested = $('file-tree').querySelector('[data-directory-id="nested"]');
  nested.open = true;
  for (let i = 0; i < 40 && !nested.querySelector('[data-file-id]'); i++) await sleep(25);
  check('展开真实子文件夹后列出文本文件', nested.querySelector('[data-file-id="nested/说明.txt"]'));
  await openFixtureFile('README.MD');
  check('Markdown 文件首次打开默认可视编辑，大小写扩展名均识别', doc().kind === 'markdown' && mode === 'visual' && richRoot().querySelector('h1')?.textContent === '文件夹里的 Markdown');
  const markdownIndex = activeIndex;
  const count = documents.length;
  await openFixtureFile('README.MD');
  check('重复点击真实文件复用标签页', documents.length === count);
  await openFixtureFile('notes.txt');
  const textIndex = activeIndex;
  check('TXT 使用纯文本，Markdown 标记保持字面显示', mode === 'text' && source.value === '# 纯文本标题\n**不是加粗**\n' && $('rich').hidden && $('mode-controls').hidden);
  capture();
  check('仅查看 CRLF 文本不会产生修改或改变换行', !doc().history.canUndo && doc().history.current.markdown === '# 纯文本标题\r\n**不是加粗**\r\n');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true, bubbles: true }));
  check('纯文本文件不能误切为 Markdown 编辑', mode === 'text');
  source.value += '本次窗口中的修改\n';
  source.setSelectionRange(source.value.length, source.value.length);
  source.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const textEdited = doc().history.current.markdown;
  undo(); check('纯文本编辑可撤销且保留原始换行', doc().history.current.markdown === '# 纯文本标题\r\n**不是加粗**\r\n');
  redo(); check('纯文本编辑可重做', doc().history.current.markdown === textEdited);
  selectDocument(markdownIndex); selectDocument(textIndex);
  check('两类标签页切换保留纯文本模式与修改', mode === 'text' && source.value.includes('本次窗口中的修改'));
  await refreshFolder();
  check('刷新目录保留已打开的文档和修改', mode === 'text' && doc().history.current.markdown === textEdited && $('file-tree').querySelector('[data-file-id="main.js"]'));
  await openFixtureFile('main.js');
  check('代码文件按普通文本显示，不经过 Markdown 排版', mode === 'text' && source.value.includes('"**不渲染**"') && $('outline').textContent.includes('纯文本文件'));
  await openFixtureFile('page.html');
  check('HTML 文件仅按文本显示，不执行其中的脚本', mode === 'text' && source.value.startsWith('<script>') && !window.__fileExecuted);
  await openFixtureFile('custom.xyz');
  check('未知扩展名的可解码文本可以打开', mode === 'text' && source.value.includes('不依赖文本扩展名'));
  await openFixtureFile('LICENSE');
  check('无扩展名的文本可以打开', mode === 'text' && source.value.includes('无扩展名'));
  await openFixtureFile('nested/说明.txt');
  check('UTF-16 中文文本可正常读取且移除编码标记', source.value === '带 BOM 的中文文本\n' && doc().file.encoding === 'utf-16le');
  await openFixtureFile('legacy.txt');
  check('GBK 兼容文本可正常读取', source.value === '中文\n' && doc().file.encoding === 'gb18030');
  check('读取接口拒绝二进制内容', (await window.workspaceFiles.read('image.bin'))?.error);
  check('读取接口限制在所选文件夹内', (await window.workspaceFiles.read('../outside.txt'))?.error);
  await openFixtureFile('README.MD');
  await sleep(250);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { versions: { vditor: engine.version, chromium: navigator.userAgent }, checks, observations };
};
