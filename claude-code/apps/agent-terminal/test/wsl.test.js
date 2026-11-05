'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { wslToWindows, withWslEnv } = require('../src/wsl');
const { SessionManager } = require('../src/sessions');
const { startHookServer } = require('../src/hook-server');
const { INIT_DIR } = require('../src/shell');

test('wslToWindows maps drive mounts and distro paths', () => {
  assert.strictEqual(wslToWindows('/mnt/c/Users/limaw/proj', 'Ubuntu'), 'C:\\Users\\limaw\\proj');
  assert.strictEqual(wslToWindows('/mnt/d', 'Ubuntu'), 'D:\\');
  assert.strictEqual(wslToWindows('/home/limaw/proj', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\home\\limaw\\proj');
  assert.strictEqual(wslToWindows('/home/limaw', null), null);
  assert.strictEqual(wslToWindows('C:\\x', 'Ubuntu'), null);
});

test('withWslEnv appends the app variables once', () => {
  assert.strictEqual(withWslEnv(''), 'OMNI_TERMINAL_ID:OMNI_HOOK_TOKEN:OMNI_CWD_URL:OMNI_CLAUDE_SETTINGS/p:OMNI_INIT_BASH/p');
  const once = withWslEnv('FOO/u');
  assert.ok(once.startsWith('FOO/u:OMNI_TERMINAL_ID'));
  assert.strictEqual(withWslEnv(once), once);
});

test('a WSL folder report maps git and ~/.claude lookups through \\\\wsl.localhost', () => {
  const seen = { git: [], team: [] };
  const fake = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const m = new SessionManager({
    spawn: fake, emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    gitBranch: (d) => { seen.git.push(d); return null; },
    readTeam: (sid, base) => { seen.team.push(base); return null; },
  });
  const { id } = m.create({ cwd: 'C:\\Users\\limaw' });
  m.reportShellCwd(id, { cwd: '/home/limaw/proj', wslDistro: 'Ubuntu', home: '/home/limaw' });
  assert.strictEqual(seen.git.at(-1), '\\\\wsl.localhost\\Ubuntu\\home\\limaw\\proj');
  assert.strictEqual(m.list()[0].cwd, '/home/limaw/proj');
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/home/limaw/proj' });
  m.onHookEvent(id, { hook_event_name: 'TaskCreated' });
  assert.strictEqual(seen.team.at(-1), '\\\\wsl.localhost\\Ubuntu\\home\\limaw\\.claude');
  // Back in PowerShell: a report without a distro clears the WSL mapping.
  m.reportShellCwd(id, { cwd: 'C:\\Users\\limaw' });
  assert.strictEqual(seen.git.at(-1), 'C:\\Users\\limaw');
});

function runBash(env, script) {
  return new Promise((resolve) => {
    const p = spawn('bash', ['--rcfile', path.join(INIT_DIR, 'omni.bash'), '-i'], {
      env: { PATH: process.env.PATH, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'omni-home-')), PS1: '$ ', ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
    p.stdin.end(script);
  });
}

test('omni.bash inside WSL reports folder, distro and home, and warns when unreachable', { skip: !fs.existsSync('/usr/bin/curl') && 'curl missing' }, async () => {
  const got = [];
  const srv = await startHookServer({ onEvent() {}, onCwd: (id, r) => got.push([id, r]), token: 'tok' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-wsl-'));
  try {
    const env = { OMNI_CWD_URL: srv.cwdUrl, OMNI_HOOK_TOKEN: 'tok', OMNI_TERMINAL_ID: '4', WSL_DISTRO_NAME: 'Ubuntu', OMNI_CLAUDE_SETTINGS: '/mnt/c/x.json' };
    const out = await runBash(env, `cd ${tmp}\ntrue\ntype claude | head -1\nsleep 0.5\nexit\n`);
    assert.doesNotMatch(out, /연결할 수 없습니다/);
    assert.match(out, /claude is a function/);
    assert.strictEqual(got[0][0], '4');
    assert.strictEqual(got[0][1].wslDistro, 'Ubuntu');
    assert.ok(got.some(([, r]) => r.cwd === tmp), JSON.stringify(got));
  } finally { srv.close(); }

  const bad = await runBash({ OMNI_CWD_URL: 'http://127.0.0.1:9/cwd', OMNI_HOOK_TOKEN: 'x', OMNI_TERMINAL_ID: '1', WSL_DISTRO_NAME: 'Ubuntu' }, 'exit\n');
  assert.match(bad, /연결할 수 없습니다/);
  assert.match(bad, /networkingMode=mirrored/);
});
