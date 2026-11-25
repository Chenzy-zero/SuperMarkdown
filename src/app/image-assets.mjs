// Insert an ordered batch at one source offset. The helper normalizes offsets
// to LF internally and restores the original document line ending exactly once.
export function insertImageReferences(text, caret, relativePaths, lineEnding = '\n') {
  if (!Array.isArray(relativePaths) || relativePaths.length < 1 || relativePaths.length > 128) {
    throw new Error('图片数量无效，一次最多插入 128 张。');
  }
  if (!['\\n', '\\r\\n'].includes(lineEnding)) {
    throw new Error('图片资源路径或换行方式无效。');
  }
  let next = String(text).replace(/\r\n?/g, '\n');
  let at = Math.max(0, Math.min(next.length, caret));
  for (const path of relativePaths) {
    const inserted = insertImageReference(next, at, path, '\n');
    next = inserted.text;
    at = inserted.caret;
  }
  const restored = next.replace(/\n/g, lineEnding);
  const restoredCaret = next.slice(0, at).replace(/\n/g, lineEnding).length;
  return { text: restored, caret: restoredCaret };
}

// Load only the current document's managed <stem>.assets/UUID.ext images.
// The backend independently checks the document key, canonical path, size and type.
const ASSET_PATH = /^(?:\.\/)?[^\/\\?#]+\.assets\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|gif|webp)$/i;
const SAFE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const scheduled = new WeakMap();

export function isManagedAssetPath(value) {
  return typeof value === 'string' && value.length < 700 && ASSET_PATH.test(value);
}

export function toImageDataUrl(image) {
  if (!SAFE_MIME.has(image?.mime) || !Array.isArray(image?.bytes)
    || !image.bytes.length || image.bytes.length > 8 * 1024 * 1024) {
    throw new Error('图片内容或格式无效。');
  }
  const bytes = Uint8Array.from(image.bytes);
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  }
  return 'data:' + image.mime + ';base64,' + btoa(chunks.join(''));
}


// Pure insertion helper shared by the picker, future clipboard paste and drag.
// This alters text only; the caller records one DocumentHistory entry.
export function insertImageReference(text, caret, relativePath, lineEnding = '\n') {
  if (!isManagedAssetPath(relativePath) || !['\n', '\r\n'].includes(lineEnding)) {
    throw new Error('图片资源路径或换行方式无效。');
  }
  const original = String(text).replace(/\r\n?/g, '\n');
  const at = Math.max(0, Math.min(original.length, caret));
  const prefix = at > 0 && original[at - 1] !== '\n' ? '\n' : '';
  const suffix = at < original.length && original[at] !== '\n' ? '\n' : '';
  const insertion = prefix + '![图片](' + relativePath + ')' + suffix;
  const next = original.slice(0, at) + insertion + original.slice(at);
  return {
    text: next.replace(/\n/g, lineEnding),
    caret: next.slice(0, at + insertion.length).replace(/\n/g, lineEnding).length,
  };
}

// This never changes Markdown or the editor history. It only gives WebView2 a
// safe in-memory URL for an image that was explicitly stored under this file.
export async function hydrateManagedImages(root, documentKey, load, onError = () => {}, isCurrent = () => true) {
  if (!root || !documentKey || typeof load !== 'function') return;
  const tasks = [];
  for (const image of [...root.querySelectorAll('img')].slice(0, 128)) {
    const path = image.getAttribute('src') || image.getAttribute('data-src');
    if (!isManagedAssetPath(path)) continue;
    const identity = documentKey + ':' + path;
    if (image.dataset.supermarkdownAsset === identity || scheduled.get(image) === identity) continue;
    scheduled.set(image, identity);
    tasks.push((async () => {
      try {
        const asset = await load({ documentKey, relativePath: path });
        if (asset?.error) throw new Error(asset.error);
        if (!image.isConnected || !root.contains(image) || !isCurrent()
          || image.getAttribute('src') !== path || scheduled.get(image) !== identity) return;
        image.src = toImageDataUrl(asset);
        image.dataset.supermarkdownAsset = identity;
      } catch (error) {
        onError(error);
      } finally {
        if (scheduled.get(image) === identity) scheduled.delete(image);
      }
    })());
  }
  await Promise.all(tasks);
}
