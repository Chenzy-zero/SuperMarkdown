const path = require('node:path');

function pathsFromArguments(argv, workingDirectory, packaged) {
  const values = argv.slice(packaged ? 1 : 2), files = [], seen = new Set();
  const pairedOptions = new Set(['--user-data-dir', '--remote-debugging-port', '--inspect', '--inspect-brk', '--original-process-start-time']);
  let positionalOnly = false;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (typeof value !== 'string' || !value || value.includes('\0')) continue;
    if (!positionalOnly && value === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && value.startsWith('-')) { if (pairedOptions.has(value)) index++; continue; }
    const fullPath = path.resolve(workingDirectory, value);
    const key = process.platform === 'win32' ? fullPath.toLowerCase() : fullPath;
    if (!seen.has(key)) { seen.add(key); files.push(fullPath); }
  }
  return files;
}

class FileOpenQueue {
  constructor(read, notify) { this.read = read; this.notify = notify; this.pending = []; }
  add(files) {
    for (const file of files) if (typeof file === 'string' && path.isAbsolute(file) && !this.pending.includes(file)) this.pending.push(file);
    if (this.pending.length) this.notify();
  }
  async take() {
    const results = [];
    for (const filename of this.pending.splice(0)) {
      try { results.push({ file: await this.read(filename) }); }
      catch (error) { results.push({ error: `无法打开 ${path.basename(filename)}：${error.message}` }); }
    }
    return results;
  }
}

module.exports = { pathsFromArguments, FileOpenQueue };
