const fs = require('node:fs/promises');
const path = require('node:path');
const themes = new Set(['light', 'dark', 'cream', 'gray']);
class Preferences {
  constructor(directory) { this.filename = path.join(directory, 'preferences.json'); this.value = { theme: 'light', sidebar: 'files' }; this.pending = Promise.resolve(); }
  async read() {
    try { this.validate(JSON.parse(await fs.readFile(this.filename, 'utf8'))); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    return this.value;
  }
  validate(value) {
    if (themes.has(value?.theme)) this.value.theme = value.theme;
    if (['files', 'outline', 'hidden'].includes(value?.sidebar)) this.value.sidebar = value.sidebar;
  }
  write(value) {
    this.validate(value); const snapshot = JSON.stringify(this.value);
    this.pending = this.pending.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      await fs.writeFile(this.filename + '.tmp', snapshot, 'utf8'); await fs.rename(this.filename + '.tmp', this.filename);
    });
    return this.pending.then(() => this.value);
  }
}
module.exports = { Preferences };
