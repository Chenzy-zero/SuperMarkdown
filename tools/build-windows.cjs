require('./build-editor.cjs');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
process.env.ELECTRON_BUILDER_CACHE = path.join(root, '.build-cache');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
build({
  projectDir: root,
  config: require('../electron-builder.cjs'),
  targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
  publish: 'never',
}).catch(error => { console.error(error); process.exitCode = 1; });
