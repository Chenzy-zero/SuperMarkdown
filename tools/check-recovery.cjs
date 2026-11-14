const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, SUPERMARKDOWN_VERIFY_OUTPUT: path.join(root, '.prototype-artifacts/restart-check') };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv[2] || require('electron');
const entry = process.argv[2] ? [] : [path.join(root, 'src/app/main.cjs')];
const run = flag => new Promise((resolve, reject) => {
  const child = spawn(executable, [...entry, flag], { env, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`恢复验证阶段失败：${flag}，退出码 ${code}`)));
});
(async () => {
  await run('--recovery-prepare');
  await run('--recovery-verify');
  const report = JSON.parse(await fs.readFile(path.join(env.SUPERMARKDOWN_VERIFY_OUTPUT, 'recovery-report.json'), 'utf8'));
  if (!report.checks.every(item => item.passed)) throw new Error('跨进程恢复检查未全部通过。');
})().catch(error => { console.error(error); process.exitCode = 1; });
