import { preserveProtectedBlocks } from './protected-blocks.mjs';
import { visualCaretToSource, renderedSelectionPrefix } from './markdown-caret.mjs';

// 第二个编辑视图只持有光标和滚动位置，文档及撤销记录仍由应用持有。
export class SecondaryPane {
  constructor({ getDocument, onFocus, onChange, onState, onReady, onError, cdn }) {
    Object.assign(this, { getDocument, onFocus, onChange, onState, onError });
    this.source = document.getElementById('right-source');
    this.states = new Map();
    this.key = null; this.mode = 'visual'; this.lastText = null;
    this.loading = false; this.composing = false; this.initialized = false;
    this.richDirty = false; this.sourceDirty = false;
    this.source.addEventListener('input', event => {
      if (event.target !== this.source) return;
      this.sourceDirty = true;
      if (!event.isComposing) this.capture();
    });
    this.source.addEventListener('focus', () => this.onFocus());
    let resolveReady;
    this.ready = new Promise(resolve => { resolveReady = resolve; });
    this.editor = new Vditor('right-rich', {
      cdn, lang: 'zh_CN', mode: 'wysiwyg', height: '100%', icon: '',
      value: '', cache: { enable: false }, undoDelay: 200, link: { isOpen: false },
      toolbar: ['headings', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', '|', 'quote', 'line', 'inline-code', 'code', 'link', 'table'],
      preview: { mode: 'editor', hljs: { enable: false }, actions: [], markdown: { codeBlockPreview: false, mathBlockPreview: false, inlineMath: false, autoSpace: false, fixTermTypo: false } },
      input: () => {
        if (this.loading || this.composing || this.mode !== 'visual' || !this.document) return;
        this.richDirty = true; this.capture();
      },
      after: () => {
        this.initialized = true;
        this.root.addEventListener('input', () => { if (!this.loading) this.richDirty = true; }, true);
        this.root.addEventListener('focus', () => this.onFocus());
        const container = document.getElementById('right-pane');
        container.addEventListener('compositionstart', () => { this.composing = true; });
        container.addEventListener('compositionend', () => { this.composing = false; setTimeout(() => this.capture(), 0); });
        onReady(this.root, this.editor);
        this.refresh({ force: true }); resolveReady();
      },
    });
  }

  get document() { return this.key ? this.getDocument(this.key) : null; }
  get root() { return this.editor.vditor.wysiwyg.element; }
  get state() {
    if (!this.states.has(this.key)) this.states.set(this.key, { caret: 0, scrollTop: 0, visualScrollTop: 0, mode: 'visual' });
    return this.states.get(this.key);
  }

  bind(key, forcedMode = null) {
    this.capture();
    const changed = key !== this.key;
    this.key = key;
    const item = this.document;
    this.mode = item?.kind === 'text' ? 'text' : forcedMode || this.state.mode;
    if (changed) this.lastText = null;
    this.refresh({ force: changed || this.renderedMode !== this.mode });
  }

  capture() {
    const item = this.document;
    if (!this.initialized || !item || this.loading || this.composing) return;
    let changed = false;
    if (this.mode !== 'visual') {
      const head = this.source.codeEditor?.view?.state?.selection?.main?.head ?? this.source.selectionStart;
      this.state.caret = this.source.value.slice(0, head).replace(/\n/g, item.lineEnding).length;
      this.state.scrollTop = this.source.scrollTop;
      if (this.sourceDirty) changed = item.history.record(this.source.value.replace(/\n/g, item.lineEnding), this.state.caret, 'right-source');
    } else {
      this.state.visualScrollTop = this.root.scrollTop;
      if (this.richDirty) {
        try {
          const markdown = preserveProtectedBlocks(item.history.current.markdown, this.editor.getValue()).replace(/\r?\n/g, item.lineEnding);
          const prefix = renderedSelectionPrefix(this.root, getSelection());
          const caret = prefix === null ? this.state.caret
            : visualCaretToSource(markdown, prefix, this.state.caret);
          changed = item.history.record(markdown, caret, 'right-visual');
          this.state.caret = caret;
        } catch (error) {
          this.richDirty = false; this.refresh({ force: true }); this.onError(error); return;
        }
      }
    }
    this.richDirty = false; this.sourceDirty = false;
    this.lastText = item.history.current.markdown;
    if (changed) this.onChange(item);
    this.onState();
  }

  refresh({ force = false, focus = false } = {}) {
    if (!this.initialized || this.composing) return;
    const item = this.document;
    this.source.codeEditor.setContext(item).catch(this.onError);
    document.getElementById('right-empty').hidden = Boolean(item);
    document.getElementById('right-pane-name').textContent = item ? `右侧 · ${item.name}${this.mode === 'source' ? ' · 源码' : this.mode === 'text' ? ' · 纯文本' : ''}` : '右侧';
    document.getElementById('right-rich').hidden = !item || this.mode !== 'visual';
    this.source.hidden = !item || this.mode === 'visual';
    this.source.classList.toggle('markdown-source', item?.kind === 'markdown');
    if (!item) { this.lastText = null; this.source.value = ''; return; }
    const value = item.history.current.markdown;
    if (!force && this.lastText === value && this.renderedMode === this.mode) { if (focus) this.focus(); return; }
    this.loading = true;
    if (this.mode === 'visual') {
      const wysiwyg = this.editor.vditor.wysiwyg;
      clearTimeout(wysiwyg.hlToolbarTimeoutId);
      wysiwyg.popover.style.display = 'none';
      this.root.parentElement.classList.add('outline-navigation');
      this.editor.setValue(value, true);
      this.root.querySelectorAll('code.language-mermaid,[data-type="math-block"]').forEach(node => (node.closest('.vditor-wysiwyg__block') || node).setAttribute('contenteditable', 'false'));
      this.root.scrollTop = this.state.visualScrollTop;
    } else {
      this.source.value = value;
      this.source.setAttribute('aria-label', this.mode === 'text' ? '右侧纯文本内容' : '右侧 Markdown 源码');
      const caret = value.slice(0, this.state.caret).replace(/\r\n/g, '\n').length;
      this.source.setSelectionRange(caret, caret);
      this.source.scrollTop = this.state.scrollTop;
    }
    this.lastText = value; this.renderedMode = this.mode;
    this.richDirty = false; this.sourceDirty = false; this.loading = false;
    if (focus) this.focus();
  }

  focus() {
    if (!this.document || !this.initialized) return;
    this.onFocus();
    if (this.mode === 'visual') this.editor.focus(); else this.source.focus();
  }

  setMode(mode) {
    if (this.document?.kind !== 'markdown' || mode === this.mode) return;
    this.capture(); this.document.history.closeGroup();
    this.mode = mode; this.state.mode = mode;
    this.refresh({ force: true, focus: true }); this.onState();
  }

  undoRedo(direction) {
    if (!this.document) return;
    this.capture(); this.document.history[direction]();
    this.state.caret = this.document.history.current.caret;
    this.refresh({ force: true, focus: true }); this.onChange(this.document);
  }

  jump(heading, sourceOffset = 0) {
    if (!this.document) return;
    if (this.mode !== 'visual') {
      this.source.focus(); this.source.setSelectionRange(sourceOffset, sourceOffset);
      this.source.scrollTop = this.document.history.current.markdown.slice(0, sourceOffset).split('\n').length * parseFloat(getComputedStyle(this.source).lineHeight) - 64;
    } else if (heading) {
      const wysiwyg = this.editor.vditor.wysiwyg;
      clearTimeout(wysiwyg.hlToolbarTimeoutId); wysiwyg.popover.style.display = 'none';
      this.root.parentElement.classList.add('outline-navigation');
      this.root.scrollTop += heading.getBoundingClientRect().top - this.root.getBoundingClientRect().top - 64;
    }
  }
}
