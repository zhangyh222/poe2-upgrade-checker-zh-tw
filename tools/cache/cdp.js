// tiny CDP helper for local UI checks
const port = process.env.CDP_PORT || 9222;
async function connect(match) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = list.find((x) => x.url.includes(match));
  if (!page) throw new Error('no page ' + match);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const evalJs = (expression) => new Promise((res) => {
    const n = ++id;
    const t = setTimeout(() => res('TIMEOUT'), 30000);
    const onMsg = (e) => {
      const d = JSON.parse(e.data);
      if (d.id !== n) return;
      ws.removeEventListener('message', onMsg);
      clearTimeout(t);
      res(d.result?.result?.value ?? d.error?.message ?? d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  return { evalJs, close: () => ws.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { connect, sleep };
