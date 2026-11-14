export function bindToolbarTooltip() {
  const tooltip = document.getElementById('toolbar-tooltip');
  let active = null;
  const hide = () => { active = null; tooltip.hidden = true; };
  document.addEventListener('mouseover', event => {
    const button = event.target.closest?.('.vditor-toolbar [aria-label]');
    if (!button) return;
    active = button;
    tooltip.textContent = button.getAttribute('aria-label');
    tooltip.hidden = false;
    const rect = button.getBoundingClientRect();
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8))}px`;
    tooltip.style.top = `${rect.bottom + bounds.height + 16 < innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - bounds.height - 8)}px`;
  });
  document.addEventListener('mouseout', event => {
    if (active?.contains(event.target) && !active.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}
