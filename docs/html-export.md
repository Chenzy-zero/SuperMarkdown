# 独立 HTML 导出（Issue #11）

在 Tauri 的“文件 → 导出单文件 HTML…”中选择位置。导出使用当前活动 Markdown 的内存快照，包括未保存修改；不要求保存源文档，不改变保存身份、基线或 Undo/Redo。导出期间切换文档仍使用原快照。取消返回取消状态，失败保留源文件和既有输出。

首版选择单文件 HTML：CSS、代码着色和允许的本地图片全部内联，没有外部 CSS、脚本、字体或 CDN 依赖。图片可来自已保存 Markdown 所在目录或子目录，不限定 `.assets`。路径解码一次，拒绝父路径、绝对路径、UNC、盘符/ADS、符号链接及 Windows reparse point，并复核规范路径包含关系、8 MiB 上限和 PNG/JPEG/GIF/WebP 魔数。最多 128 张、总计 32 MiB；HTML 上限 64 MiB。未保存文档没有可信图片目录；远程、越界、损坏或超限图片显示占位，成品顶部及状态栏有警告，不联网取图。

导出使用本地 Vditor/Lute Markdown 解析器和本地 highlight.js。标题、列表、表格、代码和安全链接保留；公式与图表当前降级为可读源码并提示。原始脚本、样式、iframe、SVG/MathML、表单等不会执行，部分显示为源码。静态内容经标签和属性白名单重新构建，丢弃事件、内联 CSS、srcset、任意文件链接；仅允许 http/https/mailto/页内链接。成品有独立 CSP，禁止脚本、外部资源、表单和 base URL。

输出目标由系统保存对话框授权并确认覆盖，后端仅接受 `.html`/`.htm`，拒绝所有已打开的文件身份及链接/目录。通过既有临时文件、同步与原子替换写入，不把导出 HTML 注册成新的工作文档。另存为迁移、PDF/打印及动态公式/图表渲染不在本轮范围；#12 可复用 `buildStandaloneHtml` 返回的 HTML、固定 CSS 和警告。

样本：[静态 HTML](html-export-sample.html)，输入见 `tests/fixtures/html-export.md`。

验证命令：`node --test tests/html-export.test.cjs`、`node --test tests/*.test.cjs`、`node tools/prepare-tauri-frontend.cjs`、`cargo test --locked --manifest-path src-tauri/Cargo.toml`、`cargo check --locked --manifest-path src-tauri/Cargo.toml`。本机无 Cargo 时应明确记录未测，不能将 Node 测试当作 Rust 或 Windows 验收。

人工验收：断网在独立浏览器打开样本；Tauri 中以未保存正文导出，验证左右窗格快照、中文/空格路径、覆盖 HTML 确认、取消、只读目录、图片丢失和错误格式；确认源保存标记与 Undo/Redo 不变。Windows 原生保存框、WebView2 与 reparse point 仍需实际设备验收。

已知边界：字体依赖系统字体，代码未识别语言按可读源码显示；魔数校验不是完整图片解码，浏览器可能拒绝损坏图片；本地跨进程文件替换竞争属于已有文件系统边界，路径复核不能消除全部 TOCTOU 风险。
