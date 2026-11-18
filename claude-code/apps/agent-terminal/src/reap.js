'use strict';

// Ending everything a terminal started when it is closed (and when the app
// quits). Closing the pty hangs up its shell, and with it the commands of
// its session. Not ended by that: processes that ignore the hangup (nohup,
// a trap), that left the session (setsid, a program's detached child, so
// possibly a background task of Claude) and a tmux server started there,
// with its panes. Every process started from a terminal carries the
// terminal's marker in its environment (OMNI_TERMINAL_RUN: this run of the
// app, OMNI_TERMINAL_ID: the terminal), whatever its parent or session: they
// are found by that, hung up and asked to end, and killed when still there
// after a grace period.
//
// tmux: a server started from the closed terminal may also be showing
// sessions to other terminals still open (a ~/.bashrc that attaches every
// shell to one session, or sessions of one server). Ending it would end
// those terminals too. Such a server stays, whole, while an open terminal
// is attached; it ends at a later close once none is. A process inside a
// tmux pane says which server it is in (TMUX=socket,pid,n).
//
// Linux reads /proc/<pid>/environ, macOS `ps -E`. On Windows node-pty ends
// the processes of the terminal's console itself; processes inside WSL are
// handled by the same rules in a sh script run there (wsl.exe), for each
// distro the terminal went into.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { wslCommand } = require('./wsl');

const RUN_VAR = 'OMNI_TERMINAL_RUN';
const ID_VAR = 'OMNI_TERMINAL_ID';
const GRACE_MS = 2000;

const newRunId = () => crypto.randomBytes(8).toString('hex');

const envGet = (env, name) => {
  const pre = `${name}=`;
  const e = env.find((x) => x.startsWith(pre));
  return e === undefined ? null : e.slice(pre.length);
};

// Environment entries ("NAME=value") marked for `run` and, unless `id` is
// null, for the terminal `id`.
function isMarked(env, run, id = null) {
  return envGet(env, RUN_VAR) === run && (id === null || envGet(env, ID_VAR) === id);
}

// The tmux server a process runs in: TMUX=<socket>,<server pid>,<session>.
function tmuxOf(env) {
  const m = /^(.+),(\d+),\d+$/.exec(envGet(env, 'TMUX') || '');
  return m ? { socket: m[1], server: Number(m[2]) } : null;
}

const isPid = (n) => /^\d+$/.test(n) && Number(n) > 1 && Number(n) !== process.pid;

// Every process with its environment: [{ pid, env: ["NAME=value", ...] }].
// Linux: /proc/<pid>/environ (own processes only are readable).
async function listLinux(procDir = '/proc') {
  let names;
  try { names = await fs.promises.readdir(procDir); } catch { return []; }
  const out = [];
  await Promise.all(names.filter(isPid).map(async (n) => {
    const env = await fs.promises.readFile(`${procDir}/${n}/environ`, 'latin1').catch(() => null);
    if (env) out.push({ pid: Number(n), env: env.split('\0').filter(Boolean) });
  }));
  return out.sort((a, b) => a.pid - b.pid);
}

function listLinuxSync(procDir = '/proc') {
  let names;
  try { names = fs.readdirSync(procDir); } catch { return []; }
  const out = [];
  for (const n of names.filter(isPid)) {
    try { out.push({ pid: Number(n), env: fs.readFileSync(`${procDir}/${n}/environ`, 'latin1').split('\0').filter(Boolean) }); } catch { /* gone or not ours */ }
  }
  return out;
}

// macOS (and other systems without /proc): `ps -E` lists each process's
// command with its environment. The values looked at have no spaces, so
// they are whole words of the line.
function parsePs(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const words = line.trim().split(/\s+/);
    if (isPid(words[0] || '')) out.push({ pid: Number(words[0]), env: words.slice(1).filter((w) => w.includes('=')) });
  }
  return out;
}
const PS_ARGS = ['-A', '-E', '-ww', '-o', 'pid=,command='];
const listPs = () => new Promise((resolve) => {
  execFile('ps', PS_ARGS, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? [] : parsePs(stdout)));
});
const listPsSync = () => { try { return parsePs(execFileSync('ps', PS_ARGS, { maxBuffer: 64 * 1024 * 1024 })); } catch { return []; } };

function listProcs(platform = process.platform) {
  if (platform === 'win32') return Promise.resolve([]);
  return platform === 'linux' ? listLinux() : listPs();
}
function listProcsSync(platform = process.platform) {
  if (platform === 'win32') return [];
  return platform === 'linux' ? listLinuxSync() : listPsSync();
}

const markedPids = (procs, run, id) => procs.filter((p) => isMarked(p.env, run, id)).map((p) => p.pid);

// tmux -S <socket> <args>: stdout, '' when no server runs there, null when
// tmux could not tell.
function runTmux(socket, args) {
  return new Promise((resolve) => {
    execFile('tmux', ['-S', socket, ...args], { timeout: 3000 }, (err, stdout, stderr) => {
      if (!err) resolve(String(stdout));
      else resolve(/no server running|error connecting/.test(String(stderr || '')) ? '' : null);
    });
  });
}

