const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appSource = path.join(root, "src", "app");
const output = path.join(root, "dist-tauri", "frontend");
const vditorSource = path.join(root, "node_modules", "vditor", "dist");

async function main() {
  const build = spawnSync(process.execPath, [path.join(root, "tools", "build-editor.cjs")], {
    cwd: root,
    stdio: "inherit"
  });
  if (build.status !== 0) {
    throw new Error("CodeMirror 浏览器资源构建失败。");
  }

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.cp(appSource, output, { recursive: true });
  await fs.cp(vditorSource, path.join(output, "vendor", "vditor", "dist"), { recursive: true });

  const indexPath = path.join(output, "index.html");
  let html = await fs.readFile(indexPath, "utf8");
  html = html
    .replaceAll("../../node_modules/vditor/dist/index.css", "./vendor/vditor/dist/index.css")
    .replaceAll("../../node_modules/vditor/dist/index.min.js", "./vendor/vditor/dist/index.min.js")
    .replaceAll("../../node_modules/vditor/dist/js/icons/ant.js", "./vendor/vditor/dist/js/icons/ant.js");
  html = html.replace("connect-src 'none'", "connect-src 'self' ipc: http://ipc.localhost");
  await fs.writeFile(indexPath, html, "utf8");

  console.log("Tauri 前端资源已准备：", output);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
