const test = require('node:test');
const assert = require('node:assert/strict');

test('仅接受文档管理的 .assets/UUID 图片，不读取外部链接或路径穿越', async () => {
  const { isManagedAssetPath } = await import('../src/app/image-assets.mjs');
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(isManagedAssetPath('notes.assets/' + uuid + '.png'), true);
  assert.equal(isManagedAssetPath('./%E4%B8%AD%E6%96%87%20%E7%AC%94%E8%AE%B0.assets/' + uuid + '.jpg'), true);
  for (const path of [
    'https://example.com/x.png',
    'file:///C:/secret.png',
    '../notes.assets/' + uuid + '.png',
    'notes.assets/../' + uuid + '.png',
    '/notes.assets/' + uuid + '.png',
    'notes.assets/' + uuid + '.svg',
    'notes.assets/screenshot.png',
    'notes.assets/' + uuid + '.png?token=secret',
  ]) {
    assert.equal(isManagedAssetPath(path), false, path);
  }
});

test('构造离线 data URL，拒绝危险 MIME 和超长图片数据', async () => {
  const { toImageDataUrl } = await import('../src/app/image-assets.mjs');
  assert.equal(toImageDataUrl({ mime: 'image/png', bytes: [137, 80, 78, 71] }),
    'data:image/png;base64,iVBORw==');
  assert.throws(() => toImageDataUrl({ mime: 'image/svg+xml', bytes: [60, 115, 118, 103] }), /格式无效/);
  assert.throws(() => toImageDataUrl({ mime: 'image/png', bytes: [] }), /格式无效/);
});

test('从已授权文档读取图片，不改写原始 Markdown 且防止 DOM 复用期间的错位赋值', async () => {
  const { hydrateManagedImages } = await import('../src/app/image-assets.mjs');
  const path = 'notes.assets/550e8400-e29b-41d4-a716-446655440000.png';
  const fake = (src) => ({
    original: src, isConnected: true, dataset: {},
    getAttribute(name) { return name === 'src' ? this.original : null; },
    set src(value) { this.rendered = value; },
  });
  const managed = fake(path), external = fake('https://example.com/image.png');
  const root = { querySelectorAll: () => [managed, external], contains: image => [managed, external].includes(image) };
  const requested = [], errors = [];
  const load = async args => {
    requested.push(args);
    return { mime: 'image/png', bytes: [137, 80, 78, 71] };
  };
  await hydrateManagedImages(root, 'known-key', load, error => errors.push(error));
  assert.equal(requested.length, 1);
  assert.deepEqual(requested[0], { documentKey: 'known-key', relativePath: path });
  assert.equal(managed.rendered, 'data:image/png;base64,iVBORw==');
  assert.equal(external.rendered, undefined);
  assert.equal(errors.length, 0);
  await hydrateManagedImages(root, 'known-key', load);
  assert.equal(requested.length, 1, '相同 DOM 图片不应重复加载');

  const replaced = fake(path);
  const asyncRoot = { querySelectorAll: () => [replaced], contains: image => image === replaced };
  await hydrateManagedImages(asyncRoot, 'known-key', async () => {
    replaced.isConnected = false;
    return { mime: 'image/png', bytes: [137, 80, 78, 71] };
  });
  assert.equal(replaced.rendered, undefined, '已被 Vditor 替换的节点不应被异步修改');
  const stale = fake(path);
  let stillActive = true;
  const changingRoot = { querySelectorAll: () => [stale], contains: image => image === stale };
  await hydrateManagedImages(changingRoot, 'known-key', async () => {
    stillActive = false;
    return { mime: 'image/png', bytes: [137, 80, 78, 71] };
  }, () => {}, () => stillActive);
  assert.equal(stale.rendered, undefined, '文档已切换后不得在复用的 DOM 节点中显示旧图');
});


test('插入图片引用保留 Unicode 光标偏移与 CRLF；只修改内存文本', async () => {
  const { insertImageReference } = await import('../src/app/image-assets.mjs');
  const path = 'notes.assets/550e8400-e29b-41d4-a716-446655440000.png';
  const inserted = insertImageReference('a🙂b\r\n第二行', 3, path, '\r\n');
  assert.equal(inserted.text, 'a🙂\r\n![图片](' + path + ')\r\nb\r\n第二行');
  assert.equal(inserted.caret, ('a🙂\r\n![图片](' + path + ')\r\n').length);
  const first = insertImageReference('', 0, path);
  assert.equal(first.text, '![图片](' + path + ')');
  assert.throws(() => insertImageReference('hello', 2, '../file.png'), /路径/);
  assert.throws(() => insertImageReference('hello', 2, path, '\r'), /换行/);
});

test('图片插入可以作为一个独立 Undo/Redo 动作记录', async () => {
  const { insertImageReference } = await import('../src/app/image-assets.mjs');
  const { DocumentHistory } = await import('../src/app/history.mjs');
  const history = new DocumentHistory('正文');
  history.record('正文\n', 3, 'source');
  history.closeGroup();
  const before = history.current.markdown;
  const insertion = insertImageReference(before, before.length,
    'notes.assets/550e8400-e29b-41d4-a716-446655440000.png');
  history.record(insertion.text, insertion.caret, null);
  history.closeGroup();
  assert.equal(history.undo().markdown, before);
  assert.equal(history.redo().markdown, insertion.text);
});
