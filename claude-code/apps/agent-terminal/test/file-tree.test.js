'use strict';
// The file tab: the project's folder tree, read-only, never outside the project.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findRoot, relSegments, listFolder } = require('../src/file-tree');
const { SessionManager } = require('../src/sessions');

const hasGit = spawnSync('git', ['--version']).status === 0;

function project() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tree-')));
  const root = path.join(base, 'sample-app');
  const w = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('README.md', '# sample');
  w('src/app/main.js');
  w('src/file10.txt');
  w('src/file2.txt');
  w('node_modules/pkg/index.js');
  w('.gitignore', 'node_modules/\n*.log\n');
  w('debug.log');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside');
  fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'outside-link.txt'));
  fs.symlinkSync(base, path.join(root, 'outside-dir'));
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'src-link'));
  if (hasGit) spawnSync('git', ['init', '-q', root]);
  else fs.mkdirSync(path.join(root, '.git'));
  return { base, root };
}

function manager(cwd) {
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0 });
  const { id } = m.create({ cwd });
  return { m, id };
}

test('relSegments keeps paths inside the root', () => {
  assert.deepStrictEqual(relSegments('', false), []);
  assert.deepStrictEqual(relSegments('src/app', false), ['src', 'app']);
  for (const bad of ['..', 'src/../..', './src', 'src//app', '/etc', 'a\0b', null]) {
    assert.strictEqual(relSegments(bad, false), null, String(bad));
    assert.strictEqual(relSegments(bad, true), null, String(bad));
  }
  // A backslash is part of a Linux file name, a separator on Windows.
  assert.deepStrictEqual(relSegments('docs/a\\b.txt', false), ['docs', 'a\\b.txt']);
  assert.deepStrictEqual(relSegments('docs\\b.txt', true), ['docs', 'b.txt']);
  for (const bad of ['a\\..\\..\\x', 'C:\\x', '\\\\host\\share']) assert.strictEqual(relSegments(bad, true), null, bad);
});

test('the root is the git repository of the folder, else the folder', async () => {
  const { base, root } = project();
  assert.deepStrictEqual(await findRoot(path.join(root, 'src', 'app')), { dir: root, git: true });
  assert.deepStrictEqual(await findRoot(base), { dir: base, git: false });
});

test('folders first, names in natural order, .git hidden, links listed as what they point to', async () => {
  const { root } = project();
  const r = await listFolder(root);
  assert.deepStrictEqual(r.entries.map((e) => `${e.dir ? 'd' : 'f'}:${e.name}${e.link ? '@' : ''}`),
    ['d:node_modules', 'd:outside-dir@', 'd:src', 'd:src-link@', 'f:.gitignore', 'f:debug.log', 'f:outside-link.txt@', 'f:README.md']);
  assert.deepStrictEqual((await listFolder(path.join(root, 'src'))).entries.map((e) => e.name), ['app', 'file2.txt', 'file10.txt']);
  assert.ok((await listFolder(path.join(root, 'nope'))).error);
});

test('fileTree lists the project, marks ignored entries, and refuses links that leave it', async () => {
  const { root } = project();
  const { m, id } = manager(path.join(root, 'src', 'app'));
  const top = await m.fileTree(id, '');
  assert.strictEqual(top.root, root);
  if (hasGit) {
    assert.deepStrictEqual(top.entries.filter((e) => e.ignored).map((e) => e.name), ['node_modules', 'debug.log']);
  }
  assert.deepStrictEqual((await m.fileTree(id, 'src')).entries.map((e) => e.name), ['app', 'file2.txt', 'file10.txt']);
  assert.ok((await m.fileTree(id, 'src-link')).entries, 'a link inside the project opens');
  assert.match((await m.fileTree(id, 'outside-dir')).error, /프로젝트 밖/);
  assert.strictEqual((await m.fileTree(id, '../')).error, '잘못된 경로입니다');
});

