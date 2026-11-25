const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const renderer = fs.readFileSync(require.resolve('../src/app/renderer.mjs'), 'utf8');
const queueCode = renderer.slice(renderer.indexOf('function receiveOpenFiles('), renderer.indexOf('async function activateLink('));
const importCode = renderer.slice(renderer.indexOf('const imageDropBusy ='), renderer.indexOf('async function scanExternalFiles('));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const f = { modal: false, active: { name: 'A' }, side: 'right', results: [], imported: [], opened: [], discarded: [], errors: [] };
  const context = {
    incomingReady: true, incomingBusy: false, incomingScheduled: false,
    droppedRequests: [], nativeDropTargets: new Map(), lastDropTarget: null,
    document: { querySelector: () => f.modal ? {} : null },
    window: { workspaceFiles: {
      takeOpenFiles: async () => f.results.splice(0),
      discardDroppedImages: async tokens => { f.discarded.push(...tokens); return {}; },
    } },
    imageDropContext: () => f.modal ? null : { item: f.active, sourceCaret: 17 },
    sideAtDrop: () => f.side,
    importDroppedImages: async (entries, snapshot) => { f.imported.push({ entries, snapshot }); },
    acceptExternal: (result, side) => f.opened.push({ result, side }),
    showError: error => f.errors.push(error), unwrap: value => value, queueMicrotask,
  };
  vm.createContext(context);
  vm.runInContext(queueCode, context);
  return Object.assign(f, { context });
}
const event = id => ({ payload: { dropId: id, dropPosition: { x: 20, y: 40 } } });
const image = id => ({ dropId: id, dropPosition: { x: 20, y: 40 }, image: { token: id, name: id + '.png' } });

test('native target is captured before asynchronous takeOpenFiles returns', async () => {
  const f = fixture(), pending = deferred(), original = f.active;
  f.context.window.workspaceFiles.takeOpenFiles = () => pending.promise;
  const draining = f.context.receiveOpenFiles(event('one'));
  f.active = { name: 'B' };
  // Subsequent reads return empty, allowing the drain loop to finish.
  f.context.window.workspaceFiles.takeOpenFiles = async () => [];
  pending.resolve([image('one')]);
  await draining;
  assert.equal(f.imported[0].snapshot.item, original);
  assert.equal(f.imported[0].snapshot.sourceCaret, 17);
});

test('busy imports keep later same-coordinate batches and mixed text sides distinct', async () => {
  const f = fixture(), blocked = deferred(), original = f.active;
  f.results.push(image('one'));
  f.context.importDroppedImages = async (entries, snapshot) => {
    f.imported.push({ entries, snapshot });
    if (entries[0].dropId === 'one') await blocked.promise;
  };
  const draining = f.context.receiveOpenFiles(event('one'));
  await tick();
  f.results.push(image('two'), { dropId: 'two', dropPosition: { x: 20, y: 40 }, file: { name: 'notes.txt' } });
  await f.context.receiveOpenFiles(event('two'));
  f.active = { name: 'B' }; f.side = 'left';
  blocked.resolve();
  await draining;
  assert.equal(f.imported.length, 2);
  assert.equal(f.imported[1].snapshot.item, original);
  assert.equal(f.opened[0].side, 'right');
  assert.equal(f.context.nativeDropTargets.size, 0);
});

test('modal closes during takeOpenFiles: deferred ordinary opens resume without another event', async () => {
  const f = fixture(), pending = deferred();
  f.modal = true;
  f.context.window.workspaceFiles.takeOpenFiles = () => pending.promise;
  const draining = f.context.drainOpenFiles();
  f.modal = false;
  await f.context.drainOpenFiles(); // the dialog close callback arrives while busy
  f.context.window.workspaceFiles.takeOpenFiles = async () => [];
  pending.resolve([{ file: { name: 'startup.md' } }, image('blocked')]);
  await draining; await tick();
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].result.file.name, 'startup.md');
  assert.deepEqual(f.discarded, ['blocked']);
  assert.equal(f.imported.length, 0);
});

test('missing or modal-time native snapshots do not acquire the current target later', async () => {
  const f = fixture();
  f.results.push(image('missing'));
  await f.context.drainOpenFiles();
  assert.equal(f.imported[0].snapshot, null);
  f.modal = true;
  f.context.incomingBusy = true;
  await f.context.receiveOpenFiles(event('blocked'));
  f.modal = false;
  f.context.incomingBusy = false;
  f.results.push(image('blocked'));
  await f.context.drainOpenFiles();
  assert.equal(f.imported.length, 1);
  assert.deepEqual(f.discarded, ['blocked']);
});

