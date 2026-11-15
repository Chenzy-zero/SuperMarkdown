# SuperMarkdown

面向 Windows 的 Markdown 可视编辑器。应用源码位于 `src/app/`，目前版本为 **0.2.2**。

当前已完成新建、打开、编辑、保存、另存为、关闭保护及未保存草稿恢复的文件操作闭环。图片资源管理、查找替换和更完整的 Markdown/输入法兼容性仍在后续范围内。

## 下载与启动

从 [GitHub Releases](https://github.com/Chenzy-zero/SuperMarkdown/releases) 下载 Windows x64 安装包或 ZIP。解压版需要完整解压后运行 `SuperMarkdown.exe`，不需要 Node.js、pnpm 或额外的 Electron。

- [0.2.0 版本说明](docs/releases/0.2.0.md)
- [0.2.1 文件关联修复](docs/releases/0.2.1.md)
- [0.2.2 目录、拖拽与工具行](docs/releases/0.2.2.md)
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

文件名、路径、新建/打开/保存、撤销/重做和布局选择统一为正文上方的一行。长路径自动省略，鼠标悬停可查看完整路径；在最小窗口宽度下保持单行。

“显示布局”提供单文件、双文件并排和“预览 + 源码同步”。两侧中间的竖线可拖动，双击恢复等宽；同步布局两侧可编辑且共用保存和撤销记录。

有未保存修改时，关闭文件或系统窗口都会提供“保存 / 不保存 / 取消”。取消保存位置或保存失败均不会关闭文档。恢复草稿独立保存在用户数据目录，重启后提示是否恢复；草稿不会自动覆盖源文件。

## 开发

使用 Node.js 24 和 pnpm 11.25.0，在仓库根目录运行：

```powershell
pnpm install --ignore-scripts
pnpm setup:electron
pnpm start
```

CMD 可先运行 `cd /d E:\codex\SuperMarkdown`；PowerShell 可先运行 `Set-Location E:\codex\SuperMarkdown`。`pnpm prototype` 保留为兼容的启动别名。

若 Electron 下载无法连接，可按 [Electron 官方安装说明](https://www.electronjs.org/docs/latest/tutorial/installation) 在当前终端设置镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_CUSTOM_DIR = '{{ version }}'
pnpm setup:electron
```

下载文件仍按软件包附带的校验值验证。

## 验证与打包

```powershell
pnpm test
pnpm test:app
pnpm test:startup
pnpm test:recovery
pnpm test:opening
pnpm dist:win
```

- `test`：真实文件保存、编码、冲突、失败保护和草稿存储检查。
- `test:app`：真实 Electron 编辑器的完整界面回归，报告和截图写入 `.prototype-artifacts/`。
- `test:startup`：正常空白工作区的新建与保存路径。
- `test:recovery`：先结束一个留下未保存内容的进程，再启动第二个进程验证恢复。
- `test:opening`：通过真实进程和 OS 文件拖拽事件验证系统打开、父目录浏览、左右分屏拖拽、多文件与重复打开保护、恢复等待，以及最小窗口下的单行工具布局。
- `dist:win`：使用 electron-builder 26.18.0 生成 `dist/` 下的 x64 NSIS 安装包及 ZIP，首次构建需要下载 NSIS 等工具。

以上检查使用项目内的临时样本，不操作用户文档。原生文件选择/保存对话框使用固定样本替代，仍需人工检查真实对话框体验。`启动SuperMarkdown.cmd --verify` 可通过不依赖 pnpm 的入口执行界面回归。

对打包后的程序执行同样的回归：

```powershell
$env:SUPERMARKDOWN_VERIFY_OUTPUT = Join-Path $PWD '.prototype-artifacts/packaged'
Start-Process '.\dist\win-unpacked\SuperMarkdown.exe' '--ux-verify' -Wait
node tools/check-recovery.cjs (Join-Path $PWD 'dist/win-unpacked/SuperMarkdown.exe')
node tools/check-file-opening.cjs (Join-Path $PWD 'dist/win-unpacked/SuperMarkdown.exe')
```

发布包自带依赖和第三方许可文件，应用设置和草稿写入用户数据目录。安装包尚未进行代码签名。

## 项目资料

[需求](docs/requirements-v0.1.md) · [项目状态](docs/project-brief.md) · [历史技术验证](docs/technical-evaluation.md) · [界面迭代记录](docs/usability-fixes.md) · [术语](GLOSSARY.md) · [协作规则](AGENTS.md)
