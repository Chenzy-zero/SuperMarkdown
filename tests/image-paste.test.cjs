const test = require('node:test');
const assert = require('node:assert/strict');

function bitmap(bytes, type = 'image/png') {
  const data = Uint8Array.from(bytes);
  return {
    type, size: data.length,
    async arrayBuffer() { return Uint8Array.from(data).buffer; },
  };
}

function clipboardWithImage(file, type = file.type) {
  return {
    items: [{ kind: 'file', type, getAsFile: () => file }],
    files: [file],
  };
}

test('剪贴板识别 Windows 截图 MIME 与文件回退，普通文本不触发拦截', async () => {
  const { clipboardImage } = await import('../src/app/image-paste.mjs');
  const screenshot = bitmap([137, 80, 78, 71]);
  assert.equal(clipboardImage(clipboardWithImage(screenshot)), screenshot);
  assert.equal(clipboardImage({ items: [], files: [screenshot] }), screenshot);
  assert.equal(clipboardImage({
    items: [
      { kind: 'string', type: 'text/plain' },
      { kind: 'file', type: 'image/png', getAsFile: () => screenshot },
    ],
  }), screenshot);
  assert.equal(clipboardImage({
    items: [{ kind: 'string', type: 'text/plain' }], files: [],
  }), null);
  assert.equal(clipboardImage({
    items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => bitmap([1], 'application/pdf') }],
  }), null);
  assert.equal(clipboardImage(null), null);
});

test('截图字节来自用户粘贴事件，非空且 <= 8 MiB，异常前不触及文件系统', async () => {
  const { imageClipboardBytes } = await import('../src/app/image-paste.mjs');
  assert.deepEqual(await imageClipboardBytes(bitmap([0x89, 0x50, 0x4e, 0x47])), [0x89, 0x50, 0x4e, 0x47]);
  await assert.rejects(() => imageClipboardBytes(bitmap([])), /非空图片/);
  await assert.rejects(() => imageClipboardBytes({ type: 'image/png', size: 8 * 1024 * 1024 + 1 }), /8 MiB/);
  await assert.rejects(() => imageClipboardBytes({ type: 'image/png', size: 4 }), /无法|不支持/);
  await assert.rejects(() => imageClipboardBytes({
    size: 1, async arrayBuffer() { return new Uint8Array(8 * 1024 * 1024 + 1).buffer; },
  }), /8 MiB/);
});

test('纯文本与 HTML 常规粘贴原样交给编辑器；截图只拦截编辑器，不误触搜索框', async () => {
  const { bindImagePaste } = await import('../src/app/image-paste.mjs');
  let handler = null, removed = false;
  const root = {
    addEventListener(type, callback, capture) {
      assert.equal(type, 'paste');
      assert.equal(capture, true);
      handler = callback;
    },
    removeEventListener(type, callback, capture) {
      assert.equal(type, 'paste');
      assert.equal(callback, handler);
      assert.equal(capture, true);
      removed = true;
    },
  };
  const screenshot = bitmap([137, 80, 78, 71]);
  const event = (clipboardData, target = { isEditor: true }) => ({
    target, clipboardData, isComposing: false, defaultPrevented: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  });
  const applied = [], errors = [];
  let checks = 0;
  const unsubscribe = bindImagePaste({
    root,
    getContext(e) {
      checks++;
      return e.target.isEditor ? { document: 'file.md' } : null;
    },
    pasteImage: async (file, context) => { applied.push([file, context]); },
    onError: e => errors.push(e),
  });
  const textPaste = event({ items: [{ kind: 'string', type: 'text/plain' }] });
  handler(textPaste);
  assert.equal(textPaste.prevented, false);
  assert.equal(checks, 0, '普通文本不应该检查/捕获文档状态');

  const searchImage = event(clipboardWithImage(screenshot), { isEditor: false });
  handler(searchImage);
  assert.equal(searchImage.prevented, false);
  assert.equal(applied.length, 0);

  const paste = event(clipboardWithImage(screenshot));
  handler(paste);
  assert.equal(paste.prevented, true);
  assert.equal(paste.stopped, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0], screenshot);
  assert.deepEqual(applied[0][1], { document: 'file.md' });
  assert.equal(errors.length, 0);

  const composing = event(clipboardWithImage(screenshot));
  composing.isComposing = true;
  handler(composing);
  const handledElsewhere = event(clipboardWithImage(screenshot));
  handledElsewhere.defaultPrevented = true;
  handler(handledElsewhere);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(applied.length, 1);
  unsubscribe();
  assert.equal(removed, true);
});

test('导入异常通过 onError 显示，不影响普通文字粘贴', async () => {
  const { bindImagePaste } = await import('../src/app/image-paste.mjs');
  let handler, error = null;
  bindImagePaste({
    root: { addEventListener(_type, fn) { handler = fn; } },
    getContext: () => ({ key: 'a' }),
    pasteImage: async () => { throw new Error('图片落盘失败'); },
    onError: e => { error = e; },
  });
  const clip = clipboardWithImage(bitmap([137, 80, 78, 71]));
  handler({
    clipboardData: clip, target: {}, defaultPrevented: false, isComposing: false,
    preventDefault() {}, stopImmediatePropagation() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(error.message, /落盘失败/);
});
