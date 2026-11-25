// DOM owns drag targeting and prevents WebView navigation. In Tauri, the
// native WindowEvent::DragDrop path is the sole file processor; this prevents
// the same OS drop being handled twice. Electron keeps its existing DOM path.
export function bindFileDrop({
  openFiles, onError, getActiveSide, onDropTarget = () => {},
  nativeDrop = false, root = document, windowTarget = window,
}) {
  const panes = [...root.querySelectorAll('.editor-pane')];
  const clear = () => panes.forEach(pane => pane.classList.remove('file-drop-target'));
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const sideFor = event => event.target?.closest?.('#right-pane') ? 'right'
    : event.target?.closest?.('#left-pane') ? 'left' : getActiveSide();
  const dialogOpen = () => Boolean(root.querySelector('dialog[open]'));

  const hover = event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    clear();
    if (dialogOpen()) return;
    event.dataTransfer.dropEffect = 'copy';
    const side = sideFor(event);
    const paneId = side === 'right' ? 'right-pane' : 'left-pane';
    const pane = root.getElementById?.(paneId) || panes.find(item => item.id === paneId);
    if (!pane || pane.hidden) return;
    pane.dataset.dropLabel = '松开，在' + (side === 'right' ? '右' : '左') + '侧打开文件或插入图片';
    pane.classList.add('file-drop-target');
  };

  const drop = event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clear();
    const side = sideFor(event);
    if (dialogOpen()) {
      onDropTarget({ side, x: event.clientX, y: event.clientY, nativeDrop, blocked: true });
      onError(new Error('请先完成当前对话框操作，再拖入文件。'));
      return;
    }
    onDropTarget({ side, x: event.clientX, y: event.clientY, nativeDrop, blocked: false });
    // Tauri receives authoritative absolute paths from WindowEvent::DragDrop.
    // Do not process DataTransfer.files here or the native event would duplicate
    // every text open / image import. Electron has no native Tauri event.
    if (!nativeDrop) {
      const files = Array.from(event.dataTransfer.files || []);
      Promise.resolve().then(() => openFiles(files, side)).catch(onError);
    }
  };

  const leave = event => { if (!event.relatedTarget) clear(); };
  const end = () => clear();
  root.addEventListener('dragenter', hover, true);
  root.addEventListener('dragover', hover, true);
  root.addEventListener('drop', drop, true);
  root.addEventListener('dragleave', leave, true);
  root.addEventListener('dragend', end, true);
  windowTarget.addEventListener('blur', end);

  return () => {
    root.removeEventListener('dragenter', hover, true);
    root.removeEventListener('dragover', hover, true);
    root.removeEventListener('drop', drop, true);
    root.removeEventListener('dragleave', leave, true);
    root.removeEventListener('dragend', end, true);
    windowTarget.removeEventListener('blur', end);
    clear();
  };
}
