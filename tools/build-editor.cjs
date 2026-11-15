const path = require('node:path');
require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/editor/code-editor-entry.js')],
  outfile: path.resolve(__dirname, '../src/app/vendor/code-editor.js'), bundle: true, format: 'iife',
  globalName: 'SuperMarkdownCode', platform: 'browser', target: 'chrome128', minify: true, legalComments: 'eof' });
