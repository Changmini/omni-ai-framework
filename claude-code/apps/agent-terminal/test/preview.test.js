'use strict';
// The HTML preview's main side: change detection, earlier drawings, and the
// files the omni-preview:// protocol may serve (never outside private/).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PreviewWatch, serveFile, urlSegments, listHistory, historyName, withScrollKeeper, HISTORY_MAX } = require('../src/preview');
const { SessionManager } = require('../src/sessions');

function folder() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-preview-')));
  const root = path.join(base, 'sample-app');
  const dir = path.join(root, 'private');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  return { base, root, dir };
}

// mtime must change for a change to be seen; file systems with coarse time
// would otherwise hide a quick rewrite.
function write(file, text, t) {
  fs.writeFileSync(file, text);
  const when = new Date(t);
  fs.utimesSync(file, when, when);
}

test('a change is noticed once, and the version it replaced is kept', async () => {
  const { dir } = folder();
  const seen = [];
  let now = Date.UTC(2026, 10, 16, 9, 0, 0);
  const w = new PreviewWatch({ emit: (e) => seen.push(e.version), now: () => now });
  const index = path.join(dir, 'index.html');

  let r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.exists, r.version, r.history], [false, 0, []]);

  write(index, '<p>one</p>', 1000000);
  r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.exists, r.version], [true, 1]);
  assert.deepStrictEqual(seen, [1], 'the first drawing is announced');
  r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.version, seen.length], [1, 1], 'no change: nothing new');

  now += 60000;
  write(index, '<p>two</p>', 2000000);
  r = await w.check(dir, 't1');
  assert.strictEqual(r.version, 2);
  assert.deepStrictEqual(seen, [1, 2]);
  assert.strictEqual(r.history.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.history', r.history[0]), 'utf8'), '<p>one</p>', 'the replaced version');

  // Touched without a change: no new version, nothing kept.
  write(index, '<p>two</p>', 3000000);
  r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.version, r.history.length], [2, 1]);
});

test('only the newest earlier drawings are kept', async () => {
  const { dir } = folder();
  let now = Date.UTC(2026, 10, 16, 9, 0, 0);
  const w = new PreviewWatch({ now: () => now });
  const index = path.join(dir, 'index.html');
  for (let i = 0; i < HISTORY_MAX + 4; i++) {
    write(index, `<p>${i}</p>`, 1000000 + i * 1000);
    await w.check(dir, 't1');
    now += 1000;
  }
  const hist = await listHistory(dir);
  assert.strictEqual(hist.length, HISTORY_MAX);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.history', hist[0]), 'utf8'), `<p>${HISTORY_MAX + 2}</p>`, 'newest first');
});

test('two drawings within one second get separate history files', async () => {
  const { dir } = folder();
  const now = Date.UTC(2026, 10, 16, 9, 0, 0);
  const w = new PreviewWatch({ now: () => now });
  const index = path.join(dir, 'index.html');
  for (let i = 0; i < 3; i++) { write(index, `<p>${i}</p>`, 1000000 + i * 1000); await w.check(dir, 't1'); }
  const hist = await listHistory(dir);
  assert.strictEqual(hist.length, 2);
  assert.ok(hist.some((h) => /-2\.html$/.test(h)));
});

test('checks at the same time share one look at the file', async () => {
  const { dir } = folder();
  write(path.join(dir, 'index.html'), '<p>x</p>', 1000000);
  const w = new PreviewWatch();
  const [a, b] = await Promise.all([w.check(dir, 't1'), w.check(dir, 't1')]);
  assert.strictEqual(a, b);
});

test('serveFile: the guide page until a drawing exists, then the drawing with the scroll keeper', async () => {
  const { dir } = folder();
  let r = await serveFile(dir, []);
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /아직 그림이 없습니다/);
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><p>hi</p></body></html>');
  r = await serveFile(dir, ['index.html']);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /<p>hi<\/p><script>.*omniPreview.*<\/script><\/body>/s);
  fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');
  r = await serveFile(dir, ['logo.svg']);
  assert.deepStrictEqual([r.status, r.type, String(r.body)], [200, 'image/svg+xml', '<svg/>']);
  assert.strictEqual((await serveFile(dir, ['nope.png'])).status, 404);
});

