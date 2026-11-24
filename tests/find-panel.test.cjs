const test = require('node:test');
const assert = require('node:assert/strict');

function element({ value = '', checked = false, hidden = false } = {}) {
  const handlers = new Map();
  return {
    value, checked, hidden, disabled: false, textContent: '', focusCount: 0,
    addEventListener(type, fn) {
      const group = handlers.get(type) || [];
      group.push(fn); handlers.set(type, group);
    },
    emit(type, event = {}) {
      const enriched = {
        key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...event,
      };
      for (const fn of handlers.get(type) || []) fn(enriched);
    },
    focus() { this.focusCount++; },
    select() {},
  };
}

test('Ctrl+F 的本地查找、前后导航、大小写、关闭及文件切换不修改文档', async () => {
  const ids = ['find-panel', 'find-input', 'find-summary', 'find-prev', 'find-next', 'find-case', 'find-close', 'replace-row', 'replace-input', 'replace-one', 'replace-all', 'replace-note'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes['find-panel'].hidden = true;
  const events = new Map();
  const priorDocument = globalThis.document, priorCSS = globalThis.CSS;
  globalThis.document = {
    getElementById: id => nodes[id],
    querySelector: () => null,
    addEventListener(type, fn) {
      const list = events.get(type) || [];
      list.push(fn); events.set(type, list);
    },
  };
  globalThis.CSS = { highlights: { delete() {}, set() {} } };

  const jumps = [], marks = [];
  let sourceFocus = 0;
  const firstSource = {
    value: 'abc 中文 ABC',
    codeEditor: {
      setSearchHighlights: (matches, current) => marks.push({ count: matches.length, current }),
      navigateSearch: (from, to) => jumps.push([from, to]),
    },
  };
  let active = {
    key: 'doc-1', side: 'left', mode: 'source',
    source: firstSource, focus: () => { sourceFocus++; },
  };

  try {
    const { bindFindPanel } = await import('../src/app/find-panel.mjs');
    const find = bindFindPanel({ getContext: () => active, onError: error => { throw error; } });
    const keydown = event => events.get('keydown').forEach(listener => listener(event));
    keydown({
      key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false,
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(find.isOpen, true);
    assert.equal(nodes['find-input'].focusCount, 1);

    nodes['find-input'].value = 'abc';
    nodes['find-input'].emit('input');
    nodes['find-input'].emit('keydown', { key: 'Enter', isComposing: true });
    assert.equal(jumps.length, 0);
    nodes['find-input'].emit('keydown', { key: 'Enter' });
    assert.equal(nodes['find-summary'].textContent, '2 / 2');
    assert.deepEqual(jumps.at(-1), [7, 10]);

    nodes['find-input'].emit('keydown', { key: 'Enter', shiftKey: true });
    assert.equal(nodes['find-summary'].textContent, '1 / 2');
    assert.deepEqual(jumps.at(-1), [0, 3]);

    nodes['find-case'].checked = true;
    nodes['find-case'].emit('change');
    nodes['find-input'].emit('keydown', { key: 'Enter' });
    assert.equal(nodes['find-summary'].textContent, '1 / 1');
    assert.equal(firstSource.value, 'abc 中文 ABC');
    assert.equal(marks.some(mark => mark.count === 2), true);

    active = {
      key: 'doc-2', side: 'left', mode: 'source',
      source: { value: '另一个文档', codeEditor: { setSearchHighlights() {}, navigateSearch() {} } },
      focus: () => { sourceFocus++; },
    };
    find.refresh(true);
    await new Promise(resolve => setTimeout(resolve, 125));
    assert.equal(nodes['find-summary'].textContent, '0 处匹配');

    nodes['find-input'].emit('keydown', { key: 'Escape' });
    assert.equal(find.isOpen, false);
    assert.equal(sourceFocus, 1);
    assert.equal(firstSource.value, 'abc 中文 ABC');
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorCSS === undefined) delete globalThis.CSS; else globalThis.CSS = priorCSS;
  }
});

test('查找工具条 hidden 属性不会被 display:flex 覆盖', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../src/app/style.css'), 'utf8');
  assert.match(css, /\.find-panel\[hidden\]\s*\{\s*display:\s*none\s*;/);
});


test('Ctrl+H 在源码模式替换一次或全部，保留 Ctrl+F 查找且不直接写入磁盘', async () => {
  const ids = ['find-panel', 'find-input', 'find-summary', 'find-prev', 'find-next',
    'find-case', 'find-close', 'replace-row', 'replace-input', 'replace-one', 'replace-all', 'replace-note'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes['find-panel'].hidden = true;
  nodes['replace-row'].hidden = true;
  const listeners = new Map();
  const priorDocument = globalThis.document, priorCSS = globalThis.CSS;
  globalThis.document = {
    getElementById: id => nodes[id],
    querySelector: () => null,
    addEventListener(type, fn) {
      const group = listeners.get(type) || [];
      group.push(fn); listeners.set(type, group);
    },
  };
  globalThis.CSS = { highlights: { delete() {}, set() {} } };
  const source = {
    value: 'abc ABC abc',
    codeEditor: { setSearchHighlights() {}, navigateSearch() {} },
  };
  const results = [];
  let prepared = 0;
  let focusCount = 0;
  try {
    const { bindFindPanel } = await import('../src/app/find-panel.mjs');
    const panel = bindFindPanel({
      getContext: () => ({ key: 'document-a', side: 'left', mode: 'source', source,
        focus: () => focusCount++ }),
      prepareReplace: () => { prepared++; return true; },
      applyReplace: args => {
        if (args.expected !== source.value) return false;
        results.push(args);
        source.value = args.text;
        return true;
      },
      onError: error => { throw error; },
    });
    const shortcut = (key, extra = {}) =>
      listeners.get('keydown').forEach(fn => fn({
        key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
        isComposing: false, preventDefault() {}, stopImmediatePropagation() {}, ...extra,
      }));
    shortcut('h');
    assert.equal(panel.isOpen, true);
    assert.equal(nodes['replace-row'].hidden, false);
    assert.equal(prepared, 1);

    nodes['find-input'].value = 'abc';
    nodes['replace-input'].value = '    nodes['replace-input'].value = '$&';
    nodes['replace-all'].onclick();';
    // 中文拼音候选上屏时 Enter 不能误触发替换。
    nodes['replace-input'].emit('keydown', { key: 'Enter', isComposing: true });
    nodes['replace-input'].emit('keydown', { key: 'Enter', keyCode: 229 });
    assert.equal(results.length, 0);
    nodes['replace-all'].onclick();
    assert.equal(source.value, '$& $& $&');
    assert.equal(results[0].expected, 'abc ABC abc');
    assert.equal(results[0].text, '$& $& $&');
    assert.equal(nodes['replace-note'].textContent.includes('3 处'), true);

    source.value = 'abc abc';
    nodes['find-input'].emit('input');
    nodes['replace-input'].value = 'X';
    nodes['replace-one'].onclick();
    assert.equal(source.value, 'X abc');
    assert.equal(results.at(-1).text, 'X abc');

    shortcut('f');
    assert.equal(panel.isOpen, true);
    assert.equal(nodes['replace-row'].hidden, true);
    assert.equal(source.value, 'X abc');
    nodes['find-input'].emit('keydown', { key: 'Escape' });
    assert.equal(panel.isOpen, false);
    assert.equal(focusCount, 1);
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorCSS === undefined) delete globalThis.CSS; else globalThis.CSS = priorCSS;
  }
});

test('替换栏的 hidden 状态不会被 flex 样式覆盖', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../src/app/style.css'), 'utf8');
  assert.match(css, /\.replace-row\[hidden\]\s*\{\s*display:\s*none\s*;/);
});
