'use strict';

// The project's files for the inspector's file tab: the folder tree under
// the project root, one folder at a time, read-only. Paths here are the
// ones this host reads (inside WSL: \\wsl.localhost\...); sessions.js maps
// them to what the page shows.

const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 1000; // entries listed per folder
const HIDDEN = new Set(['.git']); // never listed

// The nearest folder at or above `dir` holding .git (a folder, or a file for
// a worktree or submodule): { dir, git: true }; else { dir, git: false }.
// Asynchronous: inside WSL each check goes over the network share.
async function findRoot(dir, p = path) {
  let cur = dir;
  for (let i = 0; i < 64; i++) {
    if (await fs.promises.access(p.join(cur, '.git')).then(() => true, () => false)) return { dir: cur, git: true };
    const up = p.dirname(cur);
    if (!up || up === cur) break;
    cur = up;
  }
  return { dir, git: false };
}

// A path inside the root, as the page sends it ("src/app"): its segments, or
// null when it could leave the root ("..", ".", empty segments, a drive or
// an absolute path). `win`: this host reads Windows paths, where "\\" also
// separates (and so is split on, never kept in a name); elsewhere a
// backslash is an ordinary character of a file name.
function relSegments(rel, win = process.platform === 'win32') {
  if (typeof rel !== 'string') return null;
  if (rel === '') return [];
  if (/^\//.test(rel) || (win && /^\\|^[a-zA-Z]:/.test(rel))) return null;
  const parts = rel.split(win ? /[\\/]/ : '/');
  return parts.every((x) => x && x !== '.' && x !== '..' && !x.includes('\0')) ? parts : null;
}

// One spelling of a Windows path for comparing: case, the \\?\ and
// \\?\UNC\ forms, and \\wsl$ for \\wsl.localhost.
function windowsKey(p) {
  return p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replace(/^\\\\wsl\$\\/i, '\\\\wsl.localhost\\').toLowerCase();
}

// Whether `child` is `root` or inside it, after following links: a link in
// the project that points outside it is not followed. When a path cannot be
// resolved (missing file, a share that does not support it), the lexical
// check the caller already made stands: the read itself then fails or works
// as for any other path.
async function insideReal(root, child, p = path) {
  const real = (x) => fs.promises.realpath(x).catch(() => null);
  const [r, c] = await Promise.all([real(root), real(child)]);
  if (!r || !c) return true;
  const [rk, ck] = p.sep === '\\' ? [windowsKey(r), windowsKey(c)] : [r, c];
  return ck === rk || ck.startsWith(rk.endsWith(p.sep) ? rk : rk + p.sep);
}

// insideReal for many children of one root: the root resolved once, the
// children `batch` at a time. -> array of booleans in the same order.
// `unresolved`: the answer for a child whose real path cannot be found
// (a link to nothing: false keeps it out of a list of files to open).
async function insideRealAll(root, children, p = path, batch = 32, unresolved = true) {
  const r = await fs.promises.realpath(root).catch(() => null);
  const rk = r && (p.sep === '\\' ? windowsKey(r) : r);
  const base = rk && (rk.endsWith(p.sep) ? rk : rk + p.sep);
  // When the root cannot be resolved, links cannot be checked (a child that
  // resolves counts as inside), but one that resolves to nothing is still
  // `unresolved`.
  const inside = (x) => {
    if (!rk) return true;
    const ck = p.sep === '\\' ? windowsKey(x) : x;
    return ck === rk || ck.startsWith(base);
  };
  const out = [];
  for (let i = 0; i < children.length; i += batch) {
    out.push(...await Promise.all(children.slice(i, i + batch).map((c) => fs.promises.realpath(c).then(inside, () => unresolved))));
  }
  return out;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// The entries of one folder: folders first, then files, by name (numbers in
// order: file2 before file10). A link is listed as what it points to.
async function listFolder(dir) {
  let ents;
  try {
    ents = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return { error: e && e.code === 'ENOENT' ? '폴더가 없습니다' : e && e.code === 'EACCES' ? '읽을 권한이 없습니다' : '읽을 수 없습니다' };
  }
  const out = [];
  for (const e of ents) {
    if (HIDDEN.has(e.name)) continue;
    let isDir = e.isDirectory();
    const link = e.isSymbolicLink();
    if (link) isDir = await fs.promises.stat(path.join(dir, e.name)).then((st) => st.isDirectory(), () => false);
    out.push({ name: e.name, dir: isDir, ...(link ? { link: true } : {}) });
  }
  out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : collator.compare(a.name, b.name)));
  return { entries: out.slice(0, MAX_ENTRIES), total: out.length };
}

// Folders the search walk does not enter: dependency caches, and hidden
// folders (.cache, .venv, .npm: in a home folder most files are there)
// except the ones projects keep their own files in.
const SKIP_WALK = new Set(['node_modules', '__pycache__']);
const PROJECT_DOT_DIRS = new Set(['.claude', '.github', '.gitlab', '.vscode', '.devcontainer', '.circleci', '.husky', '.storybook']);
const walkInto = (name) => !HIDDEN.has(name) && !SKIP_WALK.has(name) && (!name.startsWith('.') || PROJECT_DOT_DIRS.has(name));

// Every file under `dir` (relative, "/"-separated) for the search box, for
// a project that is not a git repository (often the home folder): breadth
// first, links to folders not followed, links to files only when they stay
// in the folder (the viewer opens nothing outside it), at most `limit`
// files and `budgetMs` of reading (inside WSL each folder is a trip over
// the network share). `truncated` when it stopped early.
async function walkFiles(dir, limit = 20000, budgetMs = 3000, now = Date.now) {
  const files = [];
  const queue = [''];
  const end = now() + budgetMs;
  let truncated = false;
  while (queue.length && !truncated) {
    if (now() > end) { truncated = true; break; }
    const rel = queue.shift();
    const here = rel ? path.join(dir, ...rel.split('/')) : dir;
    let ents;
    try { ents = await fs.promises.readdir(here, { withFileTypes: true }); } catch { continue; }
    ents.sort((a, b) => collator.compare(a.name, b.name));
    for (const e of ents) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (walkInto(e.name)) queue.push(child);
        continue;
      }
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        const target = path.join(here, e.name);
        isFile = await fs.promises.stat(target).then((st) => st.isFile(), () => false) && await insideReal(dir, target);
      }
      if (!isFile) continue;
      if (files.length >= limit) { truncated = true; break; }
      files.push(child);
    }
  }
  return { files, truncated };
}

module.exports = { findRoot, relSegments, insideReal, insideRealAll, windowsKey, listFolder, walkFiles, MAX_ENTRIES };
