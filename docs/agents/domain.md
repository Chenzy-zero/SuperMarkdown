# Domain Docs

## 阅读时机

探索领域、命名概念或作出设计决策前，读取根目录 GLOSSARY.md，以及 docs/adr/ 中与当前主题有关的决策。

文件尚不存在时直接继续；在领域术语得到确认或重要决策形成后，由 domain-modeling 流程按需创建。

## 布局

采用 single-context：

- GLOSSARY.md：全项目领域术语。
- docs/adr/NNNN-<主题>.md：架构决策及其依据。

## 使用规则

在需求、Issue、实现、测试和方案中使用 GLOSSARY.md 定义的术语。遇到缺失或歧义时，结合实际用例确认含义后补充。

方案与已有 ADR 冲突时，明确指出冲突、原因及影响，再讨论是否变更决策。
