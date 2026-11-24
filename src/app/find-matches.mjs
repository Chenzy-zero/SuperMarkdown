// 按 UTF-16 原文位置返回非重叠的字面量匹配，保留中文、表情及大小写折叠后的真实偏移。
// 输入始终被正则转义：用户键入的 *、[ 等字符不作为正则语法执行。
export function findMatches(text, query, { caseSensitive = false, limit = 2000 } = {}) {
  if (!query || !text || limit <= 0) return [];
  if (query.length > 256) return [];
  const special = new Set(['\\', '.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']']);
  const escaped = [...query].map(char => special.has(char) ? '\\' + char : char).join('');
  const regex = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  const matches = [];
  for (const match of String(text).matchAll(regex)) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}
