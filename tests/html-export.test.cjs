const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
require(path.join(path.dirname(require.resolve('vditor')), 'js/lute/lute.min.js'));
const lute = global.Lute.New();
const highlight = require(path.join(path.dirname(require.resolve('vditor')), 'js/highlight.js/highlight.min.js'));
async function build(markdown, extra = {}) {
  const { buildStandaloneHtml } = await import('../src/app/html-export.mjs');
  return buildStandaloneHtml({ markdown, title: '中文 <笔记>', document: new JSDOM('').window.document,
    renderMarkdown: value => lute.Md2HTML(value), highlight, ...extra });
}

test('offline standalone HTML preserves Chinese, headings, lists, tables and local code highlighting', async () => {
  const markdown = '# 中文标题\n\n- 第一项\n- 第二项\n\n| 列 | 值 |\n| --- | --- |\n| 内容 | 你好 |\n\n```javascript\nconst text = "中文";\n```\n\n[链接](https://example.com)';
  const { html } = await build(markdown);
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('h1').textContent, '中文标题');
  assert.equal(document.querySelectorAll('li').length, 2);
  assert.equal(document.querySelector('td').textContent, '内容');
  assert.ok(document.querySelector('code .hljs-keyword'));
  assert.equal(document.title, '中文 <笔记>');
  assert.equal(document.querySelector('meta[charset]').getAttribute('charset'), 'utf-8');
  assert.equal(document.querySelectorAll('script,link,iframe,object').length, 0);
  assert.match(document.querySelector('meta[http-equiv]').content, /script-src 'none'/);
  assert.ok(document.querySelector('style').textContent.includes('Microsoft YaHei'));
});

test('hostile HTML is rebuilt without active tags, handlers, styles, navigation or remote image fetches', async () => {
  const requested = [];
  const markdown = '<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe><svg onload="alert(1)"></svg>\n\n<img src="https://evil.test/pixel" onerror="alert(1)" srcset="https://evil.test/a 2x"><a href="javascript:alert(1)" style="background:url(https://evil.test)">攻击</a><form action="https://evil.test"><input></form><base href="https://evil.test"><meta http-equiv="refresh" content="0;url=https://evil.test">';
  const { html, warnings } = await build(markdown, { documentKey: 'original', readImage: async request => { requested.push(request); throw new Error('denied'); } });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('script,iframe,svg,form,base,meta[http-equiv="refresh"],img').length, 0);
  assert.equal(document.querySelector('a').hasAttribute('href'), false);
  assert.equal(document.querySelectorAll('[onload],[onerror],[srcset],[style]').length, 0);
  assert.equal(requested.length, 0);
  assert.ok(warnings.length > 0);
  assert.match(document.body.textContent, /alert\(1\)/);
});

test('local relative images are embedded with the captured document key; missing and unsafe images become placeholders', async () => {
  const requests = [];
  const { html, warnings } = await build('![中文](images/a.png)\n\n![越界](../secret.png)\n\n![失败](missing.png)', {
    documentKey: 'snapshot-A', readImage: async request => {
      requests.push(request);
      if (request.relativePath === 'missing.png') throw new Error('missing');
      return { mime: 'image/png', bytes: [137,80,78,71,13,10,26,10] };
    },
  });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('img').length, 1);
  assert.match(document.querySelector('img').src, /^data:image\/png;base64,/);
  assert.ok(requests.every(request => request.documentKey === 'snapshot-A'));
  assert.equal(requests.length, 2);
  assert.ok(warnings.length);
  assert.match(document.body.textContent, /图片未导出/);
});

test('unsafe protocols/paths are rejected and unsupported diagrams remain readable source', async () => {
  const { safeExportLink, isExportImagePath } = await import('../src/app/html-export.mjs');
  for (const value of ['javascript:alert(1)', 'file:///x', 'data:text/html,a', '//evil.test', 'https://x\n.test']) assert.equal(safeExportLink(value), false);
  for (const value of ['../secret.png', '%2e%2e/a.png', '/secret.png', 'C:/a.png', 'a\\b.png', 'data:image/png,abc']) assert.equal(isExportImagePath(value), false);
  assert.equal(isExportImagePath('普通 图片/a.png'), true);
  const { html, warnings } = await build('```mermaid\ngraph TD; A-->B\n```\n\n$$x^2$$');
  const document = new JSDOM(html).window.document;
  assert.match(document.querySelector('pre').textContent, /graph TD/);
  assert.ok(warnings.some(value => /源码/.test(value)));
});

test('export snapshots unsaved source without altering history, baseline or identity; cancel and failure are harmless', async () => {
  const renderer = fs.readFileSync(require.resolve('../src/app/renderer.mjs'), 'utf8');
  const code = renderer.slice(renderer.indexOf('let htmlExportBusy ='), renderer.indexOf('const captureBoth ='));
  for (const outcome of ['cancel', 'failure', 'success']) {
    const original = { name: '中文.md', kind: 'markdown', file: { key: 'A' }, savedText: 'saved', lineEnding: '\r\n', history: { current: { markdown: 'history' } } };
    const before = JSON.stringify(original), requests = [], errors = [], status = {};
    let active = original, finish;
    const paused = new Promise(resolve => { finish = resolve; });
    const context = { focusedDoc: () => active, activePane: 'left', mode: 'source', composing: false, secondary: null,
      source: { value: '# 未保存\n正文' }, engine: { vditor: { lute: { Md2HTML: value => value } } },
      window: { workspaceFiles: { readExportImage() {}, exportHtml: async request => { requests.push(request); if (outcome === 'failure') throw new Error('disk denied'); return outcome === 'cancel' ? null : '/chosen/中文.html'; } } },
      buildStandaloneHtml: async snapshot => { requests.push(snapshot); await paused; return { html: '<html>original snapshot</html>', warnings: [] }; },
      unwrap: value => value, $: () => status, showError: error => errors.push(error) };
    vm.createContext(context); vm.runInContext(code, context);
    const exporting = context.exportCurrentHtml();
    active = { ...original, name: 'B.md', file: { key: 'B' } }; finish(); await exporting;
    assert.equal(JSON.stringify(original), before, outcome);
    assert.equal(requests[0].documentKey, 'A');
    assert.equal(requests[0].markdown, '# 未保存\r\n正文');
    assert.equal(requests[1].name, '中文.md');
    assert.equal(errors.length, outcome === 'failure' ? 1 : 0);
  }
});


test('internal links retain unique safe target IDs and remove missing or malformed targets', async () => {
  const { html, warnings } = await build('# 中文标题\n\n[跳转](#中文标题)\n\n<h2 id="valid-id">显式锚点</h2><p><a href="#valid-id">有效</a><a href="#missing">失效</a></p><p id="valid-id">重复</p><p id="bad id">异常</p><input id="removed" type="text"><a href="#removed">无实际目标</a>\n\n5. 第五项\n6. 第六项');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('h1').id, '中文标题');
  assert.equal(document.querySelector('ol').getAttribute('start'), '5');
  for (const anchor of document.querySelectorAll('a[href^="#"]')) {
    assert.ok(document.getElementById(decodeURIComponent(anchor.getAttribute('href').slice(1))));
  }
  assert.equal(document.querySelectorAll('[id="valid-id"]').length, 1);
  assert.equal(document.querySelectorAll('[id="bad id"]').length, 0);
  assert.ok(warnings.length > 0);
});
