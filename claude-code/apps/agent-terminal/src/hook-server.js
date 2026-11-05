'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 8 * 1024 * 1024;
const HEAD_KEEP = 64 * 1024;

// For a body too large to keep (e.g. a Write of a huge file), the fields the
// status needs, taken from the start of the JSON. Returns [event, meta].
function salvage(head) {
  const field = (key) => {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head);
    if (!m) return undefined;
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  };
  const ev = {};
  for (const k of ['hook_event_name', 'session_id', 'agent_id', 'agent_type', 'tool_name', 'tool_use_id',
    'notification_type', 'cwd', 'transcript_path']) {
    const v = field(k);
    if (v !== undefined) ev[k] = v;
  }
  // For the activity log: the file a Write/Edit is about (before its content).
  const file = field('file_path');
  if (file !== undefined) ev.tool_input = { file_path: file };
  const meta = { pane: field('pane') || '', title: field('title') || '', socket: field('socket') || '' };
  return [ev.hook_event_name ? ev : null, meta];
}

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
      // Past the limit keep reading (and answer 200, so Claude reports no
      // hook error) but stop keeping the body.
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      done(200);
      if (!terminalId) return;
      if (size > MAX_BODY) {
        const [big, meta] = salvage(Buffer.concat(chunks).subarray(0, HEAD_KEEP).toString('utf8'));
        if (big && req.url === '/hook') onEvent(terminalId, big, meta);
        return;
      }
      let ev;
      try { ev = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return; }
      if (!ev || typeof ev !== 'object') return;
      if (req.url === '/cwd') {
        if (typeof ev.cwd === 'string' && ev.cwd) onCwd(terminalId, ev);
      } else if (ev.omni && ev.event && typeof ev.event === 'object') {
        // From claude-hook.sh (tmux): { omni: { pane, title }, event }
        const meta = { pane: String(ev.omni.pane || ''), title: String(ev.omni.title || ''), socket: String(ev.omni.socket || '') };
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
