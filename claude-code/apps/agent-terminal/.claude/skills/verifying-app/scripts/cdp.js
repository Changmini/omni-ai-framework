// Runs a small script against the app's main window over raw CDP (works
// where Playwright fails: pages with nested cross-origin frames).
//   node cdp.js <script.js> [--page preview]   (default: the main window)
// The script's body runs in an async function with:
//   ev(expr)            evaluate in the page, returns the value (await it)
//   send(method, params) any CDP command
//   sleep(ms), key(code, {ctrl, shift}), type(text)   (keyboard to the focused element)
// In the page: agentApi (write, kill, list, ...), agents, activeId and the
// other top-level names of renderer.js.
const fs = require('fs');
const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('usage: node cdp.js <script.js> [--page preview]'); process.exit(2); }
const want = rest[0] === '--page' && rest[1] === 'preview' ? '/preview.html' : '/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const t = list.find((x) => x.type === 'page' && x.url.endsWith(want));
  if (!t) throw new Error(`no ${want} page (is the app running? scripts/launch.sh)`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let n = 0;
  const wait = new Map();
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (wait.has(d.id)) { wait.get(d.id)(d.error ? { error: d.error } : d.result); wait.delete(d.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result ? r.result.value : r;
  };
  const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const key = (code, mods = {}) => send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', code, key: code.replace(/^Key/, ''), windowsVirtualKeyCode: code.replace(/^Key/, '').charCodeAt(0),
    modifiers: Object.entries(mods).reduce((m, [k, on]) => (on ? m | MOD[k] : m), 0),
  });
  const type = (text) => send('Input.insertText', { text });
  const body = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line no-new-func
  await new Function('ev', 'send', 'sleep', 'key', 'type', `return (async () => { ${body} })();`)(ev, send, sleep, key, type);
  ws.close();
  process.exit(0); // the socket's close handshake can otherwise keep node running
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
