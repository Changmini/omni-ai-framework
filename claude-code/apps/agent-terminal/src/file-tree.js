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
// an absolute path).
function relSegments(rel) {
  if (typeof rel !== 'string') return null;
  if (rel === '') return [];
  if (/^[\\/]|^[a-zA-Z]:/.test(rel)) return null;
  const parts = rel.split(/[\\/]/);
  return parts.every((x) => x && x !== '.' && x !== '..' && !x.includes('\0')) ? parts : null;
}

// Whether `child` is `root` or inside it, after following links: a link in
// the project that points outside it is not followed.
async function insideReal(root, child, p = path) {
  try {
    const [r, c] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(child)]);
    return c === r || c.startsWith(r.endsWith(p.sep) ? r : r + p.sep);
  } catch {
    return false;
  }
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

module.exports = { findRoot, relSegments, insideReal, listFolder, MAX_ENTRIES };
