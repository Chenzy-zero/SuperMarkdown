# 应用源码

此目录是当前 Windows 应用的运行入口，已从早期的 experiments/editor-spike 迁入。根目录 `package.json` 的 main、桌面启动脚本和打包配置均指向这里。

- `main.cjs` / `preload.cjs`：系统窗口、文件选择对话框、跨进程接口及窗口关闭保护。
- `workspace-files.cjs` / `file-persistence.cjs`：文本读取、编码保留、冲突检查、替换写入与恢复草稿。
- `renderer.mjs`：文档、保存基线、文件操作、目录和布局协调。
- `secondary-pane.mjs`：第二个编辑视图，复用同一文档及历史。
- `history.mjs` / `protected-blocks.mjs`：编辑历史与暂不支持渲染片段的原文保留。
- `*-checks.mjs`：真实编辑器集成检查。检查样本与原生对话框替代仅在验证模式启用。

开发启动和打包命令见[根目录说明](../../README.md)，文件可靠性与边界见[保存与恢复说明](../../docs/saving-and-recovery.md)。正常用户启动为空白工作区；验证样本不会默认显示。