test('the viewer may read project files, but not through ".." or a link leading out', async () => {
  const { base, root } = project();
  const { m, id } = manager(root);
  const readme = path.join(root, 'README.md');
  assert.strictEqual(await m.resolveFile(id, readme), null, 'not before the tree was listed');
  await m.fileTree(id, '');
  assert.deepStrictEqual(await m.resolveFile(id, readme), { path: readme, host: readme, tree: true, rootHost: root });
  assert.ok(await m.resolveFile(id, path.join(root, 'src', 'app', 'main.js')));
  assert.strictEqual(await m.resolveFile(id, `${root}/src/../../secret.txt`), null);
  assert.strictEqual(await m.resolveFile(id, path.join(base, 'secret.txt')), null);
  assert.strictEqual(await m.resolveFile(id, path.join(root, 'outside-link.txt')), null);
  assert.strictEqual(await m.resolveFile(id, `${root}-other/x`), null, 'a sibling folder with the same prefix');
});

test('ignored entries are asked from git on fresh reads and for new folders; other reads reuse the answer', async () => {
  const { root } = project();
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    gitRunner: async (args) => { calls.push(args); return { ok: true, code: 0, stdout: 'debug.log\n' }; } });
  const calls = [];
  const { id } = m.create({ cwd: root });
  const ignored = (r) => r.entries.filter((e) => e.ignored).map((e) => e.name);
  assert.deepStrictEqual(ignored(await m.fileTree(id, '')), ['debug.log'], 'first read of a folder asks');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(ignored(await m.fileTree(id, '')), ['debug.log'], 'a quick refresh reuses it');
  assert.deepStrictEqual(ignored(await m.fileTree(id, 'src')), []);
  assert.strictEqual(calls.length, 2, 'a folder not asked yet is asked');
  await m.fileTree(id, 'src');
  assert.strictEqual(calls.length, 2);
  await m.fileTree(id, '', true);
  await m.fileTree(id, 'src', true);
  assert.strictEqual(calls.length, 4, 'fresh reads (⟳, end of a turn) ask again');
});

test('after a cd the viewer can still read the project file it shows; a backslash name opens on Linux', async () => {
  const { root } = project();
  const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-other-')));
  fs.writeFileSync(path.join(root, 'docs-a\\b.md'), 'x');
  const { m, id } = manager(root);
  await m.fileTree(id, '');
  const readme = path.join(root, 'README.md');
  assert.ok(await m.resolveFile(id, readme));
  assert.ok(await m.resolveFile(id, path.join(root, 'docs-a\\b.md')), 'name with a backslash');
  m.sessions.get(id).cwd = elsewhere; // the terminal moved to another project
  await m.fileTree(id, '');
  assert.ok(await m.resolveFile(id, readme), 'the file read before still reads');
  assert.strictEqual(await m.resolveFile(id, path.join(root, 'src', 'app', 'main.js')), null, 'not the rest of the old project');
});

test('git refusing a folder (submodule, linked folder) is remembered until a fresh read', async () => {
  const { root } = project();
  const calls = [];
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    gitRunner: async (args) => { calls.push(args); return { ok: false, code: 128, stdout: '', stderr: "fatal: Pathspec 'sub/x' is in submodule 'sub'" }; } });
  const { id } = m.create({ cwd: root });
  await m.fileTree(id, 'src');
  await m.fileTree(id, 'src');
  await m.fileTree(id, 'src');
  assert.strictEqual(calls.length, 1, 'asked once, not on every refresh');
  await m.fileTree(id, 'src', true);
  assert.strictEqual(calls.length, 2);
});

test('the root is found again only on a fresh read or after a cd', async () => {
  const { root } = project();
  const { m, id } = manager(path.join(root, 'src'));
  await m.fileTree(id, '');
  const first = m.sessions.get(id).tree;
  await m.fileTree(id, '');
  assert.strictEqual(m.sessions.get(id).tree, first, 'quick refresh: same root, not searched again');
  await m.fileTree(id, '', true);
  assert.notStrictEqual(m.sessions.get(id).tree, first, 'fresh read: searched again');
});
