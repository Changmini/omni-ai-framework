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
// Linux reads /proc/<pid>/environ, macOS `ps -E`. On Windows node-pty ends
// the processes of the terminal's console itself; processes inside WSL are
// found by the same scan run there (wsl.exe), for each distro the terminal
// went into.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { wslCommand } = require('./wsl');

const RUN_VAR = 'OMNI_TERMINAL_RUN';
const ID_VAR = 'OMNI_TERMINAL_ID';
const GRACE_MS = 2000;

const newRunId = () => crypto.randomBytes(8).toString('hex');

// Environment entries ("NAME=value") marked for `run` and, unless `id` is
// null, for the terminal `id`.
function isMarked(entries, run, id = null) {
  let r = false;
  let i = id === null;
  for (const e of entries) {
    if (e === `${RUN_VAR}=${run}`) r = true;
    else if (id !== null && e === `${ID_VAR}=${id}`) i = true;
  }
  return r && i;
}

const isPid = (n) => /^\d+$/.test(n) && Number(n) > 1 && Number(n) !== process.pid;

// Linux: the processes whose environment carries the marker.
async function findLinux(run, id, procDir = '/proc') {
  let names;
  try { names = await fs.promises.readdir(procDir); } catch { return []; }
  const out = [];
  await Promise.all(names.filter(isPid).map(async (n) => {
    const env = await fs.promises.readFile(`${procDir}/${n}/environ`, 'latin1').catch(() => null);
    if (env && isMarked(env.split('\0'), run, id)) out.push(Number(n));
  }));
  return out.sort((a, b) => a - b);
}

function findLinuxSync(run, id, procDir = '/proc') {
  let names;
  try { names = fs.readdirSync(procDir); } catch { return []; }
  const out = [];
  for (const n of names.filter(isPid)) {
    let env;
    try { env = fs.readFileSync(`${procDir}/${n}/environ`, 'latin1'); } catch { continue; }
    if (isMarked(env.split('\0'), run, id)) out.push(Number(n));
  }
  return out.sort((a, b) => a - b);
}

// macOS (and other systems without /proc): `ps -E` lists each process's
// command with its environment. The marker values have no spaces, so they
// are whole words of the line.
function parsePs(text, run, id) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const words = line.trim().split(/\s+/);
    if (isPid(words[0] || '') && isMarked(words.slice(1), run, id)) out.push(Number(words[0]));
  }
  return out;
}
const PS_ARGS = ['-A', '-E', '-ww', '-o', 'pid=,command='];
function findPs(run, id) {
  return new Promise((resolve) => {
    execFile('ps', PS_ARGS, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? [] : parsePs(stdout, run, id)));
  });
}
function findPsSync(run, id) {
  try { return parsePs(execFileSync('ps', PS_ARGS, { maxBuffer: 64 * 1024 * 1024 }), run, id); } catch { return []; }
}

function find(run, id, platform = process.platform) {
  if (platform === 'win32') return Promise.resolve([]);
  return platform === 'linux' ? findLinux(run, id) : findPs(run, id);
}
function findSync(run, id, platform = process.platform) {
  if (platform === 'win32') return [];
  return platform === 'linux' ? findLinuxSync(run, id) : findPsSync(run, id);
}

function signal(pids, sig) {
  for (const p of pids) {
    try { process.kill(p, sig); } catch { /* already gone */ }
  }
}

// The same inside WSL, as one sh script: $1 the run, $2 the terminal (empty:
// every terminal of the run). It runs on after the app quits.
const WSL_SCRIPT = [
  'r="OMNI_TERMINAL_RUN=$1"; i="OMNI_TERMINAL_ID=$2"',
  'f() { for d in /proc/[0-9]*; do p=${d#/proc/}; [ "$p" = "$$" ] && continue;',
  '  e=$(tr "\\0" "\\n" < "$d/environ" 2>/dev/null) || continue;',
  '  printf "%s\\n" "$e" | grep -qxF "$r" || continue;',
  '  [ -z "$2" ] || printf "%s\\n" "$e" | grep -qxF "$i" || continue;',
  '  echo "$p"; done; }',
  'p=$(f); [ -z "$p" ] && exit 0',
  'kill -HUP $p 2>/dev/null; kill -TERM $p 2>/dev/null; sleep 2',
  'p=$(f); [ -n "$p" ] && kill -KILL $p 2>/dev/null; exit 0',
].join('\n');

function reapWsl(run, id, distros, platform = process.platform, run_ = spawn) {
  if (platform !== 'win32') return;
  for (const distro of distros) {
    const [file, argv] = wslCommand('sh', ['-c', WSL_SCRIPT, 'sh', run, id === null ? '' : id], distro, platform);
    try { run_(file, argv, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* wsl.exe missing */ }
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// One terminal closed: everything it started ends, the rest of the grace
// period given to end by itself. -> { asked, killed } (pids, for tests).
async function reapTerminal(run, id, { distros = [], platform = process.platform, findFn = find, kill = signal, wait = delay, wsl = reapWsl } = {}) {
  wsl(run, id, distros, platform);
  const asked = await findFn(run, id, platform);
  if (!asked.length) return { asked, killed: [] };
  kill(asked, 'SIGHUP');
  kill(asked, 'SIGTERM');
  await wait(GRACE_MS);
  const killed = await findFn(run, id, platform);
  kill(killed, 'SIGKILL');
  return { asked, killed };
}

// The app quits: every terminal's processes, without waiting long (at most
// a second, then killed).
function reapAllSync(run, { distros = [], platform = process.platform } = {}) {
  reapWsl(run, null, distros, platform);
  const asked = findSync(run, null, platform);
  if (!asked.length) return;
  signal(asked, 'SIGHUP');
  signal(asked, 'SIGTERM');
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let t = 0; t < 10; t++) {
    if (!findSync(run, null, platform).length) return;
    Atomics.wait(sleeper, 0, 0, 100);
  }
  signal(findSync(run, null, platform), 'SIGKILL');
}

module.exports = { RUN_VAR, ID_VAR, GRACE_MS, newRunId, isMarked, findLinux, parsePs, reapTerminal, reapAllSync, reapWsl, WSL_SCRIPT };
