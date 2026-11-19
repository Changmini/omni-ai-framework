'use strict';

// The HTML preview: <project>/private/index.html, drawn by Claude on request
// (diagrams, charts) and shown beside the terminal. This module has no
// Electron in it (tested with node); main.js serves its answers over the
// omni-preview:// protocol and sends its change notices to the windows.
//
// Paths here are the ones this host reads (inside WSL: \\wsl.localhost\...).

const fs = require('node:fs');
const path = require('node:path');
const { relSegments, insideReal } = require('./file-tree');

const PREVIEW_DIR = 'private';
const INDEX = 'index.html';
const HISTORY_DIR = '.history';
const HISTORY_MAX = 10; // earlier drawings kept
const CONTENT_MAX = 2 * 1024 * 1024; // a drawing larger than this gets no earlier version kept
const FILE_MAX = 32 * 1024 * 1024; // largest file served

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};
const mimeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

// What a preview page may do: scripts, styles, images and fonts from the
// page itself and from https (chart and diagram libraries on a CDN), no
// frames, no forms. The page also runs in a sandboxed iframe without
// allow-same-origin, so it reaches nothing of the app.
const PAGE_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ');

// Added to every HTML page shown (as its source text; it runs in the page):
// - the page tells the app where it is scrolled, and the app sends that
//   back after a reload, so a redrawn page keeps its place;
// - it tells when the user presses in the page (the app lets the page keep
//   the keyboard then, and only then);
// - it gives the scrollbars' track (SCROLLBAR_STYLE) the page's background:
//   the page's own background does not reach under a scrollbar, the
//   frame's white would show there. A colour, else the first colour of a
//   gradient, else (an image) dark or white by the text colour; again when
//   the page changes it (a class or style on <html>/<body>, the system's
//   light or dark mode).
// - its animations (CSS, Web Animations, requestAnimationFrame loops) rest
//   after REST_MS without the mouse or keys on the page: an endless
//   animation repaints for as long as the drawing shows (several % of a
//   CPU core). Moving the mouse over it plays them again.
// Messages carry numbers only.
/* eslint-disable no-undef -- runs in the page */
function pageHelper() {
  const REST_MS = 30000;
  let resting = false;
  let restTimer = 0;
  let paused = [];
  // Frame callbacks asked for while resting, by an id of their own (below
  // zero, never reused), each function once, at most WAITING_MAX: a page
  // asking from a timer would pile them up. Past that, new ones are let go
  // (not the first ones: an animation loop's one pending frame among them
  // would end the loop). Run at the wake; an id from the rest still cancels
  // its frame after that (realOf).
  const WAITING_MAX = 200;
  const waiting = new Map();
  const realOf = new Map();
  let nextId = 0;
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (!resting) return raf(cb);
    for (const [id, f] of waiting) if (f === cb) return id;
    const id = --nextId;
    if (waiting.size < WAITING_MAX) waiting.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (n) => {
    if (n >= 0) { caf(n); return; }
    waiting.delete(n);
    if (realOf.has(n)) { caf(realOf.get(n)); realOf.delete(n); }
  };
  const rest = () => {
    resting = true;
    paused = document.getAnimations().filter((a) => a.playState === 'running');
    for (const a of paused) a.pause();
    parent.postMessage({ omniPreview: 'rest', on: true }, '*');
  };
  const wake = () => {
    clearTimeout(restTimer);
    restTimer = setTimeout(rest, REST_MS);
    if (!resting) return;
    resting = false;
    for (const a of paused) { try { a.play(); } catch { /* gone */ } }
    paused = [];
    for (const [id, cb] of waiting) realOf.set(id, raf((t) => { realOf.delete(id); cb(t); }));
    waiting.clear();
    parent.postMessage({ omniPreview: 'rest', on: false }, '*');
  };
  // The mouse or keys on the page; also a new size (the preview's border
  // dragged, a narrow window): a chart redraws itself in a frame then.
  for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'resize']) addEventListener(type, wake, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  wake();

  let timer;
  const sendScroll = () => parent.postMessage({ omniPreview: 'scroll', x: scrollX, y: scrollY }, '*');
  addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(sendScroll, 120); }, { passive: true });
  addEventListener('pointerdown', (e) => { if (e.isTrusted) parent.postMessage({ omniPreview: 'touch' }, '*'); }, true);
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source === parent && d && d.omniPreview === 'restore') scrollTo(Number(d.x) || 0, Number(d.y) || 0);
  });
  const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
  const color = (el) => { const c = el && getComputedStyle(el).backgroundColor; return clear(c) ? null : c; };
  const gradient = (el) => { const m = el && /rgba?\([^)]*\)/.exec(getComputedStyle(el).backgroundImage); return m && !clear(m[0]) ? m[0] : null; };
  const byText = () => {
    const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body || document.documentElement).color);
    return m && (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 > 0.5 ? '#14161c' : '#fff';
  };
  const track = () => {
    const root = document.documentElement;
    const body = document.body;
    const bg = color(root) || color(body) || gradient(root) || gradient(body) || byText();
    // Set only when it changed: setting it is itself a change of <html>'s style.
    if (root.style.getPropertyValue('--omni-sb-bg') !== bg) root.style.setProperty('--omni-sb-bg', bg);
  };
  track();
  addEventListener('load', track);
  // Once changes pause (a page animating <body>'s style is not restyled
  // every frame for this).
  let pending = 0;
  const later = () => { clearTimeout(pending); pending = setTimeout(track, 200); };
  const watch = { attributes: true, attributeFilter: ['class', 'style'] };
  const observer = new MutationObserver(later);
  observer.observe(document.documentElement, watch);
  if (document.body) observer.observe(document.body, watch);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', later);
  parent.postMessage({ omniPreview: 'ready' }, '*');
}
/* eslint-enable no-undef */
const SCROLL_KEEPER = `<script>(${pageHelper.toString()})();</script>`;

