'use strict';
// Closing a terminal ends everything started from it: found by the marker
// in the environment, whatever its parent or session. A tmux session that
// another open terminal shows stays.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync, spawnSync } = require('node:child_process');
const reap = require('../src/reap');
const { SessionManager } = require('../src/sessions');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = (id, extra = []) => ['A=1', 'OMNI_TERMINAL_RUN=r1', `OMNI_TERMINAL_ID=${id}`, ...extra];

test('isMarked: the run and, unless null, the terminal', () => {
  assert.strictEqual(reap.isMarked(env('2'), 'r1', '2'), true);
  assert.strictEqual(reap.isMarked(env('2'), 'r1', '20'), false);
  assert.strictEqual(reap.isMarked(env('2'), 'r1', null), true);
  assert.strictEqual(reap.isMarked(env('2'), 'r2', '2'), false, 'another run of the app');
  assert.strictEqual(reap.isMarked(['OMNI_TERMINAL_RUN=r1x', 'OMNI_TERMINAL_ID=2'], 'r1', '2'), false);
  assert.deepStrictEqual(reap.tmuxOf(['TMUX=/tmp/tmux-1000/default,4321,0']), { socket: '/tmp/tmux-1000/default', server: 4321 });
});

test('listLinux reads the environment of each process', async () => {
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-proc-'));
  const put = (pid, e) => { fs.mkdirSync(path.join(proc, pid)); fs.writeFileSync(path.join(proc, pid, 'environ'), e.join('\0') + '\0'); };
  put('100', env('1'));
  put('101', env('2'));
  fs.mkdirSync(path.join(proc, 'self'));
  const procs = await reap.listLinux(proc);
  assert.deepStrictEqual(reap.markedPids(procs, 'r1', '1'), [100]);
  assert.deepStrictEqual(reap.markedPids(procs, 'r1', null), [100, 101]);
});

test('parsePs: the environment words of `ps -E` lines', () => {
  const procs = reap.parsePs('  200 sleep 30 PATH=/bin OMNI_TERMINAL_RUN=r1 OMNI_TERMINAL_ID=1\n  201 sleep 30 OMNI_TERMINAL_RUN=r1 OMNI_TERMINAL_ID=11\n');
  assert.deepStrictEqual(reap.markedPids(procs, 'r1', '1'), [200]);
});

test('tmuxPlan: a server an open terminal is attached to stays, whole; else it ends, also one kept before', async () => {
  const SOCK = '/tmp/tmux-1000/default';
  const procs = [
    { pid: 10, env: env('1') }, // terminal 1's shell (closing)
    { pid: 11, env: env('1') }, // the tmux server it started
    { pid: 12, env: env('1', [`TMUX=${SOCK},11,0`]) }, // a pane of the shared session
    { pid: 13, env: env('1', [`TMUX=${SOCK},11,1`]) }, // a detached session's pane (whose? tmux cannot say)
    { pid: 20, env: env('2') }, // terminal 2's tmux client
    { pid: 30, env: env('3') }, // terminal 3, not in tmux
  ];
  let clients = '20\n10\n';
  const asked = [];
  const tmux = async (socket, args) => { asked.push(args.join(' ')); return clients; };
  let plan = await reap.tmuxPlan(procs, 'r1', ['2', '3'], tmux);
  assert.deepStrictEqual([[...plan.spared], [...plan.ended]], [[11], []]);
  assert.deepStrictEqual(reap.toEnd(procs, 'r1', '1', plan), [10], 'the server and all its sessions stay');
  assert.ok(!asked.some((a) => a.startsWith('kill-session')), 'no session is ended');
  // Later terminal 2 closes too (3 stays open): nobody is attached now, the
  // server terminal 1 started ends with what runs in it.
  clients = '';
  const left = procs.filter((p) => p.pid !== 10 && p.pid !== 20);
  plan = await reap.tmuxPlan(left, 'r1', ['3'], tmux);
  assert.deepStrictEqual([...plan.ended], [11]);
  assert.deepStrictEqual(reap.toEnd(left, 'r1', '2', plan), [11, 12, 13]);
  // tmux cannot be asked: left as it was.
  plan = await reap.tmuxPlan(procs, 'r1', ['2'], async () => null);
  assert.deepStrictEqual(reap.toEnd(procs, 'r1', '1', plan), [10]);
});

