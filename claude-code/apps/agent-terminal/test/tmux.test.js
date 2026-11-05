'use strict';
// claude inside tmux: the command hook finds the app through the attached
// tmux client's environment. Uses a private tmux socket per test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startHookServer } = require('../src/hook-server');
const { INIT_DIR } = require('../src/shell');

const HOOK = path.join(INIT_DIR, 'claude-hook.sh');
const SETUP = path.join(INIT_DIR, 'omni-tmux-setup.sh');
const has = (bin) => spawnSync('which', [bin]).status === 0;
let pty = null;
try { pty = require('node-pty'); } catch { /* not built for this node */ }
const skip = (!has('tmux') || !has('curl') || !pty) && 'needs tmux, curl and node-pty';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(100); }
  return false;
}

// Runs the hook inside pane `target` with a clean pane environment.
function runHookInPane(sock, target, event, extraEnv = '') {
  const cmd = `env -u OMNI_TERMINAL_ID -u OMNI_CWD_URL -u OMNI_HOOK_TOKEN ${extraEnv} bash ${HOOK} <<< '${JSON.stringify(event)}'`;
  spawnSync('tmux', ['-L', sock, 'send-keys', '-t', target, cmd, 'Enter']);
}

test('hook reaches the app from a tmux session created before the app attached', { skip }, async () => {
  const got = [];
  const srv = await startHookServer({ onEvent: (id, ev) => got.push([id, ev.hook_event_name]), token: 'tok' });
  const sock = `omni-test-${process.pid}`;
  // 1. A session that exists before the app: its server and pane know nothing of the app.
  spawnSync('tmux', ['-L', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'old', '-x', '100', '-y', '30']);
  // 2. An app terminal attaches to it (the client carries the app's variables).
  const client = pty.spawn('tmux', ['-L', sock, 'attach', '-t', 'old'], {
    cols: 100, rows: 30, env: { ...process.env, OMNI_TERMINAL_ID: '7', OMNI_CWD_URL: srv.cwdUrl, OMNI_HOOK_TOKEN: 'tok' },
  });
  try {
    await sleep(700);
    runHookInPane(sock, 'old', { hook_event_name: 'UserPromptSubmit', session_id: 's' });
    assert.ok(await waitFor(() => got.length === 1), 'event delivered');
    assert.deepStrictEqual(got[0], ['7', 'UserPromptSubmit']);

    // A claude started by the app's wrapper already reports: the hook stays quiet.
    runHookInPane(sock, 'old', { hook_event_name: 'Stop' }, 'OMNI_HOOKED=1');
    await sleep(1200);
    assert.strictEqual(got.length, 1);
  } finally {
    client.kill();
    spawnSync('tmux', ['-L', sock, 'kill-server']);
    srv.close();
  }
});

test('hook is a silent no-op outside tmux or with no app client attached', { skip }, async () => {
  const r = spawnSync('bash', [HOOK], { input: '{"hook_event_name":"Stop"}', encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.deepStrictEqual([r.status, r.stdout, r.stderr], [0, '', '']);

  const got = [];
  const srv = await startHookServer({ onEvent: (id) => got.push(id), token: 'tok' });
  const sock = `omni-test2-${process.pid}`;
  spawnSync('tmux', ['-L', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'plain']);
  const client = pty.spawn('tmux', ['-L', sock, 'attach', '-t', 'plain'], { cols: 80, rows: 24, env: { PATH: process.env.PATH, HOME: os.tmpdir(), TERM: 'xterm' } });
  try {
    await sleep(700);
    runHookInPane(sock, 'plain', { hook_event_name: 'Stop' });
    await sleep(1200);
    assert.deepStrictEqual(got, []);
  } finally {
    client.kill();
    spawnSync('tmux', ['-L', sock, 'kill-server']);
    srv.close();
  }
});

test('omni-tmux-setup adds the hook once, keeps other settings, and removes cleanly', { skip: !has('python3') && 'needs python3' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-setup-home-'));
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings));
  const original = {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/true' }] }] },
  };
  fs.writeFileSync(settings, JSON.stringify(original));
  const run = (...args) => spawnSync('bash', [SETUP, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });

  for (let i = 0; i < 2; i++) assert.strictEqual(run().status, 0); // twice: still one copy
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.strictEqual(s.model, 'opus');
  const ours = (ev) => (s.hooks[ev] || []).flatMap((g) => g.hooks).filter((h) => h.command.endsWith('omni-agent-terminal/claude-hook.sh'));
  for (const ev of ['UserPromptSubmit', 'PreToolUse', 'Stop', 'SubagentStop', 'TeammateIdle', 'SessionEnd']) assert.strictEqual(ours(ev).length, 1, ev);
  assert.ok(s.hooks.Stop.some((g) => g.hooks.some((h) => h.command === '/usr/bin/true')), 'user hook kept');
  assert.ok(fs.statSync(path.join(home, '.local/share/omni-agent-terminal/claude-hook.sh')).mode & 0o111);
  assert.ok(fs.readdirSync(path.dirname(settings)).some((f) => f.startsWith('settings.json.omni-backup-')));

  assert.strictEqual(run('--remove').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original);
  assert.ok(!fs.existsSync(path.join(home, '.local/share/omni-agent-terminal/claude-hook.sh')));
});
