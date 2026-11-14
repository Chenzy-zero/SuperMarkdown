const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const iconv = require('iconv-lite');

const revisionOf = bytes => createHash('sha256').update(bytes).digest('hex');
const queues = new Map();
function serial(key, action) {
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(key, next);
  const clean = () => { if (queues.get(key) === next) queues.delete(key); };
  next.then(clean, clean);
  return next;
}

function encodeText(content, encoding = 'utf-8', bom = false) {
  if (typeof content !== 'string') throw new Error('保存内容必须是文本。');
  if (!['utf-8', 'utf-16le', 'utf-16be', 'gb18030'].includes(encoding)) throw new Error('不支持这个保存编码。');
  const bytes = iconv.encode(content, encoding);
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== content) {
    throw new Error('当前编码无法完整保存这些字符，请另存为 UTF-8 文件。');
  }
  const prefix = !bom ? Buffer.alloc(0) : encoding === 'utf-8' ? Buffer.from([239,187,191]) :
    encoding === 'utf-16le' ? Buffer.from([255,254]) : encoding === 'utf-16be' ? Buffer.from([254,255]) : Buffer.alloc(0);
  return Buffer.concat([prefix, bytes]);
}

async function diskRevision(target) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('保存目标必须是普通文件。');
    return { revision: revisionOf(await fs.readFile(target)), stat };
  } catch (error) { if (error.code === 'ENOENT') return { revision: null }; throw error; }
}

// 先完整写入同目录临时文件并刷新，再替换目标；失败不会截断原文件。
function writeAtomic(target, bytes, expectedRevision) {
  return serial(process.platform === 'win32' ? target.toLowerCase() : target, async () => {
    const before = await diskRevision(target);
    const check = actual => {
      if (actual.revision !== expectedRevision) {
        const error = new Error(actual.revision === null ? '原文件已被移动或删除，请另存为。' : '文件已被其他程序修改，请重新载入或另存为。');
        error.code = actual.revision === null ? 'FILE_MISSING' : 'FILE_CONFLICT'; throw error;
      }
    };
    check(before);
    if (before.stat && !(before.stat.mode & 0o222)) throw Object.assign(new Error('文件是只读的，请另存为。'), { code: 'EACCES' });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, 'wx', before.stat?.mode ?? 0o666);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      check(await diskRevision(target));
      await fs.rename(temporary, target);
      return revisionOf(bytes);
    } finally { await fs.rm(temporary, { force: true }); }
  });
}

class RecoveryStore {
  constructor(directory) { this.path = path.join(directory, 'drafts.json'); }
  async read() {
    try {
      const value = JSON.parse(await fs.readFile(this.path, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.documents) || !value.documents.every(item =>
        typeof item.key === 'string' && typeof item.name === 'string' && typeof item.content === 'string' && typeof item.savedText === 'string')) {
        throw new Error('恢复草稿格式不正确，原草稿文件已保留。');
      }
      return value.documents;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  write(documents) {
    if (!Array.isArray(documents)) throw new Error('草稿格式不正确。');
    return serial(this.path, async () => {
      await fs.mkdir(path.dirname(this.path), { recursive: true });
      const temporary = this.path + '.tmp';
      const handle = await fs.open(temporary, 'w');
      try { await handle.writeFile(JSON.stringify({ version: 1, documents }), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, this.path);
    });
  }
}

module.exports = { revisionOf, encodeText, writeAtomic, diskRevision, RecoveryStore };
