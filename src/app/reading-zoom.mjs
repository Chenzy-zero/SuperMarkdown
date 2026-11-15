export function bindReadingZoom({ initial = 100, save }) {
  const select = document.getElementById('reading-zoom');
  let value = initial;
  function apply(next, persist = true) {
    value = Math.max(50, Math.min(300, Math.round(next)));
    select.querySelector('[data-custom]')?.remove();
    if (![...select.options].some(option => Number(option.value) === value)) {
      const option = new Option(`${value}%`, String(value)); option.dataset.custom = 'true'; select.add(option);
    }
    select.value = String(value);
    document.documentElement.style.setProperty('--reading-scale', String(value / 100));
    document.documentElement.dataset.readingZoom = String(value);
    document.dispatchEvent(new Event('reading-zoom-change'));
    if (persist) save(value);
  }
  select.addEventListener('change', () => apply(Number(select.value)));
  document.addEventListener('wheel', event => {
    if (!event.ctrlKey || event.altKey || !event.deltaY) return;
    // 接管浏览器默认页面缩放，只调整正文和源码，工具栏保持原有尺寸。
    event.preventDefault(); event.stopPropagation();
    if (!document.querySelector('dialog[open]')) apply(value + (event.deltaY < 0 ? 10 : -10));
  }, { passive: false, capture: true });
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing || event.key !== '0') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!document.querySelector('dialog[open]')) apply(100);
  }, true);
  apply(initial, false);
  return { reset: () => apply(100), increase: () => apply(value + 10), decrease: () => apply(value - 10) };
}
