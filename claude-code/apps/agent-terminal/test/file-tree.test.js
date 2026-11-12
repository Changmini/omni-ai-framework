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
  assert.deepStrictEqual(relSegments(''), []);
  assert.deepStrictEqual(relSegments('src/app'), ['src', 'app']);
  for (const bad of ['..', 'src/../..', './src', 'src//app', '/etc', 'C:\\x', 'a\0b', null]) assert.strictEqual(relSegments(bad), null, String(bad));
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
  assert.deepStrictEqual(await m.resolveFile(id, readme), { path: readme, host: readme, tree: true });
  assert.ok(await m.resolveFile(id, path.join(root, 'src', 'app', 'main.js')));
  assert.strictEqual(await m.resolveFile(id, `${root}/src/../../secret.txt`), null);
  assert.strictEqual(await m.resolveFile(id, path.join(base, 'secret.txt')), null);
  assert.strictEqual(await m.resolveFile(id, path.join(root, 'outside-link.txt')), null);
  assert.strictEqual(await m.resolveFile(id, `${root}-other/x`), null, 'a sibling folder with the same prefix');
});
