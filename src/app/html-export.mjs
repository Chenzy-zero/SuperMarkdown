import { toImageDataUrl } from './image-assets.mjs';

export const EXPORT_CSS = `body{font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;color:#24292f;max-width:920px;margin:40px auto;padding:0 24px;overflow-wrap:anywhere}h1,h2{border-bottom:1px solid #ddd}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid #ccc;padding:6px 12px}pre{padding:16px;background:#f6f8fa;overflow:auto;white-space:pre-wrap}code{font-family:Consolas,monospace}blockquote{border-left:4px solid #bbb;margin-left:0;padding-left:16px;color:#57606a}img{max-width:100%;height:auto}.hljs-keyword,.hljs-selector-tag{color:#cf222e}.hljs-string,.hljs-attr{color:#0a3069}.hljs-number,.hljs-literal{color:#0550ae}.hljs-comment{color:#6e7781}.export-warning{border:1px solid #d4a72c;padding:12px;background:#fff8c5}@media print{body{max-width:none;margin:0}pre,blockquote,img{break-inside:avoid}thead{display:table-header-group}}`;
const TAGS = new Set('p h1 h2 h3 h4 h5 h6 blockquote ul ol li table thead tbody tr th td pre code strong em del s a hr br img input sup sub span div section'.split(' '));
const LITERAL = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'TEMPLATE']);
export function isExportImagePath(value) {
  try {
    const decoded = decodeURIComponent(value);
    return Boolean(decoded) && !/[\\:\x00-\x1f?#]/.test(decoded) && !decoded.startsWith('/')
      && decoded.split('/').every(part => part !== '..');
  } catch { return false; }
}
export const safeExportLink = value => /^(?:https?:\/\/|mailto:|#)/i.test(value || '') && !/[\u0000-\u0020\u007f]/.test(value);

// Only inert template contents receive parser HTML. No untrusted node is ever
// connected to the live document; output is rebuilt from an attribute allowlist.
export async function buildStandaloneHtml({ markdown, title, renderMarkdown, readImage, documentKey,
  document: dom = document, highlight = null }) {
  const warnings = new Set(), ids = new Set();
  const template = dom.createElement('template');
  template.innerHTML = renderMarkdown(String(markdown));
  const output = dom.createElement('article');
  let imageBytes = 0, images = 0;
  async function clean(node) {
    if (node.nodeType === 3) return dom.createTextNode(node.textContent);
    if (node.nodeType !== 1) return dom.createTextNode('');
    const tag = node.tagName.toLowerCase();
    if (LITERAL.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      warnings.add('原始 HTML、脚本或嵌入内容已作为源码显示。');
      const code = dom.createElement('pre'); code.textContent = node.outerHTML; return code;
    }
    if (/(?:^|\s)language-(?:math|mermaid|graphviz|echarts|plantuml|flowchart)\b/.test(node.className || '')) {
      warnings.add('公式或图表以可读源码显示。');
      const fallback = dom.createElement(tag === 'span' || tag === 'code' ? 'code' : 'pre');
      fallback.textContent = node.textContent; return fallback;
    }
    if (!TAGS.has(tag)) {
      const fragment = dom.createDocumentFragment();
      for (const child of node.childNodes) fragment.append(await clean(child));
      return fragment;
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '图片';
      try {
        if (!isExportImagePath(src) || !documentKey || !readImage || ++images > 128) throw new Error('图片数量超限或文档尚未保存');
        const asset = await readImage({ documentKey, relativePath: src });
        if (asset?.error) throw new Error(asset.error);
        imageBytes += asset?.bytes?.length || 0;
        if (imageBytes > 32 * 1024 * 1024) throw new Error('图片总量超过 32 MiB');
        const image = dom.createElement('img'); image.setAttribute('alt', alt); image.setAttribute('src', toImageDataUrl(asset)); return image;
      } catch {
        warnings.add('部分图片未内联（远程、越界、损坏、超限或未保存文档图片）；请检查占位说明。');
        const placeholder = dom.createElement('span'); placeholder.textContent = `[图片未导出：${alt}]`; return placeholder;
      }
    }
    if (/math|mermaid|graphviz|echarts|plantuml|flowchart/.test(node.className || '')) warnings.add('公式或图表以可读源码显示。');
    const result = dom.createElement(tag);
    let id = node.getAttribute('id');
    if (!id && /^h[1-6]$/.test(tag)) {
      const base = node.textContent.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 110) || 'section';
      id = base;
      for (let suffix = 1; ids.has(id); suffix++) id = base + '-' + suffix;
    }
    if (id) {
      if (/^[\p{L}\p{N}\p{M}_-]{1,128}$/u.test(id) && !ids.has(id)) { result.id = id; ids.add(id); }
      else warnings.add('重复或不安全的页内锚点已移除。');
    }
    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (safeExportLink(href)) { result.setAttribute('href', href); result.setAttribute('rel', 'noopener noreferrer'); }
      else if (href) warnings.add('不安全或本地文件链接已移除，保留可读文字。');
    }
    const numberAttribute = tag === 'ol' ? 'start' : tag === 'li' ? 'value' : null;
    if (numberAttribute) {
      const value = node.getAttribute(numberAttribute);
      if (/^-?\d{1,9}$/.test(value || '')) result.setAttribute(numberAttribute, value);
    }
    if (tag === 'input') {
      if (node.getAttribute('type') !== 'checkbox') return dom.createTextNode('');
      result.setAttribute('type', 'checkbox'); result.setAttribute('disabled', '');
      if (node.hasAttribute('checked')) result.setAttribute('checked', '');
    }
    if (['th', 'td'].includes(tag)) {
      const align = node.getAttribute('align');
      if (['left', 'center', 'right'].includes(align)) result.setAttribute('align', align);
    }
    for (const child of node.childNodes) result.append(await clean(child));
    if (tag === 'code') {
      const language = /(?:^|\s)language-([\w-]+)/.exec(node.className || '')?.[1];
      if (['mermaid','math','latex','graphviz','echarts','plantuml','flowchart'].includes(language)) warnings.add('公式或图表以可读源码显示。');
      else if (language && highlight?.getLanguage(language)) {
        // Highlighter output is still passed through the same sanitizer below.
        const colored = dom.createElement('template');
        colored.innerHTML = highlight.highlight(node.textContent, { language, ignoreIllegals: true }).value;
        result.replaceChildren();
        for (const child of colored.content.childNodes) result.append(await clean(child));
      }
    }
    if (tag === 'span' && /^hljs-[\w -]+$/.test(node.className || '')) result.className = node.className;
    return result;
  }
  for (const node of template.content.childNodes) output.append(await clean(node));
  const actualIds = new Set([...output.querySelectorAll('[id]')].map(node => node.id));
  for (const anchor of output.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href.startsWith('#') || href === '#') continue;
    let target;
    try { target = decodeURIComponent(href.slice(1)); } catch {}
    if (!actualIds.has(target)) { anchor.removeAttribute('href'); warnings.add('未找到目标的页内链接已移除，保留文字。'); }
  }
  if (/\$\$|\\\(|\\\[/.test(markdown)) warnings.add('公式或图表以可读源码显示。');
  const shell = dom.implementation.createHTMLDocument(String(title || '导出文档'));
  shell.documentElement.lang = 'zh-CN';
  const charset = shell.createElement('meta'); charset.setAttribute('charset', 'utf-8'); shell.head.prepend(charset);
  const viewport = shell.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1'; shell.head.append(viewport);
  const csp = shell.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'none'; object-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'";
  shell.head.append(csp);
  const style = shell.createElement('style'); style.textContent = EXPORT_CSS; shell.head.append(style);
  if (warnings.size) {
    const note = shell.createElement('p'); note.className = 'export-warning';
    note.textContent = [...warnings].join(' '); shell.body.append(note);
  }
  shell.body.append(shell.adoptNode(output));
  return { html: '<!doctype html>\n' + shell.documentElement.outerHTML, warnings: [...warnings] };
}
