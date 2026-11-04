'use strict';
// Runs a real shell through node-pty. Skipped when node-pty has no binary
// built for this Node version (it is normally built for Electron).
const test = require('node:test');
const assert = require('node:assert');
const { SessionManager } = require('../src/sessions');

let pty = null;
try { pty = require('node-pty'); } catch { /* not built for plain node */ }

test('real shell echoes a command sent from the UI', { skip: !pty && 'node-pty not loadable' }, async () => {
  let out = '';
  const m = new SessionManager({
    spawn: pty.spawn,
    emit: (ch, p) => { if (ch === 'session:data') out += p.data; },
    shell: process.platform === 'win32' ? { file: 'powershell.exe', args: ['-NoLogo'] } : { file: '/bin/sh', args: [] },
    pollMs: 0,
  });
  const { id } = m.create({ command: 'echo omni-$((20+22))' });
  const deadline = Date.now() + 5000;
  while (!out.includes('omni-42') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  m.killAll();
  assert.ok(out.includes('omni-42'), `output was: ${JSON.stringify(out)}`);
  assert.ok(id);
});
