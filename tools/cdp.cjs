const net = require('node:net');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, limit = 5000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { try { if (await action()) return true; } catch {} await sleep(80); }
  return false;
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function connect(port) {
  let page;
  if (!await until(async () => { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page'); return page?.webSocketDebuggerUrl; }, 12000)) throw new Error('无法连接隔离测试窗口。');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map();
  socket.onclose = () => { for (const request of pending.values()) request.reject(new Error('测试窗口已关闭。')); pending.clear(); };
  socket.onmessage = event => {
    const result = JSON.parse(event.data); if (!result.id) return;
    const request = pending.get(result.id); pending.delete(result.id);
    if (result.error || result.result?.exceptionDetails) request?.reject(new Error(JSON.stringify(result.error || result.result.exceptionDetails)));
    else request?.resolve(result.result);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { close: () => socket.close(), send, evaluate: expression => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).then(result => result.result?.value) };
}

module.exports = { connect, freePort, until, sleep };
