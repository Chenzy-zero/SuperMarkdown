const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Preferences } = require('../src/app/preferences.cjs');

test('主题、侧栏与缩放偏好按顺序写入，重启保留最后选择，未知值被忽略', async () => {
  const parent = path.resolve(__dirname, '../.prototype-artifacts'); await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'preferences-'));
  const preferences = new Preferences(directory);
  await Promise.all([preferences.write({ theme: 'dark' }), preferences.write({ theme: 'gray', sidebar: 'hidden', readingZoom: 125 }), preferences.write({ theme: 'invalid', sidebar: 'invalid', readingZoom: 900 })]);
  assert.deepEqual(await new Preferences(directory).read(), { theme: 'gray', sidebar: 'hidden', readingZoom: 125 });
  await fs.writeFile(path.join(directory, 'preferences.json'), '{broken');
  assert.deepEqual(await new Preferences(directory).read(), { theme: 'light', sidebar: 'files', readingZoom: 100 });
});
