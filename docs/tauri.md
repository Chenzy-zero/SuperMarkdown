# SuperMarkdown Tauri 2 后端

状态：**0.5.0 已作为 Windows x64 正式版发布**（tag `v0.5.0`，发布分支 `feature/tauri-promotion`）。Windows CI 的 Rust 测试、现有 Node.js 测试、静态检查和 NSIS 构建均通过。中文输入法、文件关联、拖放、WebView2 离线安装、性能等真实 Windows 人工验收仍需继续完成。

## 目标

复用现有 Web 编辑器界面，用 Tauri 2 + Rust 替换 Electron 主进程和 Node.js 文件后端，使用系统 WebView2 降低安装包体积和常驻内存。正式标识为 `local.supermarkdown`，版本从 0.5.0 起。

## 当前实现范围

- 复用 `src/app` 下的 HTML、CSS、Vditor、CodeMirror 和 `renderer.mjs`。
- 新增 `tauri-bridge.mjs`，兼容现有 `window.workspaceFiles` 前端接口；Electron preload 仍优先提供原接口。
- 新增 Rust 后端：打开文件夹、父目录、目录树、打开文本文件、创建 Markdown 文件、保存、另存为、按编码重新读取、外部修改冲突检测、恢复草稿、偏好设置、复制路径、在资源管理器中显示、外部链接打开。
- 支持 Windows 文件关联启动、单实例参数转交和原生文件拖放队列。
- 保存采用 SHA-256 基线比较、同目录临时文件、写入刷新、替换前再次比较及写后校验。
- 编码覆盖 UTF-8、UTF-8 BOM、UTF-16 LE/BE、ASCII、GBK、GB18030、Big5、Windows-1252 和 Latin-1；无法无损编码时拒绝保存。
- 用户数据目录由 identifier 决定，正式版为 `%APPDATA%\local.supermarkdown`，与 Electron 版和 POC 版隔离。

## Electron 到 Tauri 的映射

| Electron 当前实现 | Tauri 2 实现 |
| --- | --- |
| BrowserWindow | Tauri WebviewWindow |
| Chromium | Windows WebView2 Runtime |
| main.cjs / ipcMain.handle | src-tauri/src/main.rs commands |
| preload.cjs / contextBridge | tauri-bridge.mjs |
| ipcRenderer.invoke | Tauri core.invoke |
| dialog.showOpenDialog | tauri-plugin-dialog |
| app.getPath(userData) | AppHandle.path().app_data_dir() |
| requestSingleInstanceLock | tauri-plugin-single-instance |
| second-instance / open-file | single-instance callback + pending file queue |
| Electron 原生 DragDrop / webUtils | Tauri WindowEvent::DragDrop |
| shell.showItemInFolder | Explorer /select |
| clipboard.writeText | arboard |
| Node fs + crypto | Rust std::fs + sha2 |
| iconv-lite | encoding_rs + UTF-16/Latin-1 专用实现 |
| electron-builder | Tauri Bundler |

## 前端资源准备

Tauri 使用单独的 `dist-tauri/frontend`，避免打包后的 index.html 引用 Electron 开发目录中的 node_modules。

`tools/prepare-tauri-frontend.cjs` 会先构建 CodeMirror 浏览器资源，再复制 `src/app` 和本地 Vditor dist，并重写 Vditor 资源路径。此操作不会改写 `src/app/index.html` 或 Electron 构建产物。

## Windows WebView2 运行环境

正式版安装包使用系统 WebView2 Runtime，不包含固定运行时。目标设备必须具备可用的 WebView2 Runtime；内网或离线终端应提前纳入系统镜像或软件分发流程。

## Windows 环境

建议使用 Windows 10 1803 或 Windows 11。需要：

- Node.js 24 和 pnpm 11.25.0。
- Rust stable 工具链与 Cargo。
- Microsoft C++ Build Tools（MSVC）。
- WebView2 Runtime。
- Tauri CLI 2.x。

WebView2 Runtime 是独立于 Tauri 应用的系统组件。公司镜像如果没有预装 Runtime，必须规划离线安装或 Fixed Runtime；不要假设所有受控终端都能联网下载安装。

## 开发与构建

在仓库根目录运行：

    pnpm install --frozen-lockfile --ignore-scripts
    node tools/prepare-tauri-frontend.cjs
    cargo install tauri-cli --version "^2" --locked
    cargo tauri dev

