'use strict';

// The file tab's "내용" search: the lines of the project's files that hold
// a word. In a git repository `git grep` does it (tracked and untracked
// files git does not ignore, binary files skipped); without git the files
// of the folder walk are read here. The query is literal text (no
// patterns); it ignores case unless it has a capital letter ("smart case",
// as other editors). At most PER_FILE_MAX lines are shown per file (the
// rest only counted, so one file full of matches leaves room for the
// others), HITS_MAX shown in all, and the search stops after SEEN_MAX
// lines found.
// The HTML preview's earlier drawings (private/.history) are left out.

const fs = require('node:fs');
const path = require('node:path');

const HITS_MAX = 500; // lines shown, over all files
const PER_FILE_MAX = 50; // lines shown per file (the rest counted)
const SEEN_MAX = 20000; // lines found (shown or counted): then it stops
const LINE_MAX = 240; // characters of a line shown, around the match
const FILE_MAX = 2 * 1024 * 1024; // larger files are not read (no git)
const QUERY_MIN = 2;
const QUERY_MAX = 200;

const ignoreCaseFor = (q) => q === q.toLowerCase();

// The query as asked, or null when it cannot be searched.
function checkQuery(query) {
  const q = typeof query === 'string' ? query : '';
  if (q.trim().length < QUERY_MIN || q.length > QUERY_MAX || /[\0\r\n]/.test(q)) return null;
  return q;
}

// A long line cut around its first match (with "…" where cut).
function clipLine(text, query, ignoreCase) {
  const t = text.replace(/\r$/, '');
  if (t.length <= LINE_MAX) return t;
  const at = Math.max(0, (ignoreCase ? t.toLowerCase() : t).indexOf(ignoreCase ? query.toLowerCase() : query));
  const start = Math.max(0, Math.min(at - 60, t.length - LINE_MAX));
  return `${start > 0 ? '…' : ''}${t.slice(start, start + LINE_MAX)}${start + LINE_MAX < t.length ? '…' : ''}`;
}

// Gathers the lines found: { files: [{ path, hits: [{ line, text }], more }],
// count (shown), total (found), truncated }. add() returns false once
// there are enough.
class Hits {
  constructor(query, ignoreCase) {
    this.query = query;
    this.ignoreCase = ignoreCase;
    this.files = [];
    this.byPath = new Map();
    this.count = 0;
    this.total = 0;
    this.truncated = false;
  }

  add(file, line, text) {
    if (this.count >= HITS_MAX || this.total >= SEEN_MAX) { this.truncated = true; return false; }
    this.total++;
    let f = this.byPath.get(file);
    if (!f) {
      f = { path: file, hits: [], more: 0 };
      this.byPath.set(file, f);
      this.files.push(f);
    }
    if (f.hits.length >= PER_FILE_MAX) { f.more++; return true; }
    f.hits.push({ line, text: clipLine(text, this.query, this.ignoreCase) });
    this.count++;
    return true;
  }

  result() {
    return { files: this.files, count: this.count, total: this.total, truncated: this.truncated };
  }
}

// One line of `git grep -n -z`: "path\0line\0text". -> [path, line, text] or null.
function parseGrepLine(row) {
  const a = row.indexOf('\0');
  const b = a === -1 ? -1 : row.indexOf('\0', a + 1);
  if (b === -1) return null;
  const line = Number(row.slice(a + 1, b));
  return Number.isInteger(line) && line > 0 ? [row.slice(0, a), line, row.slice(b + 1)] : null;
}

// Left out: the earlier drawings the HTML preview keeps (copies of
// private/index.html, the app's own).
const SKIP_DIR = 'private/.history/';
const skipped = (rel) => rel.startsWith(SKIP_DIR);

function grepArgs(query, ignoreCase) {
  return ['grep', '-n', '-z', '-I', '-F', '--untracked', '--no-color', ...(ignoreCase ? ['-i'] : []), '-e', query, '--', '.', `:(exclude)${SKIP_DIR}`];
}

// Without git: the files of the walk (relative, "/"-separated) read one by
// one, binary ones (a NUL near the start) and large ones skipped, until
// enough lines or `budgetMs` (inside WSL every read crosses the network
// share). `stale()` true stops it (a newer search began).
async function searchFiles(host, files, hits, { budgetMs = 4000, now = Date.now, stale = () => false } = {}) {
  const end = now() + budgetMs;
  const needle = hits.ignoreCase ? hits.query.toLowerCase() : hits.query;
  for (const rel of files) {
    if (stale()) return { stale: true };
    if (skipped(rel)) continue;
    if (now() > end) { hits.truncated = true; break; }
    const file = path.join(host, ...rel.split('/'));
    const info = await fs.promises.stat(file).catch(() => null);
    if (!info || !info.isFile() || info.size > FILE_MAX) continue;
    const buf = await fs.promises.readFile(file).catch(() => null);
    if (!buf || buf.subarray(0, 8000).includes(0)) continue;
    const text = buf.toString('utf8');
    if (!(hits.ignoreCase ? text.toLowerCase() : text).includes(needle)) continue;
    const lines = text.split('\n');
    for (let k = 0; k < lines.length; k++) {
      if (!(hits.ignoreCase ? lines[k].toLowerCase() : lines[k]).includes(needle)) continue;
      if (!hits.add(rel, k + 1, lines[k])) return {};
    }
  }
  return {};
}

module.exports = { HITS_MAX, PER_FILE_MAX, SEEN_MAX, LINE_MAX, QUERY_MIN, QUERY_MAX, ignoreCaseFor, checkQuery, clipLine, Hits, parseGrepLine, grepArgs, searchFiles };
