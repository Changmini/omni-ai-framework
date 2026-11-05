'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 1024 * 1024;

// Receives Claude Code HTTP hooks (type "http" POSTs the event JSON) on
// 127.0.0.1. Requests must carry the per-run token; the terminal id header
// says which terminal's claude sent the event.
function startHookServer({ onEvent, token = crypto.randomBytes(24).toString('hex'), port = 0 }) {
  const server = http.createServer((req, res) => {
    // Always answer 2xx with an empty body: hooks then neither block nor
    // change any decision (PermissionRequest, TaskCompleted, ...).
    const done = (code) => { res.writeHead(code); res.end(); };
    if (req.method !== 'POST' || req.url !== '/hook') return done(404);
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
      if (ev && typeof ev === 'object' && terminalId) onEvent(terminalId, ev);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, token, port: server.address().port, close: () => server.close() });
    });
  });
}

module.exports = { startHookServer };