构建 Windows 安装包：

    node tools/prepare-tauri-frontend.cjs
    cargo tauri build

Rust 单元测试与静态检查：

    cargo test --locked --manifest-path src-tauri/Cargo.toml
    cargo check --locked --manifest-path src-tauri/Cargo.toml

仓库提交 `src-tauri/Cargo.lock`，Rust 依赖以锁文件为准。前端资源准备依赖本地 Vditor 包和现有 esbuild 依赖；Tauri 不访问远程 CDN，应用 CSP 仅开放 Tauri IPC 所需连接。

## 从 POC 迁移用户数据

POC 的 identifier 是 `local.supermarkdown.tauri-poc`，正式版改为 `local.supermarkdown`，`app_data_dir` 随之变化，草稿 `drafts.json` 与偏好 `preferences.json` 不会自动迁移。仅自用时可在关闭两个版本后手动复制：

    $old = Join-Path $env:APPDATA 'local.supermarkdown.tauri-poc'
    $new = Join-Path $env:APPDATA 'local.supermarkdown'
    New-Item -ItemType Directory -Force -Path $new | Out-Null
    Copy-Item (Join-Path $old 'drafts.json') $new -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $old 'preferences.json') $new -ErrorAction SilentlyContinue

先完成或放弃旧版中的草稿再迁移；不要让两个版本同时写同一用户数据目录。没有需要保留的内容时，也可以直接在新版重新打开文件并设置偏好。

## 验收重点

1. 启动后空白工作区、主题和偏好设置正常。
2. 打开文件夹，按需展开目录，打开 Markdown/TXT/代码文本。
3. 可视编辑、源码编辑、撤销/重做、双窗格和差异比较保持现有行为。
4. 保存、另存为、只读文件保护、外部修改冲突和恢复草稿完整。
5. UTF-8 BOM、UTF-16 LE/BE、GBK/GB18030、Big5、Windows-1252、Latin-1 往返不丢失；不可表示字符必须拒绝写入。
6. 系统文件关联、第二次启动转交、拖放打开和窗口关闭保护正常。
7. WebView2 Runtime 缺失时离线安装行为明确。
8. 对比 Electron 0.4.0 与 Tauri 0.5.0 的安装包/解压体积、冷启动、空闲内存、打开大文件和滚动体验。

## 尚待实测与已知限制

- 本分支的 `cargo test`、`cargo check` 与 NSIS 构建由 GitHub Actions 的 Windows runner 执行；本机未安装 MSVC Build Tools，未在本机重复编译。
- Rust 文件层尚未覆盖 Electron 现有全部 138 项编辑器 UI 回归及 14 项文件层故障注入场景。
- 真实中文输入法、Windows 文件对话框交互、系统文件关联与覆盖安装、第二实例、OS 拖放和 WebView2 Runtime 缺失/离线安装必须人工验收。
- 现有 Electron 测试专用 `testFiles` 接口不在 Tauri 版提供，界面回归需要单独的 WebView2 测试宿主。
- 尚无同环境的体积、内存和启动时间对比数据；POC 安装包 8,214,050 字节仅作历史记录，不能替代 0.5.0 实测。
- CI 中 `npx @tauri-apps/cli@2` 仍按次解析版本；Cargo.lock 已固定 Rust 依赖，但正式发布流程还需要固定 Tauri CLI 版本。
- Windows 替换文件使用 MoveFileExW；非 Windows 使用 std::fs::rename。当前项目首要目标仍是 Windows。

## 正式版发布后的验证与完善

1. 在真实 Windows 环境通过保存可靠性、十种编码、恢复、文件关联与覆盖安装、拖放和离线 WebView2 验收。
2. 体积、冷启动、空闲内存和打开大文件耗时有可重复测量，并与 Electron 0.4.0 对照。
3. 发布流程完成参数化（版本与 tag、SHA256SUMS、release notes），并明确代码签名和自动更新策略。
4. 后续版本持续完善发布参数化、代码签名与自动更新策略。以上事项作为 0.5.0 正式版发布后的质量验证与持续完善任务；当前发布范围为 Windows x64。Electron v0.4.0 的历史 Release 保留，不影响 Tauri v0.5.0 成为当前最新正式发行版。
