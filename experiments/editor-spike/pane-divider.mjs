export function bindPaneDivider() {
  const area = document.getElementById('editors');
  const divider = document.getElementById('pane-divider');
  let ratio = .5;
  let pointer = null;
  const available = () => Math.max(1, area.clientWidth - divider.offsetWidth);
  const minimum = () => Math.min(280 / available(), .5);
  const setRatio = value => {
    const min = minimum();
    ratio = Math.max(min, Math.min(1 - min, value));
    area.style.setProperty('--split-ratio', ratio);
    divider.setAttribute('aria-valuenow', Math.round(ratio * 100));
    divider.setAttribute('aria-valuemin', Math.ceil(min * 100));
    divider.setAttribute('aria-valuemax', Math.floor((1 - min) * 100));
    divider.setAttribute('aria-valuetext', `左侧 ${Math.round(ratio * 100)}%，右侧 ${Math.round((1 - ratio) * 100)}%`);
  };
  const stop = () => {
    if (pointer !== null && divider.hasPointerCapture(pointer)) divider.releasePointerCapture(pointer);
    pointer = null; area.classList.remove('resizing-panes');
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    // 合成事件没有活动指针；真实鼠标使用捕获，离开竖线仍可继续拖动。
    if (event.isTrusted) divider.setPointerCapture(pointer);
    area.classList.add('resizing-panes');
  });
  divider.addEventListener('pointermove', event => {
    if (pointer !== event.pointerId) return;
    setRatio((event.clientX - area.getBoundingClientRect().left - divider.offsetWidth / 2) / available());
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(event, stop);
  window.addEventListener('blur', stop);
  divider.addEventListener('dblclick', () => setRatio(.5));
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    setRatio(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ratio + (event.key === 'ArrowLeft' ? -.02 : .02));
  });
  new ResizeObserver(() => {
    if (area.dataset.layout === 'single') stop(); else setRatio(ratio);
  }).observe(area);
  setRatio(ratio);
}
