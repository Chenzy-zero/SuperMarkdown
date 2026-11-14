# 项目协作规则

## 沟通

- 默认使用简体中文交流、撰写项目文档与说明决策；保留代码标识符、命令及工具要求的原文。
- 说明结论、依据、待确认事项和下一步；提供可检查的理由与取舍。

## 分析与决策

- 从用户要完成的任务、约束及验收条件出发，明确事实、假设和未决问题。
- 将 Typora 和 Markdown All in One 作为功能参考；具体行为以已确认需求为准。
- 选型时比较满足约束的简单方案，说明收益、成本与可逆性；关键未知用最小实验验证。
- 需求逐项确认后再确定框架、编辑器内核与首版范围；开始工作前阅读 docs/project-brief.md。

## 实现与交付

- 以完成用户任务的最小闭环推进，关注文件保存可靠性、Markdown 兼容性和中文输入体验。
- 针对实际变更选择必要的检查；交付时说明结果、验证情况与未解决的问题。
- 在新增开发命令时同步更新 README.md；在采纳技术决策时记录原因及约束。

## Agent skills

### Issue tracker

任务与规格使用 Chenzy-zero/SuperMarkdown 的 GitHub Issues。操作前阅读 docs/agents/issue-tracker.md。

### Triage labels

使用五个默认任务分流标签。分流或修改标签前阅读 docs/agents/triage-labels.md。

### Domain docs

采用 single-context：根目录 GLOSSARY.md 与 docs/adr/。探索领域或作出设计决策前阅读 docs/agents/domain.md。
