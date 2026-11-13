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
    gitRunner: async (args) => { if (args[0] === 'check-ignore') calls.push(args); return { ok: true, code: 0, stdout: args[0] === 'check-ignore' ? 'debug.log\n' : '' }; } });
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

test('the root listing carries git changes; the search list honors .gitignore', { skip: !hasGit && 'needs git' }, async () => {
  const { root } = project();
  spawnSync('git', ['-C', root, 'add', 'README.md', 'src']);
  spawnSync('git', ['-C', root, '-c', 'user.name=user', '-c', 'user.email=user@example.com', 'commit', '-qm', 'init']);
  fs.writeFileSync(path.join(root, 'README.md'), '# changed');
  fs.mkdirSync(path.join(root, 'reports'));
  fs.writeFileSync(path.join(root, 'reports', 'r1.md'), 'new');
  const { m, id } = manager(root);
  const top = await m.fileTree(id, '');
  const st = new Map(top.status);
  assert.strictEqual(st.get('README.md'), 'M');
  assert.strictEqual(st.get('reports/'), 'U');
  assert.ok(!st.has('debug.log'), 'ignored files are not changes');
  const list = await m.fileList(id);
  assert.strictEqual(list.root, root);
  assert.ok(list.files.includes('src/app/main.js') && list.files.includes('reports/r1.md'));
  assert.ok(!list.files.some((f) => f.startsWith('node_modules/') || f === 'debug.log'), 'ignored files are not searched');
});

test('outside git the search list walks the folder, skipping node_modules', async () => {
  const { base } = project();
  const { m, id } = manager(base);
  const top = await m.fileTree(id, '');
  assert.strictEqual(top.status, undefined);
  const list = await m.fileList(id);
  assert.ok(list.files.includes('secret.txt') && list.files.includes('sample-app/README.md'));
  assert.ok(!list.files.some((f) => f.includes('node_modules/') || f.includes('.git/')));
});

test('the search walk skips hidden and cache folders, does not list linked folders, and stops on its time budget', async () => {
  const { walkFiles } = require('../src/file-tree');
  const { base } = project();
  fs.mkdirSync(path.join(base, '.cache', 'x'), { recursive: true });
  fs.writeFileSync(path.join(base, '.cache', 'x', 'big.bin'), 'x');
  fs.mkdirSync(path.join(base, '__pycache__'));
  fs.writeFileSync(path.join(base, '__pycache__', 'm.pyc'), 'x');
  fs.writeFileSync(path.join(base, '.env'), 'x');
  const w = await walkFiles(base);
  assert.ok(w.files.includes('.env'), 'hidden files are listed');
  assert.ok(!w.files.some((f) => f.startsWith('.cache/') || f.startsWith('__pycache__/')));
  assert.ok(w.files.includes('sample-app/outside-link.txt'), 'a link to a file is listed');
  assert.ok(!w.files.includes('sample-app/outside-dir') && !w.files.includes('sample-app/src-link'), 'links to folders are not');
  let t = 0;
  const slow = await walkFiles(base, 20000, 100, () => (t += 60));
  assert.strictEqual(slow.truncated, true);
});

test('when git cannot list the files the search walks the folder and says so', async () => {
  const { root } = project();
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    gitRunner: async () => ({ ok: false, code: -1, stdout: '', stderr: '' }), gitLister: async () => ({ ok: false, timedOut: true, stderr: '' }) });
  const { id } = m.create({ cwd: root });
  await m.fileTree(id, '');
  const list = await m.fileList(id);
  assert.ok(list.files.includes('README.md'));
  assert.match(list.note, /git 목록을 읽지 못해/);
});

test('the walk enters project dot folders and build folders, and leaves out links that point outside', async () => {
  const { walkFiles } = require('../src/file-tree');
  const { root } = project();
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'SKILL.md'), 'x');
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build', 'rules.py'), 'x');
  fs.mkdirSync(path.join(root, '.cache'));
  fs.writeFileSync(path.join(root, '.cache', 'c.bin'), 'x');
  const w = await walkFiles(root);
  assert.ok(w.files.includes('.claude/skills/SKILL.md') && w.files.includes('build/rules.py'));
  assert.ok(!w.files.includes('.cache/c.bin'));
  assert.ok(!w.files.includes('outside-link.txt'), 'a link to a file outside the folder is not offered');
});