// The app's thin scrollbars (renderer/styles.css), so a drawing scrolls
// like the rest of the app. Put first in the page: a drawing's own
// scrollbar style, later, still wins.
const SCROLLBAR_STYLE = '<style>::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:var(--omni-sb-bg,transparent)}'
  + '::-webkit-scrollbar-thumb{background:rgba(125,132,148,.28);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(125,132,148,.5)}'
  + '::-webkit-scrollbar-thumb:active{background:rgba(217,119,87,.7)}::-webkit-scrollbar-corner{background:var(--omni-sb-bg,transparent)}</style>';

// After the opening <head> (else <html>, else the doctype: nothing may come
// before a doctype, or the page would render in quirks mode).
function withScrollbars(html) {
  for (const re of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + SCROLLBAR_STYLE + html.slice(m.index + m[0].length);
  }
  return SCROLLBAR_STYLE + html;
}

// Before the last </body> (an earlier one may be inside a script string).
function withScrollKeeper(html) {
  const ends = [...html.matchAll(/<\/body\s*>/gi)];
  const at = ends.length ? ends[ends.length - 1].index : -1;
  return at === -1 ? html + SCROLL_KEEPER : html.slice(0, at) + SCROLL_KEEPER + html.slice(at);
}

// Shown while private/index.html does not exist yet.
const GUIDE_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>미리보기</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14161c;color:#d7dae0;font:14px/1.6 system-ui,sans-serif}
main{max-width:460px;padding:24px}h1{font-size:17px;margin:0 0 10px}p{color:#9aa1b2;margin:6px 0}code{background:#1f2430;padding:1px 6px;border-radius:4px;color:#e6b450}</style>
</head><body><main><h1>아직 그림이 없습니다</h1>
<p>터미널의 Claude에게 <b>다이어그램</b>, <b>차트</b>, <b>그림</b>을 부탁하면 <code>private/index.html</code>에 그리고, 여기에 바로 나타납니다.</p>
<p>예: "결제 흐름을 다이어그램으로 그려줘"</p></main></body></html>`;

// "2026-11-16_18-02-31.html" in local time; -2, -3 ... when one exists.
function historyName(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.html`;
}
const HISTORY_FILE = /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(-\d+)?\.html$/;

