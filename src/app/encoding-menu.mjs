export function bindEncodingMenu({ current, capture, isDirty, convert, reload, onError }) {
  const $ = id => document.getElementById(id), dialog = $('encoding-dialog');
  const formats = SuperMarkdownCode.formats;
  $('encoding-format').replaceChildren(...formats.map(format => new Option(format.label, format.id)));
  let target = null, busy = false;
  const describe = () => {
    const reading = $('encoding-operation').value === 'reload';
    $('encoding-apply').textContent = reading ? '重新读取' : '转换并保存';
    $('encoding-note').textContent = reading ? '使用选定编码重新读取磁盘文件，不会改写文件。请先保存当前修改。' : '将当前内容转换为选定编码并保存。无法容纳的字符会阻止保存，原文件保持完整。';
    $('encoding-apply').disabled = reading && (!target?.file || isDirty(target));
  };
  $('encoding-button').onclick = () => {
    if (document.querySelector('dialog[open]')) return;
    capture(); target = current(); if (!target || target.saving) return;
    $('encoding-document').textContent = target.name;
    $('encoding-operation').value = 'save'; $('encoding-error').textContent = '';
    const file = target.file;
    $('encoding-format').value = (formats.find(format => format.encoding === file?.encoding && format.bom === Boolean(file?.bom)) || formats.find(format => format.encoding === file?.encoding) || formats[0]).id;
    describe(); dialog.showModal();
  };
  $('encoding-operation').onchange = describe;
  $('encoding-cancel').onclick = () => dialog.close();
  $('encoding-apply').onclick = async () => {
    if (busy || !target || target.saving) return;
    const item = target, format = formats.find(format => format.id === $('encoding-format').value);
    const reading = $('encoding-operation').value === 'reload';
    busy = true; $('encoding-apply').disabled = true;
    try {
      if (reading) {
        if (!item.file || isDirty(item)) throw new Error('请先保存当前修改，再按其他编码重新读取。');
        await reload(item, format.encoding); dialog.close();
      } else {
        dialog.close();
        const saved = await convert(item, format);
        if (!saved && current() === item && !document.querySelector('dialog[open]')) {
          $('encoding-error').textContent = item.saveError || '未完成转换，当前内容仍保留。'; dialog.showModal();
        }
      }
    } catch (error) { $('encoding-error').textContent = error.message; onError(error); }
    finally { busy = false; describe(); }
  };
  return { update() {
    const item = current(), file = item?.file;
    $('encoding-button').disabled = !item || Boolean(item.saving);
    $('encoding-button').textContent = (formats.find(format => format.encoding === file?.encoding && format.bom === Boolean(file?.bom)) || formats.find(format => format.encoding === file?.encoding) || formats[0]).label;
  } };
}