test('git search list: tracked links that point outside are left out; a .git that is no repository walks without a warning', { skip: !hasGit && 'needs git' }, async () => {
  const { root } = project();
  fs.symlinkSync('README.md', path.join(root, 'inside-link.md'));
  spawnSync('git', ['-C', root, 'add', '-A']);
  const { m, id } = manager(root);
  await m.fileTree(id, '');
  const list = await m.fileList(id);
  assert.ok(list.files.includes('inside-link.md') && list.files.includes('README.md'));
  assert.ok(!list.files.includes('outside-link.txt'));
  assert.strictEqual(list.note, undefined);

  const { base } = project();
  const broken = path.join(base, 'broken');
  fs.mkdirSync(path.join(broken, '.git'), { recursive: true }); // not a repository
  fs.writeFileSync(path.join(broken, 'a.txt'), 'x');
  const b = manager(broken);
  await b.m.fileTree(b.id, '');
  const bl = await b.m.fileList(b.id);
  assert.deepStrictEqual(bl.files, ['a.txt']);
  assert.strictEqual(bl.note, undefined);
});

test('git search list: no submodules, no files deleted from the disk', { skip: !hasGit && 'needs git' }, async () => {
  const { root } = project();
  spawnSync('git', ['-C', root, 'add', 'README.md', 'src']);
  spawnSync('git', ['-C', root, '-c', 'user.name=user', '-c', 'user.email=user@example.com', 'commit', '-qm', 'init']);
  fs.rmSync(path.join(root, 'src', 'file2.txt'));
  // A submodule entry (mode 160000) without fetching anything.
  const sha = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', `160000,${sha},vendor/lib`]);
  const { m, id } = manager(root);
  await m.fileTree(id, '');
  const list = await m.fileList(id);
  assert.ok(list.files.includes('src/file10.txt'));
  assert.ok(!list.files.includes('src/file2.txt'), 'deleted from the disk');
  assert.ok(!list.files.includes('vendor/lib'), 'a submodule is a folder');
});

test('insideRealAll resolves the root once and keeps the order', async () => {
  const { insideRealAll } = require('../src/file-tree');
  const { base, root } = project();
  const got = await insideRealAll(root, [path.join(root, 'README.md'), path.join(root, 'outside-link.txt'), path.join(root, 'missing.txt'), path.join(base, 'secret.txt')], path, 2);
  assert.deepStrictEqual(got, [true, false, true, false]);
});

test('the walk does not enter .config (in a home folder it holds app and browser settings)', async () => {
  const { walkFiles } = require('../src/file-tree');
  const { base } = project();
  fs.mkdirSync(path.join(base, '.config', 'browser'), { recursive: true });
  fs.writeFileSync(path.join(base, '.config', 'browser', 'Cookies'), 'x');
  assert.ok(!(await walkFiles(base)).files.some((f) => f.startsWith('.config/')));
});

test('git search list leaves out sparse-checkout files and links to nothing, and stops reading at the limit', { skip: !hasGit && 'needs git' }, async () => {
  const { root } = project();
  fs.symlinkSync('build/latest.md', path.join(root, 'latest.md')); // a link to nothing
  spawnSync('git', ['-C', root, 'add', 'README.md', 'src', 'latest.md']);
  // As sparse checkout leaves it: in the index, marked skip-worktree, not on disk.
  spawnSync('git', ['-C', root, 'update-index', '--skip-worktree', 'src/file2.txt']);
  fs.rmSync(path.join(root, 'src', 'file2.txt'));
  const { m, id } = manager(root);
  await m.fileTree(id, '');
  const list = await m.fileList(id);
  assert.ok(list.files.includes('src/file10.txt'));
  assert.ok(!list.files.includes('src/file2.txt'), 'sparse checkout');
  assert.ok(!list.files.includes('latest.md'), 'link to nothing');

  // A huge repository: reading stops once there are enough files.
  let fed = 0;
  const big = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    gitLister: async (args, target, onRecord) => {
      if (!args.includes('-s')) return { ok: true };
      for (let i = 0; i < 100000; i++) { fed++; if (onRecord(`H 100644 ${'a'.repeat(40)} 0\tf${i}.txt`) === false) return { ok: true, stopped: true }; }
      return { ok: true };
    } });
  const b = big.create({ cwd: root });
  await big.fileTree(b.id, '');
  const bl = await big.fileList(b.id);
  assert.strictEqual(bl.files.length, 20000);
  assert.strictEqual(bl.truncated, true);
  assert.ok(fed <= 20001, `stopped after ${fed} rows`);
});
