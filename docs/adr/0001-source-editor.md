# 源码与代码编辑视图采用 CodeMirror

状态：2026-11-15 采纳。

用户需要本地代码着色及选中多行后的同步输入。原有 textarea 仅有单个选区；自行叠加颜色层和模拟多个插入点会额外维护滚动、选区和中文输入的一致性。

采用 CodeMirror 6 处理源码/纯文本的语法、行号和多光标，Vditor 继续负责 Markdown 可视编辑。语言包与组件通过 esbuild 打进本地资源，禁止运行时网络依赖。文件内容、保存基线、换行编码、恢复草稿及跨模式撤销继续由应用持有；不启用 CodeMirror 的另一套历史。

视图适配提供既有内容、光标和滚动接口，程序赋值不会被记为用户输入。语言异步加载只允许最后一次文件上下文生效。Markdown 源码保留与可视正文一致的对称阅读留白。

代价是新增构建步骤与语言包体积。构建已接入开发启动和 Windows 打包；未知语言回退普通文本。语法颜色不代表语义分析，也不执行代码。

依据：[CodeMirror 基本配置](https://codemirror.net/examples/basic/)、[状态与多选区 API](https://codemirror.net/docs/ref/)、[语言包](https://github.com/codemirror/language-data)。