// tmux servers started from a closed terminal (this one, or one closed
// earlier whose server was kept then): kept while an open terminal
// (`live`: ids) is attached to it, with all its sessions (a detached one
// may be an open terminal's: tmux cannot say whose a session is); ended
// once none is, also when the terminal that started it closed before.
// -> { spared, ended }: Sets of server pids.
async function tmuxPlan(procs, run, live, tmux = runTmux) {
  const liveIds = new Set(live);
  const ofRun = procs.filter((p) => envGet(p.env, RUN_VAR) === run);
  const closed = new Set(ofRun.filter((p) => !liveIds.has(envGet(p.env, ID_VAR))).map((p) => p.pid));
  const others = new Set(ofRun.filter((p) => liveIds.has(envGet(p.env, ID_VAR))).map((p) => p.pid));
  const servers = new Map(); // server pid -> socket, for servers of closed terminals
  for (const p of procs) {
    const t = tmuxOf(p.env);
    if (t && closed.has(t.server)) servers.set(t.server, t.socket);
  }
  const spared = new Set();
  const ended = new Set();
  for (const [server, socket] of servers) {
    if (!others.size) { ended.add(server); continue; }
    const clients = await tmux(socket, ['list-clients', '-F', '#{client_pid}']);
    if (clients === null) { spared.add(server); continue; } // cannot tell: left as it was
    const attached = clients.split('\n').some((l) => others.has(Number(l.trim())));
    (attached ? spared : ended).add(server);
  }
  return { spared, ended };
}

// The processes to end: terminal `id`'s (none when null), and the ended
// tmux servers with what runs in them; never a kept server or anything in it.
function toEnd(procs, run, id, plan) {
  return procs.filter((p) => {
    const t = tmuxOf(p.env);
    if (plan.spared.has(p.pid) || (t && plan.spared.has(t.server))) return false;
    if (id !== null && isMarked(p.env, run, id)) return true;
    return envGet(p.env, RUN_VAR) === run && (plan.ended.has(p.pid) || Boolean(t && plan.ended.has(t.server)));
  }).map((p) => p.pid);
}

function signal(pids, sig) {
  for (const p of pids) {
    try { process.kill(p, sig); } catch { /* already gone */ }
  }
}

// The same inside WSL: shell-init/reap.sh, passed to sh -c. It runs on
// after the app quits.
const WSL_SCRIPT = fs.readFileSync(path.join(__dirname, 'shell-init', 'reap.sh'), 'utf8').replace(/\r/g, '');

function reapWsl(run, id, distros, live = [], platform = process.platform, run_ = spawn) {
  if (platform !== 'win32') return;
  for (const distro of distros) {
    const [file, argv] = wslCommand('sh', ['-c', WSL_SCRIPT, 'sh', run, id === null ? '' : id, live.join(' ')], distro, platform);
    try { run_(file, argv, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* wsl.exe missing */ }
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// One terminal closed (`live`: the terminals still open): everything it
// started ends, but a tmux server an open terminal is attached to stays
// (tmuxPlan). -> { asked, killed, spared, ended } (pids, for tests).
async function reapTerminal(run, id, {
  distros = [], live = [], platform = process.platform,
  list = listProcs, tmux = runTmux, kill = signal, wait = delay, wsl = reapWsl,
} = {}) {
  wsl(run, id, distros, live, platform);
  return endPlanned(run, id, { live, platform, list, tmux, kill, wait });
}

// Kept tmux servers looked at again (SessionManager, every minute while one
// is kept): one no open terminal is attached to any more ends. Inside WSL
// the script does this itself.
function recheckTmux(run, { live = [], platform = process.platform, list = listProcs, tmux = runTmux, kill = signal, wait = delay } = {}) {
  return endPlanned(run, null, { live, platform, list, tmux, kill, wait });
}

async function endPlanned(run, id, { live, platform, list, tmux, kill, wait }) {
  const procs = await list(platform);
  const plan = await tmuxPlan(procs, run, live, tmux);
  const asked = toEnd(procs, run, id, plan);
  const result = { asked, killed: [], spared: [...plan.spared], ended: [...plan.ended] };
  if (!asked.length) return result;
  kill(asked, 'SIGHUP');
  kill(asked, 'SIGTERM');
  await wait(GRACE_MS);
  result.killed = toEnd(await list(platform), run, id, plan);
  kill(result.killed, 'SIGKILL');
  return result;
}

// The app quits: every terminal's processes (tmux servers too: no terminal
// is left to show them), without waiting long (at most a second).
function reapAllSync(run, { distros = [], platform = process.platform } = {}) {
  reapWsl(run, null, distros, [], platform);
  const find = () => markedPids(listProcsSync(platform), run, null);
  const asked = find();
  if (!asked.length) return;
  signal(asked, 'SIGHUP');
  signal(asked, 'SIGTERM');
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let t = 0; t < 10; t++) {
    if (!find().length) return;
    Atomics.wait(sleeper, 0, 0, 100);
  }
  signal(find(), 'SIGKILL');
}

module.exports = {
  RUN_VAR, ID_VAR, GRACE_MS, newRunId, isMarked, tmuxOf, listLinux, parsePs, markedPids,
  tmuxPlan, toEnd, reapTerminal, recheckTmux, reapAllSync, reapWsl, WSL_SCRIPT,
};
