'use strict';

// Read-only git for the inspector's git tab: status, recent commits, diffs.
// Inside WSL (Windows app) git runs in the distro: wsl.exe -d <distro> -e git,
// with no shell in between, so paths reach git as given and the repository is
// read by Linux git (no \\wsl.localhost ownership warnings, no slow 9P scans).
// --no-optional-locks keeps status from taking index.lock while Claude may be
// running git itself. Nothing here changes the repository.

const { execFile } = require('node:child_process');

const MAX_OUT = 8 * 1024 * 1024;

function runGit(args, { cwd, distro = null, platform = process.platform, exec = execFile } = {}) {
  const base = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args];
  const [file, argv] = platform === 'win32' && distro
    ? ['wsl.exe', ['-d', distro, '-e', 'git', ...base]]
    : ['git', base];
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 10000, maxBuffer: MAX_OUT, windowsHide: true, encoding: 'buffer' }, (err, stdout, stderr) => {
      const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      const errText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
      const missing = err && err.code === 'ENOENT';
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : err ? -1 : 0, stdout: out, stderr: errText, missing });
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

async function gitStatus(target, run = runGit) {
  const top = await run(['rev-parse', '--show-toplevel'], target);
  if (top.missing) return { error: 'git을 찾을 수 없습니다 (설치돼 있지 않거나 PATH에 없음)' };
  if (!top.ok) return { notRepo: true };
  const root = top.stdout.trim();
  const at = { ...target, cwd: root };
  const [st, unstaged, staged, log] = await Promise.all([
    run(['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'], at),
    run(['diff', '--numstat', '-z'], at),
    run(['diff', '--cached', '--numstat', '-z'], at),
    run(['log', '-n', '20', '--format=%H%x1f%h%x1f%s%x1f%ct%x1e'], at),
  ]);
  if (!st.ok) return { error: (st.stderr || 'git status 실패').trim().split('\n')[0] };
  const s = parseStatus(st.stdout);
  const un = parseNumstat(unstaged.stdout);
  const sg = parseNumstat(staged.stdout);
  for (const f of s.files) {
    if (f.index !== ' ' && f.index !== '?') f.staged = sg.get(f.path) || null;
    if (f.work !== ' ' && f.work !== '?') f.unstaged = un.get(f.path) || null;
  }
  return { root, ...s, commits: log.ok ? parseLog(log.stdout) : [] };
}

const SAFE_PATH = (p) => typeof p === 'string' && p !== '' && !p.startsWith('-') && !/(^|[\\/])\.\.([\\/]|$)/.test(p) && !p.includes('\0');
const SAFE_REV = (r) => typeof r === 'string' && /^[0-9a-f]{7,64}$/.test(r);

// The working-tree change of one file: staged and unstaged together (vs HEAD),
// or the index alone for a repository without commits.
async function gitFileDiff(target, path, run = runGit) {
  if (!SAFE_PATH(path)) return { error: '잘못된 경로' };
  let r = await run(['diff', 'HEAD', '--no-ext-diff', '--', path], target);
  if (!r.ok) r = await run(['diff', '--cached', '--no-ext-diff', '--', path], target);
  if (!r.ok) return { error: (r.stderr || 'git diff 실패').trim().split('\n')[0] };
  return { lines: r.stdout.replace(/\n$/, '').split('\n').filter((l, i, a) => a.length > 1 || l) };
}

async function gitShow(target, rev, run = runGit) {
  if (!SAFE_REV(rev)) return { error: '잘못된 커밋' };
  const r = await run(['show', '--no-ext-diff', '--format=commit %H%n%n    %s%n%n%b', rev], target);
  if (!r.ok) return { error: (r.stderr || 'git show 실패').trim().split('\n')[0] };
  const text = r.stdout.length > 600000 ? `${r.stdout.slice(0, 600000)}\n… (일부만 표시)` : r.stdout;
  // An empty body leaves blank lines before the first diff: keep one.
  const lines = text.replace(/\n$/, '').split('\n');
  const first = lines.findIndex((l) => l.startsWith('diff --git '));
  const head = (first === -1 ? lines : lines.slice(0, first)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '').split('\n');
  return { lines: first === -1 ? head : [...head, '', ...lines.slice(first)] };
}

module.exports = { runGit, parseStatus, parseNumstat, parseLog, gitStatus, gitFileDiff, gitShow, SAFE_PATH, SAFE_REV };
