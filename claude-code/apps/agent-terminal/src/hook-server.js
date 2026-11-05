'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 1024 * 1024;

// Receives, on 127.0.0.1:
//   POST /hook - Claude Code HTTP hooks (type "http" POSTs the event JSON)
//   POST /cwd  - {"cwd", "wslDistro"?, "home"?} from the app's shell integration
// Requests must carry the per-run token; the terminal id header says which
// terminal sent them.
function startHookServer({ onEvent, onCwd = () => {}, token = crypto.randomBytes(24).toString('hex'), port = 0 }) {
  const server = http.createServer((req, res) => {
    // Always answer 2xx with an empty body: hooks then neither block nor
    // change any decision (PermissionRequest, TaskCompleted, ...).
    const done = (code) => { res.writeHead(code); res.end(); };
    if (req.method !== 'POST' || (req.url !== '/hook' && req.url !== '/cwd')) return done(404);
    if (req.headers['x-omni-token'] !== token) return done(403);
    const terminalId = String(req.headers['x-omni-terminal'] || '');
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      done(200);
      let ev;
      try { ev = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; }
      if (!ev || typeof ev !== 'object' || !terminalId) return;
      if (req.url === '/cwd') {
        if (typeof ev.cwd === 'string' && ev.cwd) onCwd(terminalId, ev);
      } else if (ev.omni && ev.event && typeof ev.event === 'object') {
        // From claude-hook.sh (tmux): { omni: { pane, title }, event }
        const meta = { pane: String(ev.omni.pane || ''), title: String(ev.omni.title || '') };
        onEvent(terminalId, ev.event, meta);
      } else {
        onEvent(terminalId, ev, {});
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({ server, token, port: p, cwdUrl: `http://127.0.0.1:${p}/cwd`, close: () => server.close() });
    });
  });
}

module.exports = { startHookServer };
