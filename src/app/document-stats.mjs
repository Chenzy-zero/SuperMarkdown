// CRLF 计作一个换行字符；非 BMP 字符（例如单个表情）计作一个字符。
export function documentStats(text) {
  let lines = 1, characters = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i); characters++;
    if (code > 0xffff) i++;
    if (code === 10 || code === 13) lines++;
    if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
  }
  return { lines, characters };
}
