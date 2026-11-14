export const sample = `# 写作，从这里开始

这是一份**可以直接编辑**的 Markdown 文档。试着修改文字，再切换源码模式。

## 今天的计划

- [x] 确认首版写作需求
- [ ] 验证中文输入和格式操作
- [ ] 试用表格与源码切换

## 一张小表格

| 项目 | 状态 | 备注 |
| :--- | :---: | ---: |
| 正文写作 | 验证中 | 支持 Markdown |
| 表格操作 | 验证中 | 点击单元格编辑 |

> 写作时关注内容，需要时再修改源码。

## 一段代码

\`\`\`javascript
const greeting = '你好，SuperMarkdown';
console.log(greeting);
\`\`\`
`;

export const compatibility = '# 内容保留样本\n\n编辑这一段普通正文。\n\n' +
  '~~~mermaid\nflowchart LR\n  A[开始] --> B[完成]  \n~~~\n\n' +
  '$$\nx  =  y + 1  \n$$\n\n保留以上片段的原始写法。\n';

export const suggestedScale = '# 建议验收规模\n\n' +
  Array.from({ length: 50 }, (_, i) => `## 第 ${i + 1} 节\n\n` +
    '这是一段用于检查连续中文输入和长文滚动的样本文字。'.repeat(4) + '\n\n').join('');
