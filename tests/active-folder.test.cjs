const test = require('node:test');
const assert = require('node:assert/strict');
const { ActiveFolderFollower } = require('../src/app/active-folder.mjs');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('手动浏览上级目录后，未完成的目录跟随结果不能拉回旧位置', async () => {
  const loading = deferred(), applied = [];
  const target = { identity: 'left:a', key: 'a', directory: 'child' };
  const follower = new ActiveFolderFollower({ current: () => target, root: () => 'parent', load: () => loading.promise,
    align: () => {}, apply: folder => applied.push(folder.path), onError: assert.fail });
  const request = follower.follow(); follower.browse(); loading.resolve({ path: 'child' }); await request;
  assert.deepEqual(applied, []);
});

test('快速切换文件时较慢的旧目录结果不会覆盖当前目录', async () => {
  const a = deferred(), b = deferred(); let target = { identity: 'left:a', key: 'a' };
  const applied = [];
  const follower = new ActiveFolderFollower({ current: () => target, root: () => null,
    load: key => key === 'a' ? a.promise : b.promise, align: () => {}, apply: folder => applied.push(folder.path), onError: assert.fail });
  const first = follower.follow(); target = { identity: 'right:b', key: 'b' }; const second = follower.follow();
  b.resolve({ path: 'B' }); await second; a.resolve({ path: 'A' }); await first;
  assert.deepEqual(applied, ['B']);
});

test('同目录切换不重新读取，手动浏览其他目录后重新点击编辑区会跟随', async () => {
  let root = 'A', reads = 0;
  const target = { identity: 'left:a', key: 'a', directory: 'A' };
  const follower = new ActiveFolderFollower({ current: () => target, root: () => root,
    load: async () => { reads++; return { path: 'A' }; }, align: () => {}, apply: folder => { root = folder.path; }, onError: assert.fail });
  await follower.follow(); assert.equal(reads, 0);
  root = 'manual'; await follower.follow(); assert.equal(root, 'manual');
  await follower.follow(true); assert.equal(root, 'A'); assert.equal(reads, 1);
});

test('切换到未命名文档会取消旧目录结果，保留浏览位置', async () => {
  const pending = deferred(); let target = { identity: 'a', key: 'a' }, applied = false;
  const follower = new ActiveFolderFollower({ current: () => target, root: () => 'old', load: () => pending.promise,
    align: () => {}, apply: () => { applied = true; }, onError: assert.fail });
  const reading = follower.follow(); target = { identity: 'untitled' }; await follower.follow();
  pending.resolve({ path: 'A' }); await reading; assert.equal(applied, false);
});

test('已过时目录的错误不会打断新文件', async () => {
  const pending = deferred(); let target = { identity: 'a', key: 'a' }; const errors = [];
  const follower = new ActiveFolderFollower({ current: () => target, root: () => null,
    load: key => key === 'a' ? pending.promise : Promise.resolve({ path: 'B' }), align: () => {}, apply: () => {}, onError: error => errors.push(error) });
  const reading = follower.follow(); target = { identity: 'b', key: 'b' }; await follower.follow();
  pending.reject(new Error('旧目录不存在')); await reading; assert.equal(errors.length, 0);
});
