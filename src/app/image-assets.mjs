// Load only the current document's managed <stem>.assets/UUID.ext images.
// The backend independently checks the document key, canonical path, size and type.
const ASSET_PATH = /^(?:\.\/)?[^\/\\?#]+\.assets\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:png|jpg|gif|webp)$/i;
const SAFE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const scheduled = new WeakMap();

export function isManagedAssetPath(value) {
  return typeof value === 'string' && value.length < 700
    && !value.includes('..') && ASSET_PATH.test(value);
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

// This never changes Markdown or the editor history. It only gives WebView2 a
// safe in-memory URL for an image that was explicitly stored under this file.
export async function hydrateManagedImages(root, documentKey, load, onError = () => {}) {
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
        if (!image.isConnected || image.getAttribute('src') !== path || scheduled.get(image) !== identity) return;
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
