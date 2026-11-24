import { findMatches } from './find-matches.mjs';
import { replaceAt, replaceAllLiteral } from './replace-text.mjs';

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

export function bindFindPanel({ getContext, prepareReplace, applyReplace, onError }) {
  const $ = id => document.getElementById(id);
  const panel = $('find-panel'), input = $('find-input'), summary = $('find-summary');
  const prevButton = $('find-prev'), nextButton = $('find-next');
  const matchCase = $('find-case');
  const replaceRow = $('replace-row'), replaceInput = $('replace-input');
  const replaceOne = $('replace-one'), replaceAll = $('replace-all'), replaceNote = $('replace-note');
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
        const validRanges = ranges.filter(Boolean);
        if (validRanges.length) CSS.highlights.set(ALL_MARKS, new Highlight(...validRanges));
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
    replaceOne.disabled = replaceAll.disabled = !matches.length || context?.mode === 'visual';
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

  function open({ replace = false } = {}) {
    if (document.querySelector('dialog[open]')) return;
    // 可视 DOM 的查找偏移不能直接用于修改 Markdown 源码。
    // 先切换到源码视图后再启用替换，避免损坏表格、链接和格式标记。
    if (replace && !prepareReplace?.()) return;
    replaceRow.hidden = !replace;
    replaceNote.textContent = replace
      ? '替换作用于当前文档的 Markdown 源码或纯文本；仅修改内存，按 Ctrl+S 保存。'
      : '';
    panel.hidden = false;
    update({ force: true, scroll: true });
    input.focus(); input.select();
  }

  function runReplace(all = false) {
    if (panel.hidden || replaceRow.hidden || document.querySelector('dialog[open]')) return;
    if (!prepareReplace?.()) return;
    // 点击按钮前强制更新：不会用过期的匹配位置修改已经变化的文档。
    update({ force: true });
    const target = getContext();
    const sourceText = target?.source?.value;
    if (!target || target.mode === 'visual' || typeof sourceText !== 'string' || !input.value || !matches.length) return;
    const replacement = replaceInput.value.replace(/\r\n?/g, '\n');
    try {
      const result = all
        ? replaceAllLiteral(sourceText, input.value, replacement, { caseSensitive: matchCase.checked })
        : replaceAt(sourceText, matches[index], replacement);
      if (!result.count || result.text === sourceText) {
        replaceNote.textContent = '替换后没有内容变化。';
        return;
      }
      const applied = applyReplace?.({
        key: target.key, side: target.side, expected: sourceText,
        text: result.text, caret: result.caret,
      });
      if (!applied) {
        replaceNote.textContent = '文档状态已变化，请重新查找后再试。';
        refresh(true);
        return;
      }
      update({ force: true });
      if (matches.length) {
        const next = matches.findIndex(match => match.from >= result.caret);
        index = next < 0 ? 0 : next;
        paint(); status(); scrollCurrent();
      }
      replaceNote.textContent = '已替换 ' + result.count + ' 处（可用 Ctrl+Z 撤销）。';
      input.focus();
    } catch (error) {
      replaceNote.textContent = error.message || '替换失败。';
      onError(error);
    }
  }

  function close({ returnFocus = true } = {}) {
    clearTimeout(timer); timer = null;
    panel.hidden = true;
    clearMarks();
    context = null; matches = []; ranges = [];
    lastIdentity = '';
    if (returnFocus) getContext()?.focus?.();
  }

  input.addEventListener('input', () => { replaceNote.textContent = ''; refresh(); });
  matchCase.addEventListener('change', () => refresh());
  replaceOne.onclick = () => runReplace(false);
  replaceAll.onclick = () => runReplace(true);
  prevButton.onclick = () => navigate(-1);
  nextButton.onclick = () => navigate(1);
  $('find-close').onclick = () => close();
  replaceInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Enter') { event.preventDefault(); runReplace(event.ctrlKey || event.metaKey); }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      && ['f', 'h'].includes(event.key.toLowerCase())) {
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      open({ replace: event.key.toLowerCase() === 'h' });
    } else if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    }
  }, true);
  return { open, openReplace: () => open({ replace: true }), close, refresh, get isOpen() { return !panel.hidden; } };
}
