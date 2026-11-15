const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { revisionOf, encodeText, writeAtomic, diskRevision } = require('./file-persistence.cjs');

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function decodeText(bytes, partial = false) {
  let encodings;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encodings = ['utf-16le'];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encodings = ['utf-16be'];
  else {
    if (bytes.includes(0) || bytes.subarray(0, 5).toString('ascii') === '%PDF-') return null;
    encodings = ['utf-8', 'gb18030'];
  }
  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: partial });
      const controls = text.match(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g)?.length ?? 0;
      if (text.includes('\0') || controls / Math.max(text.length, 1) > 0.02) return null;
      const bom = encoding === 'utf-8' ? bytes.subarray(0, 3).equals(Buffer.from([239,187,191])) : encoding.startsWith('utf-16');
      return { content: text, encoding, bom };
    } catch { /* 尝试下一个已支持的文本编码。 */ }
  }
  return null;
}

class WorkspaceFiles {
  constructor() { this.openedFiles = new Map(); this.knownRoots = new Set(); }
  async openFolder(folderPath, activate = true) {
    const root = await fs.realpath(folderPath);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('请选择一个文件夹。');
    const nextWorkspace = new WorkspaceFiles();
    nextWorkspace.root = root;
    const entries = await nextWorkspace.list('');
    if (activate) this.root = root;
    this.knownRoots.add(root);
    return { name: path.basename(root) || root, path: root, entries };
  }

  async parentFolder(root = this.root) {
    if (!root || (root !== this.root && !this.knownRoots.has(root))) throw new Error('请先打开这个文件夹。');
    return this.openFolder(path.dirname(root));
  }

