# 应用源码

此目录是当前 Windows 应用的运行入口，已从早期的 experiments/editor-spike 迁入。根目录 `package.json` 的 main、桌面启动脚本和打包配置均指向这里。

- `main.cjs` / `preload.cjs`：系统窗口、文件选择对话框、跨进程接口及窗口关闭保护。
- `workspace-files.cjs` / `file-persistence.cjs`：文本读取、编码保留、冲突检查、替换写入与恢复草稿。
- `renderer.mjs`：文档、保存基线、文件操作、目录和布局协调。
- `secondary-pane.mjs`：第二个编辑视图，复用同一文档及历史。
- `open-files.cjs` / `file-drop.mjs`：系统文件打开请求排队，以及按编辑区域接收本地文件拖拽。
- `active-folder.mjs`：目录跟随当前文件，并丢弃过时的异步目录结果。
- `history.mjs` / `protected-blocks.mjs`：编辑历史与暂不支持渲染片段的原文保留。
- `*-checks.mjs`：真实编辑器集成检查。检查样本与原生对话框替代仅在验证模式启用。

开发启动和打包命令见[根目录说明](../../README.md)，文件可靠性与边界见[保存与恢复说明](../../docs/saving-and-recovery.md)。正常用户启动为空白工作区；验证样本不会默认显示。

- `workbench.mjs` / `preferences.cjs`：顶部菜单、侧栏视图、主题及用户偏好存储。
- `../editor/code-editor-entry.js`：CodeMirror 源码/纯文本视图、语法识别和多行光标；构建生成 `vendor/code-editor.js`，不依赖网络加载。文档历史继续使用 `history.mjs`，视图不持有另一套撤销栈。

- `reading-zoom.mjs` / `icons.mjs`：仅作用于正文的阅读比例、滚轮与键盘入口，以及使用主题颜色的本地图标。缩放通知 CodeMirror 重新测量，保留文档与光标状态。

- `document-stats.mjs`：源文行数与 Unicode 字符统计。
- `encoding-menu.mjs` / `encoding-formats.json`：明确区分转换保存与重新读取；文件层验证编码可逆性。
- `comparison.mjs`：两侧当前内容的只读比较快照；CodeMirror MergeView 在本地显示差异，不接入文档保存或编辑历史。