test('reapTerminal: asked to end, killed when still there after the grace period', async () => {
  const sent = [];
  let looks = 0;
  const r = await reap.reapTerminal('r1', '1', {
    list: async () => (looks++ === 0 ? [{ pid: 10, env: env('1') }, { pid: 11, env: env('1') }] : [{ pid: 11, env: env('1') }]),
    kill: (pids, sig) => sent.push([sig, pids]),
    wait: async () => {},
    wsl: () => {},
  });
  assert.deepStrictEqual(sent, [['SIGHUP', [10, 11]], ['SIGTERM', [10, 11]], ['SIGKILL', [11]]]);
  assert.deepStrictEqual(r.killed, [11]);
});

test('the WSL script runs for each distro the terminal went into', () => {
  const runs = [];
  reap.reapWsl('r1', '3', ['Ubuntu', 'Debian'], ['1', '2'], 'win32', (file, argv) => { runs.push([file, argv]); return { unref() {} }; });
  assert.deepStrictEqual(runs.map(([f, a]) => [f, a[1], a.slice(-3)]), [['wsl.exe', 'Ubuntu', ['r1', '3', '1 2']], ['wsl.exe', 'Debian', ['r1', '3', '1 2']]]);
  reap.reapWsl('r1', '3', ['Ubuntu'], [], 'linux', () => { throw new Error('not on linux'); });
});

test('closing a terminal reaps it with the terminals still open; quitting reaps all', () => {
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
  m.kill(a.id);
  m.killAll();
  assert.deepStrictEqual(calls, [['env', 'r1'], ['env', 'r1'], ['terminal', 'r1', a.id, [], [b.id]], ['all', 'r1', []]]);
});

// ---------- the real thing (Linux) ----------

const linux = process.platform === 'linux';
const hasTmux = linux && spawnSync('tmux', ['-V']).status === 0 && spawnSync('script', ['--version']).status === 0;
const penv = (id) => ({ ...process.env, OMNI_TERMINAL_RUN: 'rtest', OMNI_TERMINAL_ID: id, TMUX: '' });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('reapTerminal ends nohup, setsid and HUP-ignoring processes of the terminal only', { skip: !linux }, async () => {
  const kids = [
    spawn('sh', ['-c', "trap '' HUP TERM; while :; do sleep 1; done"], { env: penv('7'), stdio: 'ignore' }),
    spawn('setsid', ['sleep', '60'], { env: penv('7'), stdio: 'ignore', detached: true }),
    spawn('nohup', ['sleep', '60'], { env: penv('7'), stdio: 'ignore' }),
  ];
  const other = spawn('sleep', ['60'], { env: penv('8'), stdio: 'ignore' });
  await sleep(300);
  const marked = async (id) => reap.markedPids(await reap.listLinux(), 'rtest', id);
  assert.ok((await marked('7')).length >= 3);
  const r = await reap.reapTerminal('rtest', '7', { live: ['8'] });
  assert.ok(r.killed.length >= 1, 'the one ignoring TERM was killed');
  await sleep(200);
  assert.deepStrictEqual(await marked('7'), []);
  assert.deepStrictEqual(await marked('8'), [other.pid], 'another terminal is left alone');
  other.kill('SIGKILL');
  for (const k of kids) k.kill('SIGKILL');
});

// A tmux server started from terminal 7, with a session terminal 8 is
// attached to and a detached one: closing 7 leaves the server whole
// (terminal 8 goes on); closing 8 later, with terminal 9 still open, ends it.
async function tmuxSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tmux-'));
  const sock = path.join(dir, 'sock');
  execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', 'shared', 'sleep 300'], { env: penv('7') });
  execFileSync('tmux', ['-S', sock, 'new-session', '-d', '-s', 'detached', 'sleep 301'], { env: penv('7') });
  const client = spawn('script', ['-qc', `tmux -S ${sock} attach -t shared`, '/dev/null'], { env: { ...penv('8'), TERM: 'xterm-256color' }, stdio: 'ignore' });
  for (let i = 0; i < 50 && !String(spawnSync('tmux', ['-S', sock, 'list-clients']).stdout).trim(); i++) await sleep(100);
  const server = Number(String(execFileSync('tmux', ['-S', sock, 'display', '-p', '#{pid}'])).trim());
  const sessions = () => String(spawnSync('tmux', ['-S', sock, 'list-sessions', '-F', '#{session_name}']).stdout).trim().split('\n').filter(Boolean).sort();
  const other = spawn('sleep', ['60'], { env: penv('9'), stdio: 'ignore' }); // terminal 9: open, not in tmux
  return { sock, client, server, sessions, done: () => { spawnSync('tmux', ['-S', sock, 'kill-server']); client.kill('SIGKILL'); other.kill('SIGKILL'); } };
}

