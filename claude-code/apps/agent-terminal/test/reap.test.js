'use strict';
// Closing a terminal ends everything started from it: found by the marker
// in the environment, whatever its parent or session.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const reap = require('../src/reap');
const { SessionManager } = require('../src/sessions');

test('isMarked: the run and, unless null, the terminal', () => {
  const env = ['A=1', 'OMNI_TERMINAL_RUN=r1', 'OMNI_TERMINAL_ID=2'];
  assert.strictEqual(reap.isMarked(env, 'r1', '2'), true);
  assert.strictEqual(reap.isMarked(env, 'r1', '20'), false);
  assert.strictEqual(reap.isMarked(env, 'r1', null), true);
  assert.strictEqual(reap.isMarked(env, 'r2', '2'), false, 'another run of the app');
  assert.strictEqual(reap.isMarked(['OMNI_TERMINAL_RUN=r1x', 'OMNI_TERMINAL_ID=2'], 'r1', '2'), false);
});

test('findLinux reads the environment of each process', async () => {
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-proc-'));
  const put = (pid, env) => { fs.mkdirSync(path.join(proc, pid)); fs.writeFileSync(path.join(proc, pid, 'environ'), env.join('\0') + '\0'); };
  put('100', ['OMNI_TERMINAL_RUN=r1', 'OMNI_TERMINAL_ID=1']);
  put('101', ['OMNI_TERMINAL_RUN=r1', 'OMNI_TERMINAL_ID=2']);
  put('102', ['OMNI_TERMINAL_ID=1']);
  fs.mkdirSync(path.join(proc, 'self'));
  assert.deepStrictEqual(await reap.findLinux('r1', '1', proc), [100]);
  assert.deepStrictEqual(await reap.findLinux('r1', null, proc), [100, 101]);
});

test('parsePs: the marker as whole words of `ps -E` lines', () => {
  const out = '  200 sleep 30 PATH=/bin OMNI_TERMINAL_RUN=r1 OMNI_TERMINAL_ID=1\n  201 sleep 30 OMNI_TERMINAL_RUN=r1 OMNI_TERMINAL_ID=11\n';
  assert.deepStrictEqual(reap.parsePs(out, 'r1', '1'), [200]);
});

test('reapTerminal: asked to end, killed when still there after the grace period', async () => {
  const sent = [];
  let looks = 0;
  const r = await reap.reapTerminal('r1', '1', {
    findFn: async () => (looks++ === 0 ? [10, 11] : [11]),
    kill: (pids, sig) => sent.push([sig, pids]),
    wait: async () => {},
    wsl: () => {},
  });
  assert.deepStrictEqual(sent, [['SIGHUP', [10, 11]], ['SIGTERM', [10, 11]], ['SIGKILL', [11]]]);
  assert.deepStrictEqual(r, { asked: [10, 11], killed: [11] });
});

test('the WSL scan runs for each distro the terminal went into', () => {
  const runs = [];
  reap.reapWsl('r1', '3', ['Ubuntu', 'Debian'], 'win32', (file, argv) => { runs.push([file, argv]); return { unref() {} }; });
  assert.deepStrictEqual(runs.map(([f, a]) => [f, a[1], a.slice(-2)]), [['wsl.exe', 'Ubuntu', ['r1', '3']], ['wsl.exe', 'Debian', ['r1', '3']]]);
  reap.reapWsl('r1', '3', ['Ubuntu'], 'linux', () => { throw new Error('not on linux'); });
});

test('closing a terminal reaps it; quitting reaps every terminal at once', () => {
  const calls = [];
  const fakePty = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const m = new SessionManager({
    spawn: (_f, _a, opts) => { calls.push(['env', opts.env.OMNI_TERMINAL_RUN]); return fakePty(); },
    emit: () => {},
    shell: { file: 'sh', args: [] },
    pollMs: 0,
    runId: 'r1',
    reaper: { terminal: (...a) => calls.push(['terminal', ...a]), all: (...a) => calls.push(['all', ...a]) },
  });
  const a = m.create({});
  const b = m.create({});
  m.reportShellCwd(b.id, { cwd: '/home/user' });
  m.kill(a.id);
  m.killAll();
  assert.deepStrictEqual(calls, [['env', 'r1'], ['env', 'r1'], ['terminal', 'r1', a.id, []], ['all', 'r1', []]]);
});

// The real thing (Linux): what outlives a hangup ends too, another
// terminal's process does not.
test('reapTerminal ends nohup, setsid and HUP-ignoring processes of the terminal only', { skip: process.platform !== 'linux' }, async () => {
  const env = (id) => ({ ...process.env, OMNI_TERMINAL_RUN: 'rtest', OMNI_TERMINAL_ID: id });
  const kids = [
    spawn('sh', ['-c', "trap '' HUP TERM; while :; do sleep 1; done"], { env: env('7'), stdio: 'ignore' }),
    spawn('setsid', ['sleep', '60'], { env: env('7'), stdio: 'ignore', detached: true }),
    spawn('nohup', ['sleep', '60'], { env: env('7'), stdio: 'ignore' }),
  ];
  const other = spawn('sleep', ['60'], { env: env('8'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const before = await reap.findLinux('rtest', '7');
  assert.ok(before.length >= 3, `found ${before}`);
  const r = await reap.reapTerminal('rtest', '7');
  assert.ok(r.killed.length >= 1, 'the one ignoring TERM was killed');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepStrictEqual(await reap.findLinux('rtest', '7'), []);
  assert.deepStrictEqual(await reap.findLinux('rtest', '8'), [other.pid], 'another terminal is left alone');
  other.kill('SIGKILL');
  for (const k of kids) k.kill('SIGKILL');
});
