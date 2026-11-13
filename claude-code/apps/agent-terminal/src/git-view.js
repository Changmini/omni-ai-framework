'use strict';

// Read-only git for the inspector's git tab: status, recent commits, diffs.
// Inside WSL (Windows app) git runs in the distro: wsl.exe -d <distro> -e git,
// with no shell in between, so paths reach git as given and the repository is
// read by Linux git (no \\wsl.localhost ownership warnings, no slow 9P scans).
// --no-optional-locks keeps status from taking index.lock while Claude may be
// running git itself. Nothing here changes the repository.

const { execFile, spawn } = require('node:child_process');
const { wslCommand, decodeOutput } = require('./wsl');

const MAX_OUT = 16 * 1024 * 1024;
const MAX_FILES = 500; // changed files listed; the rest are counted

// `maxBuffer`: for a caller expecting large output (the file tab's list).
// Besides the text, `timedOut` and `tooLarge` say why a run failed.
function runGit(args, { cwd, distro = null, platform = process.platform, exec = execFile, maxBuffer = MAX_OUT } = {}) {
  const base = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args];
  // A WSL folder: the distro's git; otherwise (also a Windows folder in the
  // Windows app) the host's git.
  const [file, argv] = distro ? wslCommand('git', base, distro, platform) : ['git', base];
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 15000, maxBuffer, windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) => {
      const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      // On failure the reason may be wsl.exe's own (UTF-16) message, on stdout.
      let errText = decodeOutput(stderr);
      if (err && !errText.trim()) errText = decodeOutput(stdout);
      if (err && !errText.trim() && err.killed) errText = 'git이 응답하지 않습니다 (시간 초과)';
      if (err && !errText.trim() && /maxBuffer/i.test(String(err.message))) errText = '출력이 너무 큽니다';
      const missing = Boolean(err && err.code === 'ENOENT');
      const tooLarge = Boolean(err && /maxBuffer/i.test(String(err.message)));
      const timedOut = Boolean(err && err.killed && !tooLarge);
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : err ? -1 : 0, stdout: out, stderr: errText, missing, tooLarge, timedOut });
    });
  });
}

// `git status --porcelain=v1 -b -z`: "## branch...upstream [ahead 1, behind 2]",
// then "XY path" entries; a rename or copy is followed by its original path.
function parseStatus(text) {
  const parts = text.split('\0');
  const out = { branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('## ')) {
      const m = /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(p);
      if (m) {
        out.branch = m[1] === 'HEAD (no branch)' ? null : m[1];
        out.upstream = m[2] || null;
        const a = /ahead (\d+)/.exec(m[3] || '');
        const b = /behind (\d+)/.exec(m[3] || '');
        out.ahead = a ? Number(a[1]) : 0;
        out.behind = b ? Number(b[1]) : 0;
      }
      continue;
    }
    const x = p[0];
    const y = p[1];
    const file = { path: p.slice(3), index: x, work: y, orig: null };
    if (x === 'R' || x === 'C') file.orig = parts[++i] || null;
    out.files.push(file);
  }
  return out;
}

// `git diff --numstat -z`: "add\tdel\tpath\0", or for a rename
// "add\tdel\t\0old\0new\0". Binary files have "-" counts.
function parseNumstat(text) {
  const map = new Map();
  const parts = text.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i]);
    if (!m) continue;
    let path = m[3];
    if (path === '') { i += 2; path = parts[i] || ''; }
    map.set(path, { add: m[1] === '-' ? null : Number(m[1]), del: m[2] === '-' ? null : Number(m[2]) });
  }
  return map;
}

function parseLog(text) {
  return text.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [hash, short, subject, time] = r.split('\x1f');
    return { hash, short, subject: subject || '', time: Number(time) * 1000 || null };
  }).filter((c) => /^[0-9a-f]{7,64}$/.test(c.hash || ''));
}

// `knownRoot`: the repository root found for this folder last time, which
// saves the rev-parse (one more wsl.exe on Windows); it is checked again
// when status fails there. The root comes back without a trailing slash.
async function gitStatus(target, run = runGit, knownRoot = null) {
  if (knownRoot !== null) {
    const r = await statusAt(target, knownRoot, run);
    if (!r.error) return r;
  }
  const top = await run(['rev-parse', '--show-toplevel'], target);
  if (top.missing) return { error: 'git을 찾을 수 없습니다 (설치돼 있지 않거나 PATH에 없음)' };
  // Only "not a git repository" means that; anything else (Windows git's
  // safe.directory check on a \\wsl.localhost folder, no git in the distro,
  // wsl.exe errors) is shown as it is.
  if (!top.ok) return /not a git repository/i.test(top.stderr) ? { notRepo: true } : { error: firstLine(top.stderr, 'git을 실행하지 못했습니다') };
  return statusAt(target, top.stdout.trim().replace(/[\\/]$/, ''), run);
}

// The folder to run git in for a root without its trailing slash: '' is the
// filesystem root, 'C:' the root of drive C (plain 'C:' would mean the
// current folder on that drive).
const rootDir = (root) => (root === '' ? '/' : /^[a-zA-Z]:$/.test(root) ? `${root}/` : root);

