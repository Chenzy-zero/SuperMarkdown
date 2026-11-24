import { findMatches } from './find-matches.mjs';

// 替换完全采用字面量文本；不把 $&、$1、反斜杠等当成正则替换表达式。
// 所有位置均为 JavaScript 字符串的 UTF-16 偏移，与 CodeMirror/DOM 查找位置一致。
export function replaceAt(text, match, replacement) {
  const original = String(text), value = String(replacement);
  if (!match || !Number.isSafeInteger(match.from) || !Number.isSafeInteger(match.to)
    || match.from < 0 || match.to <= match.from || match.to > original.length) {
    throw new RangeError('替换位置无效，请重新查找。');
  }
  return {
    text: original.slice(0, match.from) + value + original.slice(match.to),
    count: 1,
    caret: match.from + value.length,
  };
}

// 查找界面最多显示 2000 项；全部替换绝不能偷偷只修改前 2000 项。
export function replaceAllLiteral(text, query, replacement, { caseSensitive = false, limit = 2000 } = {}) {
  const original = String(text), value = String(replacement);
  if (!query) return { text: original, count: 0, caret: 0 };
  const matches = findMatches(original, query, { caseSensitive, limit: limit + 1 });
  if (matches.length > limit) {
    throw new RangeError('匹配项超过 ' + limit + ' 处。为避免长文误操作，请缩小查找范围后重试。');
  }
  if (!matches.length) return { text: original, count: 0, caret: 0 };
  let textAfter = '', from = 0, caret = 0;
  for (const match of matches) {
    textAfter += original.slice(from, match.from) + value;
    caret = textAfter.length;
    from = match.to;
  }
  return { text: textAfter + original.slice(from), count: matches.length, caret };
}
