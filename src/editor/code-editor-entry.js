import { MergeView } from '@codemirror/merge';
import formats from '../app/encoding-formats.json';
export { formats };
import { EditorState, EditorSelection, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, Decoration } from '@codemirror/view';
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

// 只更新 CodeMirror 视图装饰；不派发 docChanged，也不写入应用文档历史。
const searchDecorationEffect = StateEffect.define();
const searchDecorations = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    if (transaction.docChanged) decorations = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(searchDecorationEffect)) decorations = effect.value;
    }
    return decorations;
  },
  provide: field => EditorView.decorations.from(field),
});

export function attach(host) {
  const language = new Compartment(), theme = new Compartment(), wrapping = new Compartment();
  let quiet = false, context = '', sequence = 0, batch = false;
  const notify = () => host.dispatchEvent(new CustomEvent('editor-state', { bubbles: true }));
  const view = new EditorView({ parent: host, state: EditorState.create({ extensions: [
    EditorState.allowMultipleSelections.of(true), lineNumbers(), drawSelection(), highlightActiveLine(), bracketMatching(), searchDecorations,
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
  document.addEventListener('reading-zoom-change', () => view.requestMeasure());
  appearance();
  host.codeEditor = {
    view, cancel, get batch() { return batch; }, get cursors() { return view.state.selection.ranges.length; },
    setSearchHighlights(matches, currentIndex = -1) {
      const max = view.state.doc.length;
      const marks = (matches || []).flatMap((match, index) =>
        match.from >= 0 && match.to > match.from && match.to <= max
          ? [Decoration.mark({ class: index === currentIndex ? 'cm-find-current' : 'cm-find-match' }).range(match.from, match.to)]
          : []);
      view.dispatch({ effects: searchDecorationEffect.of(Decoration.set(marks, true)) });
    },
    navigateSearch(from, to) {
      const max = view.state.doc.length;
      if (from < 0 || to > max || from >= to) return;
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      });
    },
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

// 比较使用只读快照，不与文档的保存基线、撤销或编辑视图互相覆盖。
export function compare(parent, left, right) {
  const state = item => ({ doc: item.history.current.markdown.replace(/\r\n?/g, '\n'), extensions: [
    EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), drawSelection(),
    EditorView.theme({}, { dark: ['dark', 'gray'].includes(document.documentElement.dataset.theme) }),
    EditorView.contentAttributes.of({ 'aria-label': `比较文档 ${item.name}`, tabindex: '0' }),
  ] });
  const merge = new MergeView({ parent, a: state(left), b: state(right), highlightChanges: true, gutter: true,
    diffConfig: { scanLimit: 2000, timeout: 1200 } });
  const describe = (view, item) => {
    const language = LanguageDescription.matchFilename(languages, item.name);
    if (language) language.load().then(support => { if (merge.dom.isConnected) view.dispatch({ effects: StateEffect.appendConfig.of([support, syntaxHighlighting(colors)]) }); }).catch(() => {});
  };
  describe(merge.a, left); describe(merge.b, right);
  return { get chunks() { return merge.chunks; },
    navigate(index) {
      const chunk = merge.chunks[index]; if (!chunk) return;
      for (const [view, at] of [[merge.a, chunk.fromA], [merge.b, chunk.fromB]]) {
        const position = Math.min(at, view.state.doc.length);
        view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) });
      }
    },
    destroy: () => merge.destroy(),
  };
}
