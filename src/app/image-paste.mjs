// Issue #6: receive actual image bytes from a user-initiated ClipboardEvent.
// No clipboard polling, no navigator.clipboard.read permission, no network.
const MAX_CLIPBOARD_IMAGE_BYTES = 8 * 1024 * 1024;

export function clipboardImage(clipboardData) {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind !== 'file') continue;
    const file = item.getAsFile?.();
    const mime = String(item.type || file?.type || '').toLowerCase();
    if (file && mime.startsWith('image/')) return file;
  }
  for (const file of Array.from(clipboardData.files || [])) {
    if (String(file?.type || '').toLowerCase().startsWith('image/')) return file;
  }
  return null;
}

export async function imageClipboardBytes(image) {
  const size = image?.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('截图必须是非空图片，大小不超过 8 MiB。');
  }
  if (typeof image.arrayBuffer !== 'function') {
    throw new Error('当前剪贴板不支持直接读取图片，请使用“插入图片…”。');
  }
  const buffer = await image.arrayBuffer();
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error('剪贴板图片内容无效或超过 8 MiB。');
  }
  return Array.from(new Uint8Array(buffer));
}

// Only image clipboard payloads are intercepted. Regular text and HTML paste,
// including in find/replacement inputs, continue through the existing editor.
export function bindImagePaste({
  root = document,
  getContext,
  pasteImage,
  onError = () => {},
}) {
  const handler = event => {
    if (event.defaultPrevented || event.isComposing || !event.clipboardData) return;
    const image = clipboardImage(event.clipboardData);
    if (!image) return;
    let context;
    try { context = getContext(event); } catch (error) { onError(error); return; }
    if (!context) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve()
      .then(() => pasteImage(image, context))
      .catch(onError);
  };
  root.addEventListener('paste', handler, true);
  return () => root.removeEventListener('paste', handler, true);
}