async function statusAt(target, root, run) {
  const at = { ...target, cwd: rootDir(root) };
  const [st, unstaged, staged, log] = await Promise.all([
    // A wholly new folder is one entry ("dir/"), as in plain `git status`:
    // git does not walk it, however large (an unignored venv or build dir).
    // Its files are listed on demand (gitUntrackedIn).
    run(['status', '--porcelain=v1', '-b', '-z', '--untracked-files=normal'], at),
    run(['diff', '--numstat', '-z'], at),
    run(['diff', '--cached', '--numstat', '-z'], at),
    run(['log', '-n', '20', '--format=%H%x1f%h%x1f%s%x1f%ct%x1e'], at),
  ]);
  if (!st.ok) return { error: firstLine(st.stderr, 'git status 실패') };
  const s = parseStatus(st.stdout);
  const total = s.files.length;
  if (total > MAX_FILES) s.files = s.files.slice(0, MAX_FILES);
  const un = parseNumstat(unstaged.stdout);
  const sg = parseNumstat(staged.stdout);
  for (const f of s.files) {
    if (f.index !== ' ' && f.index !== '?') f.staged = sg.get(f.path) || null;
    if (f.work !== ' ' && f.work !== '?') f.unstaged = un.get(f.path) || null;
  }
  return { root, ...s, total, commits: log.ok ? parseLog(log.stdout) : [] };
}

// The untracked files inside a new folder listed by status ("dir/"), at
// most MAX_FILES. Paths are relative to the repository root.
async function gitUntrackedIn(target, dir, run = runGit) {
  if (!SAFE_PATH(dir) || !dir.endsWith('/')) return { error: '잘못된 경로' };
  const r = await run(['ls-files', '--others', '--exclude-standard', '-z', '--', dir], target);
  if (!r.ok) return { error: firstLine(r.stderr, 'git ls-files 실패') };
  const all = r.stdout.split('\0').filter(Boolean);
  return { files: all.slice(0, MAX_FILES), total: all.length };
}

const firstLine = (text, fallback) => (String(text || '').trim().split('\n')[0] || fallback);

const SAFE_PATH = (p) => typeof p === 'string' && p !== '' && !p.startsWith('-') && !/(^|[\\/])\.\.([\\/]|$)/.test(p) && !p.includes('\0');
const SAFE_REV = (r) => typeof r === 'string' && /^[0-9a-f]{7,64}$/.test(r);

// The working-tree change of one file: staged and unstaged together (vs HEAD),
// or the index alone for a repository without commits. A renamed or copied
// file passes its original path too, so git pairs the two (-M finds renames;
// copies need --find-copies-harder, as their source is usually unchanged)
// instead of showing a new file.
async function gitFileDiff(target, path, run = runGit, orig = null, copy = false) {
  if (!SAFE_PATH(path) || (orig !== null && !SAFE_PATH(orig))) return { error: '잘못된 경로' };
  const paths = orig ? [...(copy ? ['-C', '--find-copies-harder'] : ['-M']), '--', orig, path] : ['--', path];
  let r = await run(['diff', 'HEAD', '--no-ext-diff', ...paths], target);
  if (!r.ok) r = await run(['diff', '--cached', '--no-ext-diff', ...paths], target);
  if (!r.ok) return { error: firstLine(r.stderr, 'git diff 실패') };
  return { lines: r.stdout.replace(/\n$/, '').split('\n').filter((l, i, a) => a.length > 1 || l) };
}

async function gitShow(target, rev, run = runGit) {
  if (!SAFE_REV(rev)) return { error: '잘못된 커밋' };
  // The body is indented like `git log`: a "- item" line in it must not read
  // as a removed line of the diff.
  const r = await run(['show', '--no-ext-diff', '--format=commit %H%n%n    %s%n%n%w(0,4,4)%b', rev], target);
  if (!r.ok) return { error: firstLine(r.stderr, 'git show 실패') };
  const text = r.stdout.length > 600000 ? `${r.stdout.slice(0, 600000)}\n… (일부만 표시)` : r.stdout;
  // An empty body leaves blank lines before the first diff: keep one.
  const lines = text.replace(/\n$/, '').split('\n');
  const first = lines.findIndex((l) => l.startsWith('diff --git '));
  const head = (first === -1 ? lines : lines.slice(0, first)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '').split('\n');
  return { lines: first === -1 ? head : [...head, '', ...lines.slice(first)] };
}

// Runs git with -z output and hands each NUL-ended record to `onRecord` as
// it arrives, so a long list (every file of a large repository) is never
// held or parsed in one piece on the main process. `onRecord` returning
// false stops git early. -> { ok, missing, timedOut, stopped, stderr }.
function streamGit(args, { cwd, distro = null, platform = process.platform, spawnFn = spawn, timeoutMs = 15000 } = {}, onRecord) {
  const base = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args];
  const [file, argv] = distro ? wslCommand('git', base, distro, platform) : ['git', base];
  return new Promise((resolve) => {
    let child;
    try { child = spawnFn(file, argv, { windowsHide: true }); } catch (e) { resolve({ ok: false, missing: e && e.code === 'ENOENT', stderr: '' }); return; }
    let rest = Buffer.alloc(0);
    let stopped = false;
    let timedOut = false;
    let done = false;
    const errParts = [];
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (stopped) return;
      let buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let at = buf.indexOf(0);
      while (at !== -1) {
        if (onRecord(buf.subarray(0, at).toString('utf8')) === false) { stopped = true; child.kill(); return; }
        buf = buf.subarray(at + 1);
        at = buf.indexOf(0);
      }
      rest = Buffer.from(buf);
    });
    child.stderr.on('data', (d) => { if (errParts.length < 20) errParts.push(d); });
    child.on('error', (e) => finish({ ok: false, missing: e && e.code === 'ENOENT', stderr: '' }));
    child.on('close', (code) => {
      const stderr = decodeOutput(Buffer.concat(errParts));
      finish({ ok: stopped || (code === 0 && !timedOut), missing: false, timedOut, stopped, stderr });
    });
  });
}

module.exports = { runGit, streamGit, parseStatus, parseNumstat, parseLog, gitStatus, gitFileDiff, gitShow, gitUntrackedIn, rootDir, SAFE_PATH, SAFE_REV, MAX_FILES };