test('closing a terminal leaves a tmux server another open terminal is attached to; it ends once none is', { skip: !hasTmux }, async () => {
  const t = await tmuxSetup();
  try {
    assert.deepStrictEqual(t.sessions(), ['detached', 'shared']);
    await reap.reapTerminal('rtest', '7', { live: ['8', '9'] });
    await sleep(300);
    assert.ok(alive(t.server), 'the server stays');
    assert.deepStrictEqual(t.sessions(), ['detached', 'shared'], 'every session stays');
    assert.ok(alive(t.client.pid), 'terminal 8 goes on');
    t.client.kill('SIGKILL'); // terminal 8 closed: its client gone
    await sleep(300);
    await reap.reapTerminal('rtest', '8', { live: ['9'] });
    await sleep(300);
    assert.ok(!alive(t.server), 'nobody attached: the server terminal 7 started ended');
  } finally { t.done(); }
});

// Programs with a window of their own start without the terminal's marker
// (they are meant to outlive it); omni-keep does that for anything.
test('the app bash starts editors and openers without the marker, also through an alias', { skip: !linux }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-keep-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'home'));
  fs.writeFileSync(path.join(dir, 'bin', 'code'), '#!/bin/sh\necho "code:$* run=${OMNI_TERMINAL_RUN:-none}"\n', { mode: 0o755 });
  const run = (bashrc, line) => spawnSync('bash', ['--rcfile', path.join(__dirname, '..', 'src', 'shell-init', 'omni.bash'), '-i'], {
    input: `${line}\nexit\n`, encoding: 'utf8',
    env: { PATH: `${path.join(dir, 'bin')}:/usr/bin:/bin`, HOME: path.join(dir, 'home'), OMNI_TERMINAL_RUN: 'r1', OMNI_TERMINAL_ID: '1', OMNI_NO_AUTO_SETUP: '1' },
  }).stdout;
  fs.writeFileSync(path.join(dir, 'home', '.bashrc'), '');
  assert.match(run('', 'code a b'), /code:a b run=none/);
  fs.writeFileSync(path.join(dir, 'home', '.bashrc'), "alias code='code --reuse'\n");
  assert.match(run('', 'code a'), /code:--reuse a run=none/, 'the alias still works');
  assert.match(run('', 'omni-keep sh -c \'echo "keep:${OMNI_TERMINAL_RUN:-none}"\''), /keep:none/);
  assert.match(run('', 'sh -c \'echo "plain:$OMNI_TERMINAL_RUN"\''), /plain:r1/, 'everything else keeps it');
});

test('a kept tmux server ends at a later look once the open terminal detached', { skip: !hasTmux }, async () => {
  const t = await tmuxSetup();
  try {
    await reap.reapTerminal('rtest', '7', { live: ['8', '9'] });
    await sleep(300);
    assert.ok(alive(t.server), 'kept for terminal 8');
    let r = await reap.recheckTmux('rtest', { live: ['8', '9'] });
    assert.deepStrictEqual(r.spared, [t.server], 'still attached: kept');
    t.client.kill('SIGKILL'); // terminal 8 detached (stays open)
    await sleep(300);
    r = await reap.recheckTmux('rtest', { live: ['8', '9'] });
    await sleep(300);
    assert.deepStrictEqual(r.ended, [t.server]);
    assert.ok(!alive(t.server), 'nobody attached: ended');
  } finally { t.done(); }
});

test('the WSL script does the same (run here with sh), looking again while it keeps a server', { skip: !hasTmux }, async () => {
  const t = await tmuxSetup();
  try {
    const keep = spawn('setsid', ['sleep', '60'], { env: penv('7'), stdio: 'ignore', detached: true });
    await sleep(200);
    const script = spawn('sh', ['-c', reap.WSL_SCRIPT, 'sh', 'rtest', '7', '8 9'], { env: { ...process.env, OMNI_REAP_EVERY: '1' }, stdio: 'ignore' });
    const exited = new Promise((r) => script.on('exit', r));
    await sleep(3500);
    assert.ok(alive(t.server), 'kept while terminal 8 is attached');
    assert.deepStrictEqual(t.sessions(), ['detached', 'shared'], 'every session stays');
    assert.ok(alive(t.client.pid), 'terminal 8 goes on');
    assert.ok(!alive(keep.pid) || String(fs.readFileSync(`/proc/${keep.pid}/stat`)).split(' ')[2] === 'Z', 'terminal 7 setsid process ended');
    assert.strictEqual(script.exitCode, null, 'still looking');
    t.client.kill('SIGKILL'); // terminal 8 detached
    await Promise.race([exited, sleep(15000)]);
    assert.ok(!alive(t.server), 'ended once none is attached');
    assert.notStrictEqual(script.exitCode, null, 'and the script exited');
  } finally { t.done(); }
});