test('stale target is rejected before save or asset import', async () => {
  const item = { kind: 'markdown', history: { current: { markdown: 'A' } } };
  const imported = [], errors = [], discarded = [];
  const c = {
    window: { workspaceFiles: {
      discardDroppedImages: async tokens => { discarded.push(...tokens); return {}; },
      importDroppedImages: async request => { imported.push(request); return []; },
    } },
    document: { querySelector: () => null }, composing: false,
    capture() {}, secondary: null, focusedDoc: () => ({ name: 'B' }),
    activePane: 'left', layout: 'single',
    saveDocument: () => { throw new Error('must not save stale target'); },
    showError: error => errors.push(error), unwrap: value => value,
  };
  vm.createContext(c); vm.runInContext(importCode, c);
  await c.importDroppedImages([image('one')], { item, side: 'left', layout: 'single', text: 'A', fileKey: null });
  assert.equal(imported.length, 0);
  assert.match(errors[0].message, /排队期间/);
  assert.deepEqual(discarded, ['one']);
});

test('new modal, composition or save work blocks a queued image before import', async () => {
  for (const state of ['modal', 'composition', 'secondary-composition', 'saving']) {
    const item = { kind: 'markdown', file: { key: 'A' }, saving: state === 'saving',
      history: { current: { markdown: 'A' } } };
    const errors = [], imported = [];
    const c = {
      window: { workspaceFiles: {
        discardDroppedImages: async () => ({}),
        importDroppedImages: async request => { imported.push(request); return []; },
      } },
      document: { querySelector: () => state === 'modal' ? {} : null },
      composing: state === 'composition',
      secondary: state === 'secondary-composition' ? { composing: true } : null,
      focusedDoc: () => item, activePane: 'left', layout: 'single',
      capture() { throw new Error('must not capture during blocked work'); },
      showError: error => errors.push(error), unwrap: value => value,
    };
    vm.createContext(c); vm.runInContext(importCode, c);
    await c.importDroppedImages([image('one')], { item, side: 'left', layout: 'single', text: 'A', fileKey: 'A' });
    assert.equal(imported.length, 0, state);
    assert.match(errors[0].message, /其他操作/, state);
  }
});

function realImportFixture() {
  const f = fixture();
  f.active = { kind: 'markdown', file: { key: 'A' }, history: { current: { markdown: 'A' } } };
  f.commits = [];
  Object.assign(f.context, {
    activePane: 'right', layout: 'single', composing: false, secondary: null,
    capture() {}, focusedDoc: () => f.active,
    imageDropContext: () => ({ item: f.active, side: 'right', layout: f.context.layout,
      text: f.active.history.current.markdown, fileKey: f.active.file.key, sourceCaret: 1 }),
    commitManagedImages: (...args) => f.commits.push(args),
    $: () => ({}),
  });
  f.context.window.workspaceFiles.importDroppedImages = async request => {
    f.imported.push(request);
    return [{ token: 'one', relativePath: 'A.assets/550e8400-e29b-41d4-a716-446655440000.png' }];
  };
  vm.runInContext(importCode, f.context);
  return f;
}

test('edits or layout changes while takeOpenFiles is pending reject the original batch before asset import', async () => {
  for (const state of ['text', 'layout']) {
    const f = realImportFixture(), pending = deferred();
    f.context.window.workspaceFiles.takeOpenFiles = () => pending.promise;
    const draining = f.context.receiveOpenFiles(event('one'));
    if (state === 'text') f.active.history.current.markdown = 'edited';
    else f.context.layout = 'files';
    f.context.window.workspaceFiles.takeOpenFiles = async () => [];
    pending.resolve([image('one')]);
    await draining;
    assert.equal(f.imported.length, 0, state);
    assert.equal(f.commits.length, 0, state);
    assert.match(f.errors[0].message, /排队期间/, state);
    assert.deepEqual(f.discarded, ['one'], state);
  }
});

test('state changes during asset import never commit references to a changed target', async () => {
  for (const state of ['document', 'text', 'active-pane', 'layout', 'modal', 'composition', 'secondary-composition', 'saving']) {
    const f = realImportFixture(), pending = deferred();
    const original = f.active;
    f.results.push(image('one'));
    f.context.window.workspaceFiles.importDroppedImages = request => {
      f.imported.push(request);
      return pending.promise;
    };
    const draining = f.context.receiveOpenFiles(event('one'));
    await tick();
    assert.equal(f.imported.length, 1, state);
    if (state === 'document') f.active = { kind: 'markdown', file: { key: 'B' }, history: { current: { markdown: 'B' } } };
    if (state === 'text') original.history.current.markdown = 'edited';
    if (state === 'active-pane') f.context.activePane = 'left';
    if (state === 'layout') f.context.layout = 'files';
    if (state === 'modal') f.modal = true;
    if (state === 'composition') f.context.composing = true;
    if (state === 'secondary-composition') f.context.secondary = { composing: true };
    if (state === 'saving') original.saving = true;
    pending.resolve([{ token: 'one', relativePath: 'A.assets/550e8400-e29b-41d4-a716-446655440000.png' }]);
    await draining;
    assert.equal(f.commits.length, 0, state);
    assert.match(f.errors[0].message, /未插入引用/, state);
    assert.deepEqual(f.discarded, ['one'], state);
  }
});
