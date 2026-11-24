import { findMatches } from './find-matches.mjs';

const ALL_MARKS = 'supermarkdown-find-all';
const CURRENT_MARK = 'supermarkdown-find-current';

// 只读取可视编辑器的文本节点，CSS Highlights 不改动 Vditor 的 DOM、撤销栈或 Markdown。
function collectVisualText(root) {
  const entries = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data || node.parentElement?.closest('script,style,[hidden],[aria-hidden="true"]')) continue;
    const from = text.length;
    text += node.data;
    entries.push({ node, from, to: text.length });
  }
  return { text, entries };
}

function nodeAt(entries, offset, end = false) {
  let lo = 0, hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, entry = entries[mid];
    if (offset < entry.from || (end && offset === entry.from && mid > 0)) hi = mid - 1;
    else if (offset >= entry.to && !(end && offset === entry.to)) lo = mid + 1;
    else return { node: entry.node, offset: Math.max(0, Math.min(entry.node.length, offset - entry.from)) };
  }
  return null;
}

function makeRange(entries, match) {
  const first = nodeAt(entries, match.from), last = nodeAt(entries, match.to, true);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
  return range;
}

export function bindFindPanel({ getContext, onError }) {
  const $ = id => document.getElementById(id);
  const panel = $('find-panel'), input = $('find-input'), summary = $('find-summary');
  const prevButton = $('find-prev'), nextButton = $('find-next');
  const matchCase = $('find-case');
  let matches = [], ranges = [], index = 0, context = null, timer = null, markedHost = null;
  let lastIdentity = '', lastQuery = '', lastText = '', lastCase = false, lastFirstNode = null;

  function clearMarks() {
    if (globalThis.CSS?.highlights) {
      CSS.highlights.delete(ALL_MARKS);
      CSS.highlights.delete(CURRENT_MARK);
    }
    markedHost?.codeEditor?.setSearchHighlights([], -1);
    markedHost = null;
  }

  function paint() {
    clearMarks();
    if (!context || !matches.length) return;
    if (context.mode === 'visual') {
      if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
      try {
        if (ranges.length) CSS.highlights.set(ALL_MARKS, new Highlight(...ranges));
        if (ranges[index]) CSS.highlights.set(CURRENT_MARK, new Highlight(ranges[index]));
      } catch (error) { onError(error); }
    } else {
      markedHost = context.source;
      markedHost?.codeEditor?.setSearchHighlights(matches, index);
    }
  }

  function status() {
    const hasDocument = Boolean(context?.key);
    const hasQuery = Boolean(input.value);
    summary.textContent = !hasDocument ? '没有打开的文档'
      : !hasQuery ? '输入关键词'
      : !matches.length ? '0 处匹配'
      : String(index + 1) + ' / ' + matches.length + (matches.length === 2000 ? '（仅前 2000 处）' : '');
    prevButton.disabled = nextButton.disabled = !matches.length;
  }

  function scrollCurrent() {
    const match = matches[index];
    if (!match || !context) return;
    if (context.mode !== 'visual') {
      context.source?.codeEditor?.navigateSearch(match.from, match.to);
      return;
    }
    const range = ranges[index], root = context.root;
    if (!range || !root) return;
    const rect = range.getBoundingClientRect(), area = root.getBoundingClientRect();
    if (rect.height) root.scrollTop += rect.top - area.top - area.height * .36;
  }

  function update({ force = false, scroll = false } = {}) {
    if (panel.hidden) return;
    clearTimeout(timer); timer = null;
    const next = getContext();
    const firstNode = next?.mode === 'visual' ? next.root?.firstChild : null;
    const snapshot = next?.mode === 'visual' && next.root ? collectVisualText(next.root) : null;
    const text = snapshot?.text ?? next?.source?.value ?? '';
    const identity = next ? next.key + ':' + next.side + ':' + next.mode : '';
    const query = input.value, sensitive = matchCase.checked;
    if (!force && identity === lastIdentity && query === lastQuery && sensitive === lastCase
      && text === lastText && firstNode === lastFirstNode) return;
    const changedQuery = identity !== lastIdentity || query !== lastQuery || sensitive !== lastCase;
    lastIdentity = identity; lastQuery = query; lastText = text;
    lastFirstNode = firstNode; lastCase = sensitive;
    context = next;
    matches = next ? findMatches(text, query, { caseSensitive: sensitive }) : [];
    index = changedQuery ? 0 : Math.min(index, Math.max(0, matches.length - 1));
    ranges = snapshot ? matches.map(match => makeRange(snapshot.entries, match)) : [];
    paint(); status();
    if (scroll || changedQuery) scrollCurrent();
  }

  function refresh(force = false) {
    if (panel.hidden) return;
    clearTimeout(timer);
    timer = setTimeout(() => update({ force }), 90);
  }

  function navigate(direction) {
    update();
    if (!matches.length) return;
    index = (index + direction + matches.length) % matches.length;
    paint(); status(); scrollCurrent();
  }

  function open() {
    if (document.querySelector('dialog[open]')) return;
    panel.hidden = false;
    update({ force: true, scroll: true });
    input.focus(); input.select();
  }

  function close({ returnFocus = true } = {}) {
    clearTimeout(timer); timer = null;
    panel.hidden = true;
    clearMarks();
    context = null; matches = []; ranges = [];
    lastIdentity = '';
    if (returnFocus) getContext()?.focus?.();
  }

  input.addEventListener('input', () => refresh());
  matchCase.addEventListener('change', () => refresh());
  prevButton.onclick = () => navigate(-1);
  nextButton.onclick = () => navigate(1);
  $('find-close').onclick = () => close();
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); open();
    } else if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }
  }, true);
  return { open, close, refresh, get isOpen() { return !panel.hidden; } };
}
