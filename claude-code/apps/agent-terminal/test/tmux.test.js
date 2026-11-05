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
const STATUSLINE = path.join(INIT_DIR, 'claude-statusline.sh');
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

  assert.deepStrictEqual(s.statusLine, { type: 'command', command: path.join(home, '.local/share/omni-agent-terminal/claude-statusline.sh') });

  assert.strictEqual(run('--remove').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original);
  assert.ok(!fs.existsSync(path.join(home, '.local/share/omni-agent-terminal/claude-hook.sh')));
  assert.ok(!fs.existsSync(path.join(home, '.local/share/omni-agent-terminal/claude-statusline.sh')));
});

test('omni-tmux-setup wraps the user status line and gives it back on --remove', { skip: !has('python3') && 'needs python3' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-setup-sl-'));
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings));
  const mine = { type: 'command', command: 'echo "mine $(cat | wc -c)"', padding: 1, refreshInterval: 30 };
  const original = { statusLine: mine };
  fs.writeFileSync(settings, JSON.stringify(original));
  const run = (...args) => spawnSync('bash', [SETUP, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
  const dest = path.join(home, '.local/share/omni-agent-terminal');

  for (let i = 0; i < 2; i++) assert.strictEqual(run().status, 0); // the second run must not save ours as the original
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepStrictEqual(s.statusLine, { ...mine, command: path.join(dest, 'claude-statusline.sh') }, 'padding and refreshInterval kept');
  assert.strictEqual(fs.readFileSync(path.join(dest, 'statusline-orig.cmd'), 'utf8'), mine.command);
  // Outside tmux it only runs the user's line, with the same input.
  const out = spawnSync('bash', [path.join(dest, 'claude-statusline.sh')], { input: '12345', encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.deepStrictEqual([out.status, out.stdout], [0, 'mine 5\n']);

  assert.strictEqual(run('--remove').status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original);
  assert.ok(!fs.existsSync(path.join(dest, 'statusline-orig.cmd')));
});

test('the tmux status line reports to the app terminal showing the session', { skip }, async () => {
  const got = [];
  const srv = await startHookServer({ onEvent() {}, onStatusLine: (id, d) => got.push([id, d]), token: 'tok' });
  const sock = `omni-test-sl-${process.pid}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-sl-'));
  const script = path.join(dir, 'claude-statusline.sh');
  fs.copyFileSync(STATUSLINE, script);
  fs.writeFileSync(path.join(dir, 'statusline-orig.cmd'), 'cat > ' + path.join(dir, 'orig-ran'));
  spawnSync('tmux', ['-L', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'sl', '-x', '100', '-y', '30']);
  const client = pty.spawn('tmux', ['-L', sock, 'attach', '-t', 'sl'], {
    cols: 100, rows: 30, env: { ...process.env, OMNI_TERMINAL_ID: '4', OMNI_CWD_URL: srv.cwdUrl, OMNI_HOOK_TOKEN: 'tok' },
  });
  const input = { session_id: 's', rate_limits: { five_hour: { used_percentage: 12, resets_at: 1793893800 } } };
  const send = (extraEnv = '') => spawnSync('tmux', ['-L', sock, 'send-keys', '-t', 'sl',
    `env -u OMNI_TERMINAL_ID -u OMNI_CWD_URL -u OMNI_HOOK_TOKEN ${extraEnv} bash ${script} <<< '${JSON.stringify(input)}'`, 'Enter']);
  try {
    await sleep(700);
    send();
    assert.ok(await waitFor(() => got.length === 1), 'status delivered');
    assert.deepStrictEqual(got[0], ['4', input]);
    assert.ok(await waitFor(() => fs.existsSync(path.join(dir, 'orig-ran'))), "the user's line ran");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'orig-ran'), 'utf8')), input);
    // Run from the app's own status line (wrapper claude): no second report.
    send('OMNI_HOOKED=1');
    await sleep(1200);
    assert.strictEqual(got.length, 1);
  } finally {
    client.kill();
    spawnSync('tmux', ['-L', sock, 'kill-server']);
    srv.close();
  }
});

test('the app bash installs the tmux hook by itself once, then stays quiet', { skip: (!has('tmux') || !has('python3')) && 'needs tmux and python3' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-auto-home-'));
  const run = (extra = {}) => spawnSync('bash', ['--rcfile', path.join(INIT_DIR, 'omni.bash'), '-i'], {
    input: 'exit\n', encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, OMNI_CWD_URL: 'http://127.0.0.1:9/cwd', OMNI_HOOK_TOKEN: 't', OMNI_TERMINAL_ID: '1', ...extra },
  });
  const settings = path.join(home, '.claude', 'settings.json');

  const skipped = run({ OMNI_NO_AUTO_SETUP: '1' });
  assert.ok(!fs.existsSync(settings), 'opt-out respected');
  assert.doesNotMatch(skipped.stdout + skipped.stderr, /\[Omni\] tmux/);

  const first = run();
  assert.match(first.stdout + first.stderr, /tmux 안의 claude도 상태가 표시되도록 설정했습니다/);
  assert.ok(fs.readFileSync(settings, 'utf8').includes('omni-agent-terminal/claude-hook.sh'));
  assert.ok(fs.readFileSync(settings, 'utf8').includes('omni-agent-terminal/claude-statusline.sh'));

  const backups = () => fs.readdirSync(path.dirname(settings)).filter((f) => f.includes('omni-backup')).length;
  const before = backups();
  const second = run();
  assert.doesNotMatch(second.stdout + second.stderr, /\[Omni\] tmux/);
  assert.strictEqual(backups(), before, 'already current: nothing rewritten');
});

test('clicking a split-pane teammate selects its tmux pane (real tmux, real hook)', { skip }, async () => {
  const { SessionManager } = require('../src/sessions');
  const { runTmux } = require('../src/tmux');
  const sock = `omni-focus-${process.pid}`;
  const srv = await startHookServer({ onEvent: (id, ev, meta) => m.onHookEvent(id, ev, meta), token: 'tok' });
  const fake = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const m = new SessionManager({ spawn: fake, emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0, runTmux });
  const { id } = m.create({});
  spawnSync('tmux', ['-L', sock, '-f', '/dev/null', 'new-session', '-d', '-s', 'team', '-x', '120', '-y', '40']);
  spawnSync('tmux', ['-L', sock, 'split-window', '-t', 'team']); // pane %1, now active
  const client = pty.spawn('tmux', ['-L', sock, 'attach', '-t', 'team'], {
    cols: 120, rows: 40, env: { ...process.env, OMNI_TERMINAL_ID: id, OMNI_CWD_URL: srv.cwdUrl, OMNI_HOOK_TOKEN: 'tok' },
  });
  const active = () => spawnSync('tmux', ['-L', sock, 'display-message', '-p', '-t', 'team', '#{pane_id}'], { encoding: 'utf8' }).stdout.trim();
  try {
    await sleep(700);
    runHookInPane(sock, 'team:0.0', { hook_event_name: 'UserPromptSubmit', session_id: 'lead' });
    runHookInPane(sock, 'team:0.1', { hook_event_name: 'TeammateIdle', session_id: 'mate', agent_type: 'general-purpose', teammate_name: 'alpha' });
    assert.ok(await waitFor(() => m.list()[0].claude.agents.some((a) => a.name === 'alpha' && a.focusable)), 'alpha listed and focusable');
    assert.ok(m.list()[0].claude.focusable, 'lead focusable');
    assert.strictEqual(await m.focusPane(id, 'main'), true);
    assert.strictEqual(active(), '%0');
    assert.strictEqual(await m.focusPane(id, 'session:mate'), true);
    assert.strictEqual(active(), '%1');
    assert.strictEqual(await m.focusPane(id, 'session:nope'), false);
  } finally {
    client.kill();
    spawnSync('tmux', ['-L', sock, 'kill-server']);
    srv.close();
  }
});

test('runTmux goes through wsl.exe on Windows and checks the distro name', async () => {
  const { runTmux } = require('../src/tmux');
  const calls = [];
  const exec = (f, a, o, cb) => { calls.push([f, a]); cb(null); };
  await runTmux(['select-pane', '-t', '%3'], 'Ubuntu-24.04', 'win32', exec);
  await runTmux(['select-pane', '-t', '%3'], 'bad name; rm', 'win32', exec);
  await runTmux(['select-pane', '-t', '%3'], null, 'linux', exec);
  assert.deepStrictEqual(calls, [
    ['wsl.exe', ['-d', 'Ubuntu-24.04', '-e', 'tmux', 'select-pane', '-t', '%3']],
    ['wsl.exe', ['-e', 'tmux', 'select-pane', '-t', '%3']],
    ['tmux', ['select-pane', '-t', '%3']],
  ]);
});
