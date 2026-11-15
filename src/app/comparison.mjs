export function bindComparison({ pair, capture, onError }) {
  const $ = id => document.getElementById(id), dialog = $('comparison-dialog');
  let view = null, index = -1;
  function navigate(direction) {
    const chunks = view?.chunks || []; if (!chunks.length) return;
    index = (index + direction + chunks.length) % chunks.length;
    view.navigate(index); $('comparison-location').textContent = `第 ${index + 1} / ${chunks.length} 处差异`;
  }
  function open() {
    if (document.querySelector('dialog[open]')) return;
    capture(); const [left, right] = pair();
    if (!left || !right || left.key === right.key) return;
    try {
      $('comparison-left-name').textContent = `左侧 · ${left.name}`;
      $('comparison-right-name').textContent = `右侧 · ${right.name}`;
      $('comparison-left-name').title = left.file?.path || left.name;
      $('comparison-right-name').title = right.file?.path || right.name;
      dialog.showModal();
      view = SuperMarkdownCode.compare($('comparison-content'), left, right); index = -1;
      const chunks = view.chunks;
      const inserted = chunks.filter(chunk => chunk.fromA === chunk.toA).length;
      const deleted = chunks.filter(chunk => chunk.fromB === chunk.toB).length;
      $('comparison-summary').textContent = chunks.length ? `共 ${chunks.length} 处差异 · 新增 ${inserted} · 删除 ${deleted} · 修改 ${chunks.length - inserted - deleted}${chunks.some(chunk => !chunk.precise) ? ' · 部分复杂区域按整块显示' : ''}` : '两份文档内容相同';
      $('comparison-location').textContent = '';
      $('comparison-prev').disabled = $('comparison-next').disabled = !chunks.length;
      $('comparison-content').dataset.differences = String(chunks.length);
      if (chunks.length) navigate(1);
    } catch (error) { view?.destroy(); view = null; dialog.close(); onError(error); }
  }
  $('compare-files').onclick = open;
  $('comparison-prev').onclick = () => navigate(-1);
  $('comparison-next').onclick = () => navigate(1);
  $('comparison-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { view?.destroy(); view = null; $('comparison-content').replaceChildren(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'F7') { event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1); }
  });
  return { open, update() {
    const [a, b] = pair(); $('compare-files').disabled = !a || !b || a.key === b.key;
  } };
}
