const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_CACHE: path.join(root, '.electron-cache'),
    electron_config_cache: path.join(root, '.electron-cache'),
  },
});
if (result.error) throw result.error;
if (result.status === 0) require('./build-editor.cjs');
process.exitCode = result.status ?? 1;