// Earlier drawings, newest first (names sort by time).
async function listHistory(dir) {
  const hist = path.join(dir, HISTORY_DIR);
  let names;
  try { names = await fs.promises.readdir(hist); } catch { return []; }
  if (!(await insideReal(dir, hist))) return [];
  return names.filter((n) => HISTORY_FILE.test(n)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// Keeps the version a change replaced, then the newest HISTORY_MAX only.
async function keepHistory(dir, content, at) {
  const hist = path.join(dir, HISTORY_DIR);
  await fs.promises.mkdir(hist, { recursive: true });
  if (!(await insideReal(dir, hist))) return; // a .history link out of private/: nothing written there
  const base = historyName(at).replace(/\.html$/, '');
  let name = `${base}.html`;
  for (let k = 2; await fs.promises.access(path.join(hist, name)).then(() => true, () => false); k++) name = `${base}-${k}.html`;
  await fs.promises.writeFile(path.join(hist, name), content);
  const all = await listHistory(dir);
  for (const old of all.slice(HISTORY_MAX)) await fs.promises.unlink(path.join(hist, old)).catch(() => {});
}

// Change detection for each private folder: the last version seen (time,
// size, content), a version number that grows with each change, and the
// earlier version copied to .history when a change replaces it. Asked by
// the page while the preview shows (every second) and by main.js when a
// Claude Write/Edit of private/index.html arrives. One check at a time per
// folder; a check during one gets its answer.
class PreviewWatch {
  constructor({ emit = () => {}, now = Date.now } = {}) {
    this.emit = emit;
    this.now = now;
    this.state = new Map(); // dir -> { mtimeMs, size, content, version, at, pending }
  }

  // `wrote`: Claude just wrote the file (a hook): announced even on the
  // first look, so a preview never looked at yet still opens for it.
  async check(dir, key, wrote = false) {
    let st = this.state.get(dir);
    if (!st) { st = { seen: false, mtimeMs: null, size: null, content: null, version: 0, at: null, pending: null, history: null }; this.state.set(dir, st); }
    if (st.pending) return st.pending;
    st.pending = this.checkNow(dir, st, key, wrote).finally(() => { st.pending = null; });
    return st.pending;
  }

  async checkNow(dir, st, key, wrote) {
    const file = path.join(dir, INDEX);
    let info = await fs.promises.stat(file).catch(() => null);
    // A link out of private/ is not read (nor copied into .history).
    if (info && !(await insideReal(dir, file))) info = null;
    // The first look at a folder only records it; every later change is
    // announced (also a drawing that appears where there was none).
    const first = !st.seen;
    st.seen = true;
    if (!info || !info.isFile()) {
      const was = st.mtimeMs !== null;
      Object.assign(st, { mtimeMs: null, size: null, content: null });
      if (was) { st.version++; st.at = this.now(); this.emit({ key, dir, version: st.version }); }
      return this.answer(dir, st, false);
    }
    if (info.mtimeMs === st.mtimeMs && info.size === st.size) return this.answer(dir, st, true);
    // Empty: a write under way (truncated, not yet written). Looked at again
    // next time instead of being shown, or kept as a version.
    if (info.size === 0 && st.content) return this.answer(dir, st, true);
    const content = info.size <= CONTENT_MAX ? await fs.promises.readFile(file).catch(() => null) : null;
    const same = content && st.content && content.equals(st.content);
    if (!first && !same && st.content) {
      await keepHistory(dir, st.content, st.at || this.now()).catch(() => {});
      st.history = null; // listed again
    }
    Object.assign(st, { mtimeMs: info.mtimeMs, size: info.size, content });
    if (first || !same) {
      st.version++;
      st.at = this.now();
      if (!first || wrote) this.emit({ key, dir, version: st.version });
    }
    return this.answer(dir, st, true);
  }

  // The history list is read once and again only after a version was
  // kept (not on every look).
  async answer(dir, st, exists) {
    if (!st.history) st.history = await listHistory(dir);
    return { exists, version: st.version, at: st.at, history: st.history };
  }
}

// One file of a private folder for the omni-preview:// protocol: `segs` as
// from the URL path. index.html that does not exist yet is the guide page.
// HTML gets the scroll keeper. -> { status, type, body }.
async function serveFile(dir, segs) {
  const ok = (type, body) => ({ status: 200, type, body });
  if (!segs.length || (segs.length === 1 && segs[0] === INDEX)) {
    const info = await fs.promises.stat(path.join(dir, INDEX)).catch(() => null);
    if (!info) return ok(MIME['.html'], withScrollKeeper(withScrollbars(GUIDE_PAGE)));
    segs = [INDEX];
  }
  const file = path.join(dir, ...segs);
  // ".." and absolute parts never get here (relSegments); a link inside the
  // folder must not lead out of it either.
  if (!(await insideReal(dir, file))) return { status: 403, type: MIME['.txt'], body: 'not allowed' };
  const info = await fs.promises.stat(file).catch(() => null);
  if (!info || !info.isFile()) return { status: 404, type: MIME['.txt'], body: 'not found' };
  if (info.size > FILE_MAX) return { status: 413, type: MIME['.txt'], body: 'too large' };
  const body = await fs.promises.readFile(file);
  const type = mimeOf(file);
  return ok(type, type.startsWith('text/html') ? withScrollKeeper(withScrollbars(body.toString('utf8'))) : body);
}

// The URL path of an omni-preview:// request as segments, or null.
function urlSegments(pathname, win = process.platform === 'win32') {
  let rel;
  try { rel = decodeURIComponent(String(pathname || '').replace(/^\/+/, '')); } catch { return null; }
  return relSegments(rel, win);
}

module.exports = {
  PREVIEW_DIR, INDEX, HISTORY_DIR, HISTORY_MAX, PAGE_CSP, GUIDE_PAGE,
  PreviewWatch, serveFile, urlSegments, listHistory, historyName, withScrollKeeper, withScrollbars, mimeOf,
};
