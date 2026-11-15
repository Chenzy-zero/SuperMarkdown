export function bindFileDrop({ openFiles, onError, getActiveSide }) {
  const panes = [...document.querySelectorAll('.editor-pane')];
  const clear = () => panes.forEach(pane => pane.classList.remove('file-drop-target'));
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const sideFor = event => event.target.closest?.('#right-pane') ? 'right' : event.target.closest?.('#left-pane') ? 'left' : getActiveSide();
  const hover = event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    clear();
    if (document.querySelector('dialog[open]')) return;
    event.dataTransfer.dropEffect = 'copy';
    const side = sideFor(event), pane = document.getElementById(`${side}-pane`);
    pane.dataset.dropLabel = `松开，在${side === 'right' ? '右' : '左'}侧打开文件`;
    pane.classList.add('file-drop-target');
  };
  document.addEventListener('dragenter', hover, true);
  document.addEventListener('dragover', hover, true);
  document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopImmediatePropagation(); clear();
    if (document.querySelector('dialog[open]')) { onError(new Error('请先完成当前对话框操作，再拖入文件。')); return; }
    const files = Array.from(event.dataTransfer.files), side = sideFor(event);
    Promise.resolve(openFiles(files, side)).catch(onError);
  }, true);
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) clear(); }, true);
  document.addEventListener('dragend', clear, true);
  window.addEventListener('blur', clear);
}