test('serveFile never leaves private/: no "..", no links out', async () => {
  const { base, dir } = folder();
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(base, 'secret.txt'), path.join(dir, 'leak.txt'));
  assert.strictEqual(urlSegments('/../secret.txt'), null);
  assert.strictEqual(urlSegments('/%2e%2e/secret.txt'), null);
  assert.strictEqual(urlSegments('/a/%2e%2e/%2e%2e/secret.txt'), null);
  assert.deepStrictEqual(urlSegments('/.history/2026-11-16_09-00-00.html'), ['.history', '2026-11-16_09-00-00.html']);
  assert.deepStrictEqual(urlSegments('/%ED%95%9C%EA%B8%80.png'), ['한글.png']);
  assert.strictEqual(urlSegments('/%E0%A4%A'), null);
  assert.strictEqual((await serveFile(dir, ['leak.txt'])).status, 403);
});

test('historyName and the scroll keeper', () => {
  assert.match(historyName(Date.UTC(2026, 10, 16, 9, 5, 7)), /^2026-11-1\d_\d\d-05-07\.html$/);
  assert.match(withScrollKeeper('<p>no body</p>'), /<p>no body<\/p><script>/);
});

test('previewDir: the project root of the terminal, also from a subfolder', async () => {
  const { root } = folder();
  fs.mkdirSync(path.join(root, 'src'));
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0 });
  const { id } = m.create({ cwd: path.join(root, 'src') });
  assert.deepStrictEqual(await m.previewDir(id), { dir: path.join(root, 'private'), shown: path.join(root, 'private', 'index.html') });
  assert.strictEqual(await m.previewDir('nope'), null);
});

test('a drawing Claude writes is announced even on the first look', async () => {
  const { dir } = folder();
  const seen = [];
  const w = new PreviewWatch({ emit: (e) => seen.push(e.version) });
  write(path.join(dir, 'index.html'), '<p>new</p>', 1000000);
  await w.check(dir, 't1', true);
  assert.deepStrictEqual(seen, [1]);
});

test('a private/ that links out of the project is not used', async () => {
  const { base, root, dir } = folder();
  fs.rmSync(dir, { recursive: true });
  const outside = path.join(base, 'elsewhere');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, dir);
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0 });
  const { id } = m.create({ cwd: root });
  const r = await m.previewDir(id);
  assert.strictEqual(r.dir, null);
  assert.match(r.error, /프로젝트 밖/);
});

test('index.html or .history that link out of private/ are not read or written', async () => {
  const { base, dir } = folder();
  fs.writeFileSync(path.join(base, 'secret.html'), '<p>secret</p>');
  fs.symlinkSync(path.join(base, 'secret.html'), path.join(dir, 'index.html'));
  const w = new PreviewWatch();
  let r = await w.check(dir, 't1');
  assert.strictEqual(r.exists, false, 'the link is not followed');
  fs.unlinkSync(path.join(dir, 'index.html'));

  const outside = path.join(base, 'hist-out');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(dir, '.history'));
  const index = path.join(dir, 'index.html');
  write(index, '<p>one</p>', 1000000);
  await w.check(dir, 't1');
  write(index, '<p>two</p>', 2000000);
  r = await w.check(dir, 't1');
  assert.strictEqual(r.version, 2);
  assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing written outside');
  assert.deepStrictEqual(r.history, []);
});

test('an emptied file (a write under way) is not a new version', async () => {
  const { dir } = folder();
  const seen = [];
  const w = new PreviewWatch({ emit: (e) => seen.push(e.version) });
  const index = path.join(dir, 'index.html');
  write(index, '<p>one</p>', 1000000);
  await w.check(dir, 't1');
  write(index, '', 2000000);
  let r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.version, r.history.length, seen.length], [1, 0, 0]);
  write(index, '<p>two</p>', 3000000);
  r = await w.check(dir, 't1');
  assert.deepStrictEqual([r.version, r.history.length], [2, 1]);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.history', r.history[0]), 'utf8'), '<p>one</p>');
});

test('the scroll keeper goes before the last </body>', () => {
  const page = '<body><script>const s = "</body>";</script></body>';
  const out = withScrollKeeper(page);
  assert.ok(out.startsWith('<body><script>const s = "</body>";</script><script>'), 'not inside the string');
  assert.ok(out.endsWith('</script></body>'));
});
