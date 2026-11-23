# SuperMarkdown

面向 Windows 的 Markdown 可视编辑器。应用源码位于 `src/app/`，目前正式发布版本为 **0.5.0（Tauri 2）**。

当前已完成新建、打开、编辑、保存、另存为、关闭保护及未保存草稿恢复的文件操作闭环。图片资源管理、查找替换和更完整的 Markdown/输入法兼容性仍在后续范围内。

## 下载与启动

从 [GitHub Releases](https://github.com/Chenzy-zero/SuperMarkdown/releases) 下载 Windows x64 安装包或 ZIP。解压版需要完整解压后运行 `SuperMarkdown.exe`，不需要 Node.js、pnpm 或额外的 Electron。

- [0.2.0 版本说明](docs/releases/0.2.0.md)
- [0.2.1 文件关联修复](docs/releases/0.2.1.md)
- [0.2.2 目录、拖拽与工具行](docs/releases/0.2.2.md)
- [0.2.3 目录跟随当前文件](docs/releases/0.2.3.md)
- [0.3.0 菜单、代码编辑与四套主题](docs/releases/0.3.0.md)
- [0.3.1 正文缩放与主题调整](docs/releases/0.3.1.md)
- [0.4.0 文档统计、编码与差异对比](docs/releases/0.4.0.md)
- [0.5.0 Tauri 2 Windows x64 正式版](https://github.com/Chenzy-zero/SuperMarkdown/releases/tag/v0.5.0)
- [文件保存与恢复说明](docs/saving-and-recovery.md)
- 历史 `v0.1.0` 是不支持正文保存的验证版本；升级前请先复制保留旧窗口中的内容。

已准备好的源码目录可双击 [启动SuperMarkdown.cmd](启动SuperMarkdown.cmd)。旧窗口不会自动加载源代码修改。

安装版会注册 `.md`、`.markdown`、`.mdown`、`.mkd`。安装完成页可打开 Windows 默认应用设置；应用左下方也提供“设置 Markdown 默认打开方式”。在系统设置中搜索 `.md` 并选择 SuperMarkdown，或右键 Markdown 文件 → 打开方式 → 选择其他应用 → SuperMarkdown → 始终。

Windows 要求通过系统界面确认默认应用，安装程序不能绕过已有的用户选择。设置后双击文档会直接打开对应内容；软件已运行时会在同一窗口中新开标签，重复打开同一文件会保留已有未保存修改。ZIP 版不执行安装注册，可通过系统“打开方式”选择解压后的 `SuperMarkdown.exe`。

## 常用操作

| 操作 | 入口 |
| --- | --- |
| 新建未命名文档 | 顶部“新建”或 Ctrl+N |
| 打开单个文本文件 | 顶部“打开”或 Ctrl+O |
| 浏览工作文件夹 | 左侧“打开文件夹” |
| 保存 | 顶部“保存”或 Ctrl+S |
| 另存为 | 顶部“另存为”或 Ctrl+Shift+S |
| 关闭当前文档 | 标签页 × 或 Ctrl+W |
| 切换可视编辑与源码 | 顶部模式按钮或 Ctrl+Shift+M |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Y，Ctrl+Shift+Z 也可重做 |

Markdown 默认可视编辑，TXT、代码和其他文本原样显示。目录右键支持打开、在右侧打开、新建 Markdown、复制路径、在文件夹中显示和刷新；也可在子目录直接创建 `.md` 文件。

双击文档或通过“打开”选择文件后，左侧显示该文件所在目录，可切换同级文本文件及展开子目录。也可从资源管理器直接拖入本地文本文件：在分屏中拖到哪侧，就在哪侧打开；一次可拖入多篇，已有未保存修改和另一侧文档会保留。

切换文件标签或点击左右编辑区时，左侧目录会跟随当前文件，显示其所在目录并高亮文件。同目录切换保留展开状态，快速切换时以最后选中的文件为准。未命名文档保留最近浏览目录；手动打开文件夹可先浏览，重新点击编辑区或切换文件后再跟随。若当前选择了“大纲”，保持该视图，文件目录在后台同步。

顶部靠左的独立菜单行提供“文件 / 编辑 / 查看 / 主题”，并保留新建、保存、撤销、布局和模式的快捷按钮。文件名和路径单独显示在标签页下方；长路径自动省略，悬停可查看完整路径。

“查看”可选择文件目录、文档大纲或隐藏侧栏，也可切换编辑模式和分屏布局。左侧路径旁的 ↑ 返回当前浏览文件夹的上一级（类似 `cd ..`），正文不变；再次激活文件正文或切换标签后，目录继续跟随当前文件。

代码文件按语言进行本地语法着色，并显示行号。支持 JavaScript、TypeScript、Python、HTML、CSS、JSON、Shell 等；未识别的格式仍按普通文本编辑，不执行代码。此处提供语法着色，不包含 VS Code 的项目分析或智能补全。

在代码、TXT 或 Markdown 源码区选中多行，点击“多行输入”（或“编辑 → 多行同时输入”），每行行首会出现一个光标。输入 `#` 即同时给这些行加上 `#`，继续输入和删除也会同步作用于这些光标。按 Esc 退出，Ctrl+Z 撤销。Markdown 可视编辑时先切换源码再选择行；同步布局在右侧源码区操作。

“主题”提供 Codex 风格、Dark 深色、Anthropic 风格和科技灰。Codex 风格使用白底、蓝色线条图标，选中项图标与文字变黑；Anthropic 风格采用暖奶油与米色背景、深灰图标，正文使用 Georgia / 宋体等系统衬线体。代码和源码继续使用等宽字体。两套主题都调整了圆角正文面板与直边侧栏的拼接、标签和浮动菜单。旧版浅色和暖奶油设置会自动对应到这两套新外观。选择立即生效并在重启后保留，侧栏视图也会记忆。

正文缩放：按住 Ctrl 向上滚轮放大、向下滚轮缩小，每次调整 10 个百分点；菜单栏百分比下拉可选 50%～300%，Ctrl+0 恢复 100%。“查看”菜单也提供放大、缩小及恢复入口。缩放同时作用于两侧可视正文、Markdown 源码和代码编辑区，工具栏与目录不随之变大，不改写文本或产生未保存状态，比例在重启后保留。

“显示布局”提供单文件、双文件并排和“预览 + 源码同步”。两侧中间的竖线可拖动，双击恢复等宽；同步布局两侧可编辑且共用保存和撤销记录。

状态栏展示当前活动文件的总行数、总字符数及编码。统计按 Markdown 源文计算，包含语法标记、空格和换行；空文档为 1 行、0 字符，末尾空行计入行数，CRLF 与 LF 均计一个换行字符。字符数按 Unicode 码点计算，因此单个中文或普通表情不按两个字符计算。

点击底部编码名称（或“文件 → 文件编码…”），可以选择“转换后保存”或“按指定编码重新读取”。支持 UTF-8、UTF-8 with BOM、UTF-16 LE/BE、ASCII、GBK、GB18030、Big5、Windows-1252 和 Latin-1。转换会保存当前编辑内容；不支持的字符会阻止写入，保留原文件。重新读取不改写磁盘，但要求先保存当前修改。无编码标记的文件只能推测编码，纯 ASCII 字节也可能自动显示为 UTF-8；显示不正确时可手动重新读取。一次窗口内按指定编码读取或保存后，后续保存沿用该编码。

双文件并排时，点击路径栏右侧“比较左右文档”（或“查看 → 比较左右文档”），以当前内容打开只读并排对比，包括未保存修改。左侧差异显示为红色，右侧为绿色，同时标明行内变化；摘要统计新增、删除与修改的差异块。F7 / Shift+F7 或按钮切换下一处 / 上一处。“返回编辑”保留原有布局、光标和内容；对比不执行合并或写回。比较忽略 CRLF/LF 的换行风格差异，保留其他空白差异；复杂大区域可能按块显示并给出提示。同篇文档的预览源码同步布局不作为两个文件进行比较。

有未保存修改时，关闭文件或系统窗口都会提供“保存 / 不保存 / 取消”。取消保存位置或保存失败均不会关闭文档。恢复草稿独立保存在用户数据目录，重启后提示是否恢复；草稿不会自动覆盖源文件。

## 开发（Tauri 2 主线）

SuperMarkdown 从 v0.5.0 起以 Tauri 2 作为 Windows 正式桌面端。开发环境建议使用 Windows 10 1803+ / Windows 11，并准备 Node.js 24、pnpm 11.25.0、Rust stable、Microsoft C++ Build Tools（MSVC）和 Microsoft Edge WebView2 Runtime。

首次安装依赖：

\`\`\`powershell
pnpm install --frozen-lockfile --ignore-scripts
\`\`\`

启动 Tauri 开发版：

\`\`\`powershell
pnpm dev:tauri
\`\`\`

构建 Windows x64 NSIS 安装包：

\`\`\`powershell
pnpm build:tauri
\`\`\`

执行自动化检查：

\`\`\`powershell
pnpm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
\`\`\`

\`pnpm dev:tauri\` 和 \`pnpm build:tauri\` 使用固定版本 \`@tauri-apps/cli@2.12.6\`，Rust 依赖由 \`src-tauri/Cargo.lock\` 锁定。正式版依赖系统 WebView2 Runtime；公司内网或离线终端应提前将 Runtime 纳入系统镜像或软件分发流程。

### 历史 Electron 回归工具

Electron v0.4.0 的历史 Release 保留，但不再作为正式发行线。Electron 源码和依赖暂时保留，用于旧版行为对照、既有 UI 回归和兼容性排查，不代表后续正式包仍由 Electron 构建。

以下命令仅用于 Electron 兼容测试，不用于生成正式发行包：

\`\`\`powershell
pnpm setup:electron
pnpm start
pnpm test:app
pnpm test:startup
pnpm test:recovery
pnpm test:opening
pnpm dist:win
\`\`\`

其中 \`test:app\` 使用真实 Electron 编辑器做旧版 UI 回归；\`dist:win\` 生成 Electron 安装包，仅用于历史版本对照。Tauri 的正式构建请使用 \`pnpm build:tauri\`。

Tauri v0.5.0 的人工验收项目见 [Tauri 0.5.0 验收清单](docs/tauri-0.5.0-acceptance.md)。正式版安装包尚未进行代码签名；安装、覆盖安装、文件关联、中文输入法、拖放和 WebView2 离线部署仍需在目标 Windows 设备验证。

## 项目资料

[需求](docs/requirements-v0.1.md) · [项目状态](docs/project-brief.md) · [历史技术验证](docs/technical-evaluation.md) · [界面迭代记录](docs/usability-fixes.md) · [术语](GLOSSARY.md) · [协作规则](AGENTS.md)

代码编辑组件的浏览器资源由 `pnpm build:editor` 在本地生成；`pnpm start`、`pnpm dist:win` 和首次 `pnpm setup:electron` 自动执行。调整 `src/editor/` 后，使用桌面启动脚本前先运行该构建命令。`pnpm test:workbench` 检查真实多光标输入、代码颜色、主题恢复及目录导航（使用隔离数据目录）。

`pnpm test:documents` 使用隔离文件检查行数字符数、实际编码字节、不可编码字符保护，以及两篇未保存文档的只读比较和差异跳转。


## Tauri 2 桌面主线（当前正式版 0.5.0）

Tauri 2 位于 `src-tauri/`，自 v0.5.0 起是唯一正式发行线。Electron v0.4.0 历史 Release 保留，Electron 源码暂用于兼容测试，不再发布新的 Electron 正式包。详细架构、构建、用户数据迁移和发布说明见 [docs/tauri.md](docs/tauri.md)。

Windows 开发环境需要 Rust stable、Microsoft C++ Build Tools、WebView2 Runtime、Node.js 24 和 pnpm 11.25.0。先安装仓库依赖，然后运行：

    pnpm install --frozen-lockfile --ignore-scripts
    node tools/prepare-tauri-frontend.cjs
    cargo install tauri-cli --version "^2" --locked
    cargo tauri dev

构建安装包：

    cargo tauri build

Rust 依赖版本由提交的 `Cargo.lock` 固定。正式标识为 `local.supermarkdown`，草稿与偏好写入 `%APPDATA%\local.supermarkdown`；从 `v0.4.0-tauri-poc.1` 迁移数据的步骤见 [docs/tauri.md](docs/tauri.md)。

## 许可协议

本项目以 [MIT 许可证](LICENSE) 发布，Copyright (c) 2026 Chenzy-zero。

在保留版权声明和许可声明的前提下，可自由使用、修改、合并、发布、分发、再授权和销售本软件，包括商业用途；软件按“现状”提供，不附带任何明示或暗示的担保。完整条款见 [LICENSE](LICENSE)。
