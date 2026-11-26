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
  const meta = { pane: field('pane') || '', title: field('title') || '', socket: field('socket') || '', server: field('server') || '' };
  return [ev.hook_event_name ? ev : null, meta];
}

// Receives, on 127.0.0.1:
//   POST /hook - Claude Code HTTP hooks (type "http" POSTs the event JSON)
//   POST /cwd  - {"cwd", "wslDistro"?, "home"?} from the app's shell integration
//   POST /status - the status line input (claude-settings.js): plan usage,
//                  session id and name
// Requests must carry the per-run token; the terminal id header says which
// terminal sent them.
// Answers are 2xx with an empty body, so hooks neither block nor change any
// decision (PermissionRequest, TaskCompleted, ...). One exception: for
// UserPromptSubmit, PreToolUse and PostToolUse (a subagent's too),
// `onReply(terminalId, event)` may return hookSpecificOutput fields (the
// automation rules, rules.js): additionalContext, which Claude Code adds to
// Claude's context next to the prompt or the tool call, and, before a tool,
// permissionDecision "deny" or "ask" with its reason
// (https://code.claude.com/docs/en/hooks: an HTTP hook's JSON body uses the
// command hooks' output format; verified on Claude Code 2.1.331).
const REPLY_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse']);

function startHookServer({ onEvent, onCwd = () => {}, onStatusLine = () => {}, onReply = () => null, token = crypto.randomBytes(24).toString('hex'), port = 0 }) {
  const server = http.createServer((req, res) => {
    const done = (code, body = '') => {
      res.writeHead(code, body ? { 'Content-Type': 'application/json' } : undefined);
      res.end(body);
    };
    if (req.method !== 'POST' || !['/hook', '/cwd', '/status'].includes(req.url)) return done(404);
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
      if (!terminalId) return done(200);
      if (size > MAX_BODY) {
        done(200);
        const [big, meta] = salvage(Buffer.concat(chunks).subarray(0, HEAD_KEEP).toString('utf8'));
        if (big && req.url === '/hook') onEvent(terminalId, big, meta);
        return;
      }
      let ev;
      try { ev = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return done(200); }
      if (!ev || typeof ev !== 'object') return done(200);
      // claude-hook.sh (tmux) sends without waiting for the answer: nothing to add there.
      const out = req.url === '/hook' && !ev.omni && REPLY_EVENTS.has(ev.hook_event_name)
        ? onReply(terminalId, ev) : null;
      done(200, out ? JSON.stringify({ hookSpecificOutput: { ...out, hookEventName: ev.hook_event_name } }) : '');
      if (req.url === '/cwd') {
        if (typeof ev.cwd === 'string' && ev.cwd) onCwd(terminalId, ev);
      } else if (req.url === '/status') {
        onStatusLine(terminalId, ev);
      } else if (ev.omni && ev.event && typeof ev.event === 'object') {
        // From claude-hook.sh (tmux): { omni: { pane, title, socket, server }, event }
        const meta = {
          pane: String(ev.omni.pane || ''), title: String(ev.omni.title || ''), socket: String(ev.omni.socket || ''), server: String(ev.omni.server || ''),
        };
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
