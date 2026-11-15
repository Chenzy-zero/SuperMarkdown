import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting, HighlightStyle, LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';

const colors = HighlightStyle.define([
  { tag: tags.keyword, class: 'tok-keyword' }, { tag: [tags.string, tags.regexp], class: 'tok-string' },
  { tag: tags.comment, class: 'tok-comment' }, { tag: [tags.number, tags.bool, tags.null], class: 'tok-number' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-function' },
  { tag: [tags.typeName, tags.className], class: 'tok-type' }, { tag: tags.propertyName, class: 'tok-property' },
  { tag: [tags.heading, tags.strong], class: 'tok-keyword' },
]);

export function attach(host) {
  const language = new Compartment(), theme = new Compartment(), wrapping = new Compartment();
  let quiet = false, context = '', sequence = 0, batch = false;
  const notify = () => host.dispatchEvent(new CustomEvent('editor-state', { bubbles: true }));
  const view = new EditorView({ parent: host, state: EditorState.create({ extensions: [
    EditorState.allowMultipleSelections.of(true), lineNumbers(), drawSelection(), highlightActiveLine(), bracketMatching(),
    keymap.of([{ key: 'Escape', run: () => { if (!batch && view.state.selection.ranges.length === 1) return false; cancel(); return true; } }, ...defaultKeymap, indentWithTab]),
    syntaxHighlighting(colors), language.of([]), wrapping.of([]), theme.of(EditorView.theme({}, { dark: false })),
    EditorView.updateListener.of(update => {
      if (update.docChanged && !quiet) host.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: view.composing }));
      if (update.selectionSet) notify();
    }),
  ] }) });
  function cancel() {
    batch = false; host.dispatchEvent(new Event('editor-batch-boundary', { bubbles: true }));
    view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) }); notify();
  }
  // 视图适配保留应用的文档历史与保存路径；程序赋值不产生用户输入记录。
  Object.defineProperties(host, {
    value: { get: () => view.state.doc.toString(), set(value) {
      const normalized = String(value).replace(/\r\n?/g, '\n');
      if (normalized === view.state.doc.toString()) return;
      quiet = true; batch = false;
      try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: normalized }, selection: { anchor: 0 } }); }
      finally { quiet = false; }
    } },
    selectionStart: { get: () => view.state.selection.main.from }, selectionEnd: { get: () => view.state.selection.main.to },
    scrollTop: { get: () => view.scrollDOM.scrollTop, set: value => { view.scrollDOM.scrollTop = value; } },
  });
  host.setSelectionRange = (from, to) => view.dispatch({ selection: { anchor: Math.min(from, view.state.doc.length), head: Math.min(to, view.state.doc.length) } });
  host.focus = () => view.focus();
  const appearance = () => view.dispatch({ effects: theme.reconfigure(EditorView.theme({}, { dark: ['dark', 'gray'].includes(document.documentElement.dataset.theme) })) });
  new MutationObserver(appearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(() => { if (host.hidden && batch) cancel(); view.contentDOM.setAttribute('aria-label', host.getAttribute('aria-label') || '文本编辑器'); view.requestMeasure(); }).observe(host, { attributes: true, attributeFilter: ['hidden', 'class', 'aria-label'] });
  appearance();
  host.codeEditor = {
    view, cancel, get batch() { return batch; }, get cursors() { return view.state.selection.ranges.length; },
    toggleLineTyping() {
      if (batch) { cancel(); view.focus(); return; }
      const doc = view.state.doc, starts = new Set();
      for (const range of view.state.selection.ranges) {
        const first = doc.lineAt(range.from).number;
        const last = doc.lineAt(range.to > range.from && doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to).number;
        for (let line = first; line <= last; line++) starts.add(doc.line(line).from);
      }
      batch = true; view.dispatch({ selection: EditorSelection.create([...starts].sort((a,b) => a-b).map(at => EditorSelection.cursor(at))) });
      view.focus(); notify();
    },
    async setContext(item) {
      const next = `${item?.key}:${item?.name}`;
      if (next === context) return;
      context = next; batch = false; const request = ++sequence;
      view.dispatch({ effects: [language.reconfigure([]), wrapping.reconfigure(item?.kind === 'markdown' ? EditorView.lineWrapping : [])] });
      const description = item && LanguageDescription.matchFilename(languages, item.name);
      if (description) {
        const support = await description.load();
        if (request === sequence) view.dispatch({ effects: language.reconfigure(support) });
      }
    },
  };
  return host.codeEditor;
}
