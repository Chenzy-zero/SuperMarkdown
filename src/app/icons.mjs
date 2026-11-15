const paths = {
  new: 'M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z M14 2v7h7 M8 15h8 M12 11v8',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18',
  file: 'M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z M14 2v7h7 M7 13h10 M7 17h7',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z M7 3v6h10V3 M7 21v-8h10v8',
  copy: 'M8 8h13v13H8z M16 8V3H3v13h5',
  undo: 'M3 10h11a6 6 0 0 1 0 12 M3 10l6-6 M3 10l6 6',
  redo: 'M21 10H10a6 6 0 0 0 0 12 M21 10l-6-6 M21 10l-6 6',
  refresh: 'M20 7a9 9 0 1 0 1 9 M20 2v6h-6',
  up: 'M12 21V3 M5 10l7-7 7 7',
  outline: 'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('app-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.file); svg.append(path); return svg;
}
export function bindIcons() {
  for (const [id, name, label, compact] of [
    ['new-document', 'new', '新建', true], ['open-file', 'folder', '打开', true], ['save-file', 'save', '保存', true], ['save-as', 'copy', '另存为', true],
    ['undo', 'undo', '撤销', true], ['redo', 'redo', '重做', true], ['choose-folder', 'folder', '打开文件夹'],
    ['new-markdown', 'new', '新建 Markdown'], ['refresh-folder', 'refresh', '刷新目录'], ['parent-folder', 'up', '上一级目录', true],
    ['files-tab', 'folder', '文件'], ['outline-tab', 'outline', '大纲'],
  ]) {
    const button = document.getElementById(id); const span = document.createElement('span'); span.textContent = label;
    if (compact) { span.className = 'sr-only'; button.classList.add('icon-button'); }
    button.setAttribute('aria-label', label); button.replaceChildren(icon(name), span);
  }
}
