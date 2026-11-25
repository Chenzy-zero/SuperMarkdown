const test = require('node:test');
const assert = require('node:assert/strict');

function fixture({ dialog = false } = {}) {
  const listeners = new Map(), windowListeners = new Map();
  const makePane = id => ({
    id, hidden: false, dataset: {},
    classes: new Set(),
    classList: {
      add(value) { this.owner.classes.add(value); },
      remove(value) { this.owner.classes.delete(value); },
    },
  });
  const left = makePane('left-pane'), right = makePane('right-pane');
  left.classList.owner = left; right.classList.owner = right;
  const root = {
    querySelectorAll: () => [left, right],
    getElementById: id => id === 'left-pane' ? left : id === 'right-pane' ? right : null,
    querySelector: selector => selector === 'dialog[open]' && dialog ? {} : null,
    addEventListener(name, fn, capture) { listeners.set(name, { fn, capture }); },
    removeEventListener(name, fn, capture) {
      const current = listeners.get(name);
      if (current?.fn === fn && current.capture === capture) listeners.delete(name);
    },
  };
  const windowTarget = {
    addEventListener(name, fn) { windowListeners.set(name, fn); },
    removeEventListener(name, fn) { if (windowListeners.get(name) === fn) windowListeners.delete(name); },
  };
  const target = side => ({ closest: selector => selector === (side === 'right' ? '#right-pane' : '#left-pane')
    ? { id: side + '-pane' } : null });
  const event = (side, types = ['Files']) => ({
    target: target(side), dataTransfer: { types, files: [{ name: 'a.png' }], dropEffect: 'none' },
    clientX: 123, clientY: 456, relatedTarget: null, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  });
  return { root, windowTarget, left, right, listeners, windowListeners, event };
}

test('Tauri DOM drop 只记录目标，不重复处理文件；由原生 DragDrop 路径导入一次', async () => {
  const { bindFileDrop } = await import('../src/app/file-drop.mjs');
  const f = fixture(), opened = [], targets = [], errors = [];
  const dispose = bindFileDrop({
    root: f.root, windowTarget: f.windowTarget, nativeDrop: true,
    getActiveSide: () => 'left',
    openFiles: async files => opened.push(files),
    onDropTarget: value => targets.push(value),
    onError: error => errors.push(error),
  });
  const drag = f.event('right');
  f.listeners.get('dragover').fn(drag);
  assert.equal(drag.prevented, true);
  assert.equal(f.right.classes.has('file-drop-target'), true);
  assert.equal(f.left.classes.has('file-drop-target'), false);

  const drop = f.event('right');
  f.listeners.get('drop').fn(drop);
  assert.equal(drop.prevented, true);
  assert.equal(drop.stopped, true);
  assert.deepEqual(targets, [{ side: 'right', x: 123, y: 456, nativeDrop: true, blocked: false }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.length, 0, 'Tauri 的 DOM 与 WindowEvent 不能重复导入');
  assert.equal(errors.length, 0);
  dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.windowListeners.size, 0);
  assert.equal(f.right.classes.size, 0);
});

test('Electron 仍只通过 DOM drop 打开文件，并按左右窗格传递目标', async () => {
  const { bindFileDrop } = await import('../src/app/file-drop.mjs');
  const f = fixture(), opened = [], targets = [];
  const dispose = bindFileDrop({
    root: f.root, windowTarget: f.windowTarget, nativeDrop: false,
    getActiveSide: () => 'left',
    openFiles: async (files, side) => opened.push({ files, side }),
    onDropTarget: value => targets.push(value),
    onError: assert.fail,
  });
  const drop = f.event('right');
  f.listeners.get('drop').fn(drop);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].side, 'right');
  assert.equal(opened[0].files[0].name, 'a.png');
  assert.equal(targets[0].nativeDrop, false);
  dispose();
});

test('纯文本/链接拖动不拦截；打开对话框时拒绝文件拖入', async () => {
  const { bindFileDrop } = await import('../src/app/file-drop.mjs');
  const plain = fixture(), opened = [], errors = [];
  bindFileDrop({
    root: plain.root, windowTarget: plain.windowTarget, nativeDrop: true,
    getActiveSide: () => 'left', openFiles: async files => opened.push(files),
    onError: error => errors.push(error),
  });
  const link = plain.event('left', ['text/uri-list']);
  link.dataTransfer.files = [];
  plain.listeners.get('drop').fn(link);
  assert.equal(link.prevented, false);
  assert.equal(link.stopped, false);
  assert.equal(errors.length, 0);

  const modal = fixture({ dialog: true }), blockedTargets = [];
  bindFileDrop({
    root: modal.root, windowTarget: modal.windowTarget, nativeDrop: true,
    getActiveSide: () => 'left', openFiles: async files => opened.push(files),
    onDropTarget: value => blockedTargets.push(value),
    onError: error => errors.push(error),
  });
  const blocked = modal.event('left');
  modal.listeners.get('drop').fn(blocked);
  assert.equal(blocked.prevented, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /对话框/);
  assert.equal(blockedTargets[0].blocked, true);
  assert.equal(opened.length, 0);
});
