# SuperMarkdown Tauri 2 POC

状态：独立实验分支，不是正式框架迁移决策。

## 目标

验证 SuperMarkdown 能否复用现有 Web 编辑器界面，将 Electron 主进程和 Node.js 文件后端替换为 Tauri 2 + Rust。实验分支为 experiment/tauri-poc，Electron main 分支和现有 Release 保持不变。

## 当前实现范围

- 复用 src/app 下的 HTML、CSS、Vditor、CodeMirror 和 renderer.mjs。
- 新增 tauri-bridge.mjs，兼容现有 window.workspaceFiles 前端接口；Electron preload 仍优先提供原接口。
- 新增 Rust 后端：打开文件夹、父目录、目录树、打开文本文件、创建 Markdown 文件、保存、另存为、按编码重新读取、外部修改冲突检测、恢复草稿、偏好设置、复制路径、在资源管理器中显示、外部链接打开。
- 支持 Windows 文件关联启动、单实例参数转交和原生文件拖放队列。
- 使用独立 Tauri application identifier，不与 Electron 版本共享用户数据目录。
- 保存采用 SHA-256 基线比较、同目录临时文件、写入刷新、替换前再次比较及写后校验。
- 编码覆盖 UTF-8、UTF-8 BOM、UTF-16 LE/BE、ASCII、GBK、GB18030、Big5、Windows-1252 和 Latin-1；无法无损编码时拒绝保存。

## Electron 到 Tauri 的映射

| Electron 当前实现 | Tauri POC |
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

Tauri 使用单独的 dist-tauri/frontend，避免打包后的 index.html 引用 Electron 开发目录中的 node_modules。

tools/prepare-tauri-frontend.cjs 会先构建 CodeMirror 浏览器资源，再复制 src/app 和本地 Vditor dist，并重写 Vditor 资源路径。此操作不会改写 src/app/index.html 或 Electron 构建产物。

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

    cargo test --manifest-path src-tauri/Cargo.toml
    cargo check --manifest-path src-tauri/Cargo.toml

前端资源准备依赖本地 Vditor 包和现有 esbuild 依赖。Tauri 不会访问远程 CDN；应用 CSP 仅开放 Tauri IPC 所需连接。

## 验收重点

1. 启动后空白工作区、主题和偏好设置正常。
2. 打开文件夹，按需展开目录，打开 Markdown/TXT/代码文本。
3. 可视编辑、源码编辑、撤销/重做、双窗格和差异比较保持现有行为。
4. 保存、另存为、只读文件保护、外部修改冲突和恢复草稿完整。
5. UTF-8 BOM、UTF-16 LE/BE、GBK/GB18030、Big5、Windows-1252、Latin-1 往返不丢失；不可表示字符必须拒绝写入。
6. 系统文件关联、第二次启动转交、拖放打开和窗口关闭保护正常。
7. WebView2 Runtime 缺失时离线安装行为明确。
8. 对比 Electron 0.4.0 与 Tauri POC 的安装包/解压体积、冷启动、空闲内存、打开大文件和滚动体验。

## 尚待实测与已知限制

- 本分支代码提交时尚未在 Windows 目标环境完成 cargo check、cargo test 或 Tauri 安装包构建；以 GitHub Actions 结果和后续本机验收为准。
- Rust 文件层尚未覆盖 Electron 现有全部 138 项编辑器 UI 回归及 14 项文件层故障注入场景。
- 真实中文输入法、Windows 文件对话框交互、系统文件关联、第二实例、OS 拖放和 WebView2 Runtime 缺失/离线安装必须人工验收。
- 当前无 Cargo.lock，依赖首次解析后应提交锁文件以便固定版本。
- 现有 Electron 测试专用 testFiles 接口不在 Tauri POC 提供。
- 目前没有同环境的体积、内存和启动时间测量数据；不要把理论上的 WebView 复用优势当成实测结论。
- Windows 替换文件使用 MoveFileExW；非 Windows 使用 std::fs::rename。当前项目首要目标仍是 Windows。

## 决策门槛

只有在真实 Windows 环境通过保存可靠性、编码、恢复、文件关联、拖放和离线 WebView2 验收，并且性能/包体积对比有可重复测量结果后，才讨论是否把 Tauri 作为正式方案。实验分支不合并、不发布、不更改 Electron 主线。