  async resolve(id, root = this.root) {
    if (!root) throw new Error('请先打开文件夹。');
    if (root !== this.root && !this.knownRoots.has(root)) throw new Error('请先打开这个文件夹。');
    if (typeof id !== 'string' || id.includes('\0') || path.isAbsolute(id)) throw new Error('文件路径无效。');
    const fullPath = await fs.realpath(path.resolve(root, id));
    const relative = path.relative(root, fullPath);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('只能打开当前文件夹内的文件。');
    }
    return { root, fullPath, id: relative.split(path.sep).join('/') };
  }

  async list(id, scope) {
    const { root, fullPath } = await this.resolve(id, scope);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const result = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(entries.length, 8) }, async () => {
      while (next < entries.length) {
        const entry = entries[next++];
        if (entry.isSymbolicLink()) continue;
        const filePath = path.join(fullPath, entry.name);
        const relative = path.relative(root, filePath).split(path.sep).join('/');
        if (entry.isDirectory()) result.push({ id: relative, name: entry.name, type: 'directory' });
        else if (entry.isFile()) {
          let handle;
          try {
            handle = await fs.open(filePath, 'r');
            const bytes = Buffer.alloc(8192);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (decodeText(bytes.subarray(0, bytesRead), true)) {
              result.push({ id: relative, name: entry.name, type: 'file' });
            }
          } catch { /* 单个不可读文件不会阻止目录中的其他文本文件显示。 */ }
          finally { await handle?.close(); }
        }
      }
    }));
    return result.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  }

  async read(id, scope) {
    const entry = await this.resolve(id, scope);
    return this.readAbsolute(entry.fullPath, entry.root);
  }

  async createMarkdown(directoryId, name, scope) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('请输入文件名。');
    let filename = name.trim();
    if (/[<>:"/\\|?*\u0000-\u001F]/.test(filename) || /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
      throw new Error('文件名包含不支持的字符或保留名称。');
    }
    if (!/\.md$/i.test(filename)) filename += '.md';
    const directory = await this.resolve(directoryId, scope);
    if (!(await fs.stat(directory.fullPath)).isDirectory()) throw new Error('请选择一个文件夹。');
    const fullPath = path.join(directory.fullPath, filename);
    const handle = await fs.open(fullPath, 'wx');
    await handle.close();
    return this.readAbsolute(fullPath, directory.root);
  }

  knownFile(key) {
    const file = this.openedFiles.get(key);
    if (!file) throw new Error('请先打开这个文件。');
    return file;
  }

  async folderForFile(key, activate = true) {
    const file = this.knownFile(key);
    const folder = await this.openFolder(path.dirname(file.path), activate);
    file.root = folder.path;
    return folder;
  }

  async save(key, content, revision) {
    const file = this.knownFile(key);
    const written = await writeAtomic(file.path, encodeText(content, file.encoding, file.bom), revision);
    return this.verifySaved(file.path, file.root, written);
  }

  async saveAs(filePath, content, expectedRevision) {
    const parent = await fs.realpath(path.dirname(filePath));
    const target = path.join(parent, path.basename(filePath));
    const written = await writeAtomic(target, encodeText(content), expectedRevision);
    return this.verifySaved(target, this.root, written);
  }

  async verifySaved(target, root, writtenRevision) {
    const file = await this.readAbsolute(target, root);
    if (file.revision !== writtenRevision) throw Object.assign(new Error('保存后文件又被其他程序修改，请重新载入或另存为。'), { code: 'FILE_CONFLICT' });
    return file;
  }

  async inspect(key) {
    const file = this.knownFile(key);
    const disk = await diskRevision(file.path);
    if (disk.revision === null) return { missing: true };
    return this.readAbsolute(file.path, file.root);
  }

  describeLink(href, fromKey) {
    if (typeof href !== 'string' || !href.trim() || href.includes('\0')) throw new Error('链接地址无效。');
    const raw = href.trim();
    if (raw.startsWith('#')) return { type: 'anchor', target: raw, fragment: decodeURIComponent(raw.slice(1)) };
    const from = this.openedFiles.get(fromKey)?.path;
    let url;
    if (path.isAbsolute(raw) && !raw.startsWith('//')) url = pathToFileURL(raw);
    else if (/^[a-z][a-z\d+.-]*:/i.test(raw)) url = new URL(raw);
    else {
      if (!from && !this.root) throw new Error('请先打开本地文件或文件夹，以确定相对链接的位置。');
      url = new URL(raw, pathToFileURL(from || path.join(this.root, '__document__.md')));
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return { type: 'external', target: url.href };
    if (url.protocol !== 'file:') throw new Error('当前仅支持网页链接、本地路径和文档内标题链接。');
    const fragment = decodeURIComponent(url.hash.slice(1));
    url.hash = ''; url.search = '';
    const fullPath = fileURLToPath(url);
    return { type: 'local', target: fullPath + (fragment ? '#' + fragment : ''), path: fullPath, fragment };
  }

  async readAbsolute(filePath, root = this.root) {
    const fullPath = await fs.realpath(filePath);
    const handle = await fs.open(fullPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('请选择一个文本文件。');
      if (stat.size > MAX_FILE_BYTES) throw new Error('此原型暂支持打开 20 MB 以内的文本文件。');
      const bytes = await handle.readFile();
      const decoded = decodeText(bytes);
      if (!decoded) throw new Error('此文件不是当前可读取的文本文件。');
      const result = {
        ...decoded, revision: revisionOf(bytes), id: root ? path.relative(root, fullPath).split(path.sep).join('/') : null, path: fullPath, root, directory: path.dirname(fullPath),
        key: process.platform === 'win32' ? fullPath.toLowerCase() : fullPath,
        name: path.basename(fullPath),
        kind: /\.(md|markdown|mdown|mkd)$/i.test(fullPath) ? 'markdown' : 'text',
      };
      this.openedFiles.set(result.key, { path: fullPath, encoding: decoded.encoding, bom: decoded.bom, root });
      return result;
    } finally { await handle.close(); }
  }
}

module.exports = { WorkspaceFiles };
