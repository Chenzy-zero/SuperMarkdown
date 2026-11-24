import { bindReadingZoom } from './reading-zoom.mjs';
import { bindIcons } from './icons.mjs';
export function bindWorkbench({ preferences, setMode, setLayout, getEditor, getDocument, getMode, getLayout, closeCurrent, compareFiles, canCompare, findCurrent, onError }) {
  const $ = id => document.getElementById(id), menu = $('app-menu');
  let currentMenu = null;
  const settings = { theme: 'light', sidebar: 'files', readingZoom: 100, ...preferences };
  const persist = () => window.workspaceFiles.preferences(settings).then(result => { if (result?.error) throw new Error(result.error); }).catch(onError);
  bindIcons();
  const zoom = bindReadingZoom({ initial: settings.readingZoom, save: value => { settings.readingZoom = value; persist(); } });
  const applyTheme = () => { document.documentElement.dataset.theme = settings.theme; };
  function sidebar(value, save = true) {
    settings.sidebar = value; document.querySelector('aside').hidden = value === 'hidden';
    if (value !== 'hidden') {
      $('files').hidden = value !== 'files'; $('outline').hidden = value !== 'outline';
      $('files-tab').setAttribute('aria-selected', String(value === 'files')); $('outline-tab').setAttribute('aria-selected', String(value === 'outline'));
    }
    if (save) persist();
  }
  function lineTyping() {
    if (!getDocument()) return;
    if (getMode() === 'visual') { setMode('source'); $('line-typing-state').textContent = '请在源码区选中多行，再点击多行输入。'; return; }
    getDocument().history.closeGroup(); getEditor()?.toggleLineTyping(); update();
  }
  const click = id => () => $(id).click();
  const item = (text, run, checked = null, disabled = false) => ({ text, run, checked, disabled });
  function entries(key) {
    if (key === 'file') return [item('新建文档  Ctrl+N', click('new-document')), item('打开文件…  Ctrl+O', click('open-file')), item('打开文件夹…', click('choose-folder')), item('新建 Markdown…', click('new-markdown'), null, $('new-markdown').disabled), null, item('保存  Ctrl+S', click('save-file'), null, $('save-file').disabled), item('另存为…  Ctrl+Shift+S', click('save-as'), null, $('save-as').disabled), null, item('文件编码…', click('encoding-button'), null, $('encoding-button').disabled), item('关闭当前文档  Ctrl+W', closeCurrent, null, !getDocument())];
    if (key === 'edit') return [item('撤销  Ctrl+Z', click('undo'), null, $('undo').disabled), item('重做  Ctrl+Y', click('redo'), null, $('redo').disabled), null, item('查找当前文档  Ctrl+F', findCurrent, null, !getDocument()), null, item('多行同时输入 / 退出', lineTyping, getEditor()?.batch || false, !getDocument() || getLayout() === 'sync' && getMode() === 'visual')];
    if (key === 'view') return [item('放大正文', () => zoom.increase()), item('缩小正文', () => zoom.decrease()), item('恢复 100%  Ctrl+0', () => zoom.reset()), null, item('文件目录', () => sidebar('files'), settings.sidebar === 'files'), item('文档大纲', () => sidebar('outline'), settings.sidebar === 'outline'), item('隐藏侧栏', () => sidebar('hidden'), settings.sidebar === 'hidden'), null, item('可视编辑', () => setMode('visual'), getMode() === 'visual', getDocument()?.kind !== 'markdown' || getLayout() === 'sync'), item('源码模式  Ctrl+Shift+M', () => setMode('source'), getMode() === 'source', getDocument()?.kind !== 'markdown' || getLayout() === 'sync'), null, ...[['single', '单文件'], ['files', '双文件并排'], ['sync', '预览 + 源码同步']].map(([value,label]) => item(label, () => setLayout(value), getLayout() === value, value === 'sync' && getDocument()?.kind !== 'markdown')), null, item('比较左右文档', compareFiles, null, !canCompare())];
    return [['light', 'Codex 风格'], ['dark', 'Dark 深色'], ['cream', 'Anthropic 风格'], ['gray', '科技灰']].map(([value,label]) => ({ ...item(label, () => { settings.theme = value; applyTheme(); persist(); }, settings.theme === value), theme: value }));
  }
  function close() { menu.hidden = true; currentMenu?.setAttribute('aria-expanded', 'false'); currentMenu = null; }
  for (const button of document.querySelectorAll('[data-menu]')) {
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.onclick = () => {
      if (currentMenu === button && !menu.hidden) { close(); return; }
      close(); currentMenu = button; button.setAttribute('aria-expanded', 'true');
      menu.replaceChildren(...entries(button.dataset.menu).map(entry => {
        if (!entry) return document.createElement('hr');
        const node = document.createElement('button'); node.type = 'button'; node.setAttribute('role', entry.checked === null ? 'menuitem' : 'menuitemradio');
        if (entry.checked !== null) node.setAttribute('aria-checked', String(entry.checked));
        node.textContent = `${entry.checked ? '✓' : '　'}  ${entry.text}`; node.disabled = entry.disabled;
        if (entry.theme) node.dataset.themeOption = entry.theme;
        node.onpointerdown = event => event.preventDefault();
        node.onclick = () => { close(); entry.run(); }; return node;
      }));
      menu.hidden = false; const rect = button.getBoundingClientRect();
      menu.style.left = Math.min(rect.left, innerWidth - menu.offsetWidth - 8) + 'px'; menu.style.top = rect.bottom + 6 + 'px';
    };
    button.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); button.click(); menu.querySelector('button:not(:disabled)')?.focus(); } };
  }
  menu.onkeydown = event => {
    const nodes = [...menu.querySelectorAll('button:not(:disabled)')], index = nodes.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); nodes[(index + (event.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus(); }
    if (event.key === 'Escape') { const button = currentMenu; close(); button?.focus(); }
  };
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !event.target.closest('[data-menu]')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  window.addEventListener('resize', close);
  $('line-typing').onpointerdown = event => event.preventDefault(); $('line-typing').onclick = lineTyping;
  function update() {
    const editor = getEditor(), active = getMode() !== 'visual' && editor?.batch;
    $('line-typing').disabled = !getDocument() || getLayout() === 'sync' && getMode() === 'visual';
    $('line-typing').textContent = active ? `多行输入 · ${editor.cursors} 行 · Esc 退出` : '多行输入';
    $('line-typing').setAttribute('aria-pressed', String(Boolean(active)));
    $('line-typing-state').textContent = active ? `${editor.cursors} 行同时输入，Esc 退出` : '';
  }
  document.addEventListener('editor-state', update);
  for (const [id, value] of [['files-tab', 'files'], ['outline-tab', 'outline']]) $(id).addEventListener('click', () => sidebar(value));
  applyTheme(); sidebar(settings.sidebar, false); update();
  return { update, sidebar };
}
