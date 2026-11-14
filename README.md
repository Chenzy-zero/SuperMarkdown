# SuperMarkdown

面向 Windows 的 Markdown 所见即所得编辑器项目。

首版需求已经整体确认，当前进入技术选型与最小原型验证。初期功能参考 Typora 和 Markdown All in One，具体范围见首版需求确认稿。

## 项目资料

- [项目起点与待确认问题](docs/project-brief.md)
- [首版需求确认稿](docs/requirements-v0.1.md)
- [技术选型与原型结果](docs/technical-evaluation.md)
- [原型试用步骤](experiments/editor-spike/README.md)
- [本轮界面修正与验证](docs/usability-fixes.md)
- [领域术语](GLOSSARY.md)
- [开发协作规则](AGENTS.md)
- [GitHub 任务管理](docs/agents/issue-tracker.md)
- [任务分流标签](docs/agents/triage-labels.md)
- [领域文档约定](docs/agents/domain.md)

## 下载 Windows v0.1.0

从 [GitHub Release](https://github.com/Chenzy-zero/SuperMarkdown/releases/tag/v0.1.0) 下载 Windows x64 安装包或 ZIP 解压包。完整解压 ZIP 后运行其中的 `SuperMarkdown.exe`，无需安装 Node.js 或 pnpm。版本说明见 [v0.1.0](docs/releases/0.1.0.md)。

**本版仍是原型：正文修改仅保存在当前窗口中，尚未实现保存回文件。关闭前请复制保留内容。**

## 直接打开已准备好的原型

在资源管理器中打开项目文件夹，双击 [启动SuperMarkdown.cmd](启动SuperMarkdown.cmd)。此入口直接启动项目内已安装的 Electron，不要求普通终端能找到 Node.js 或 pnpm，也不要求先进入项目目录。

旧窗口不会自动加载源文件修改。先保留旧窗口中需要的内容，再关闭并用此入口重新打开。

## 开发准备

使用 Node.js 24 与 pnpm 11.25.0。在仓库根目录运行：

```powershell
pnpm install --ignore-scripts
pnpm setup:electron
pnpm prototype
```

`pnpm prototype` 是开发启动命令，可在 CMD、PowerShell 或编辑器终端使用，前提是终端能找到 pnpm，并且当前目录是项目根目录。CMD 可以先运行 `cd /d E:\codex\SuperMarkdown`，PowerShell 可以先运行 `Set-Location E:\codex\SuperMarkdown`。如果提示找不到 pnpm，已准备好的项目直接使用上面的双击入口即可。

原型位于 `experiments/editor-spike/`，运行于 Electron 桌面窗口。左侧点击“打开文件夹”选择本地目录，可展开子文件夹；Markdown 默认可视编辑，TXT、代码及其他文本文件以纯文本打开。可使用“刷新目录”重新列出文件。

左侧支持“新建 Markdown”按钮，也可右键目录中的文件或子文件夹，选择打开、在右侧打开、新建 Markdown、复制完整路径、在文件夹中显示及刷新目录。新建会在所选目录实际创建空白 `.md` 文件，同名文件不会被覆盖。

正文上方的“显示布局”可选择单文件、双文件并排或“预览 + 源码同步”。双文件可分别编辑；文件标签页右键“移到右侧显示”也可进入分屏。同步布局中，同一篇 Markdown 左侧直接编辑排版正文、右侧编辑源码，两边即时更新并共享撤销与重做记录。

`Ctrl+W` 关闭当前编辑的文件，有未保存修改时先提示；分屏时作用于当前侧的文档。Markdown 的可视编辑与源码使用统一的居中阅读宽度。拖动两侧中间的竖线可调整宽度，双击恢复等宽；也可用 Tab 聚焦竖线后按左右方向键调整。本次窗口内切换布局会保留调整后的比例。

当前原型支持读取真实文件和创建空白 Markdown 文件，编辑修改仍仅保留在内存中，关闭窗口即丢失；将编辑结果保存回文件的功能仍待实现。

执行 `pnpm prototype:check` 可运行真实编辑器与文件夹浏览的自动验证，并将报告、Markdown 和纯文本窗口截图写入 `.prototype-artifacts/`。检查使用项目内生成的临时文件夹，文件夹选择对话框仍需手动试用。

`pnpm prototype:ux-check` 额外回归宽窗口布局、目录字号、浮动菜单、链接、快捷键、标签页关闭、文件创建及分屏同步。也可运行 `启动SuperMarkdown.cmd --verify`，通过不依赖 pnpm 的入口执行同一轮界面验证。

正式应用的完整文件读写、图片落盘、恢复、安装包等能力仍待实现。正式编辑器内核将在原型结果评估后确定。

如果 Electron 官方运行文件下载长时间没有进展，可在当前 PowerShell 会话中使用官方文档提供的镜像，再运行安装步骤：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_CUSTOM_DIR = '{{ version }}'
pnpm setup:electron
```

此设置仅影响当前会话；下载文件仍按 Electron 软件包附带的校验值验证。参考 [Electron 安装说明](https://www.electronjs.org/docs/latest/tutorial/installation)。

## 构建 Windows 发布包

完成开发准备后，在 Windows 仓库根目录运行 `pnpm dist:win`。使用固定的 electron-builder 26.18.0 生成 `dist/` 下的 x64 NSIS 安装包和 ZIP；首次构建会下载 NSIS 等工具。打包配置参考 [electron-builder 官方说明](https://www.electron.build/configuration/)，仅将应用、运行依赖和版本说明装入应用归档。

安装版的应用设置写入用户数据目录，不写入安装目录。程序包暂未进行代码签名。可按以下方式针对构建产物运行同一套界面回归：

```powershell
$env:SUPERMARKDOWN_VERIFY_OUTPUT = Join-Path $PWD '.prototype-artifacts/packaged'
& '.\dist\win-unpacked\SuperMarkdown.exe' --ux-verify
```

报告与截图写入指定目录；验证仍使用临时样本，不操作用户工作文件。发布附件使用 SHA-256 校验值核对，构建产物与验证报告不提交到源码仓库。
