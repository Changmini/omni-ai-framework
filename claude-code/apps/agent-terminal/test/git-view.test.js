'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const gv = require('../src/git-view');
const { SessionManager } = require('../src/sessions');

const hasGit = spawnSync('git', ['--version']).status === 0;

test('git runs read-only, through wsl.exe -e (no shell) inside WSL', async () => {
  const calls = [];
  const exec = (f, a, o, cb) => { calls.push([f, a]); cb(null, Buffer.from('x'), Buffer.from('')); };
  await gv.runGit(['status'], { cwd: '/home/user/sample-app', distro: 'Ubuntu', platform: 'win32', exec });
  await gv.runGit(['status'], { cwd: '/home/user/sample-app', platform: 'linux', exec });
  const base = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', '/home/user/sample-app', 'status'];
  assert.deepStrictEqual(calls, [['wsl.exe', ['-d', 'Ubuntu', '-e', 'git', ...base]], ['git', base]]);
  const missing = await gv.runGit(['status'], { cwd: '/x', exec: (f, a, o, cb) => cb(Object.assign(new Error('no'), { code: 'ENOENT' }), '', '') });
  assert.strictEqual(missing.missing, true);
});

test('status, numstat and log parsing', () => {
  const s = gv.parseStatus('## feature/sample...origin/feature/sample [ahead 2, behind 1]\0 M src/a.py\0R  new.py\0old.py\0?? notes.md\0');
  assert.deepStrictEqual([s.branch, s.upstream, s.ahead, s.behind], ['feature/sample', 'origin/feature/sample', 2, 1]);
  assert.deepStrictEqual(s.files.map((f) => [f.index, f.work, f.path, f.orig]), [[' ', 'M', 'src/a.py', null], ['R', ' ', 'new.py', 'old.py'], ['?', '?', 'notes.md', null]]);
  assert.strictEqual(gv.parseStatus('## No commits yet on main\0').branch, 'main');
  assert.strictEqual(gv.parseStatus('## HEAD (no branch)\0').branch, null);
  const n = gv.parseNumstat('3\t1\tsrc/a.py\0-\t-\timg.png\0' + '2\t0\t\0old.py\0new.py\0');
  assert.deepStrictEqual([...n], [['src/a.py', { add: 3, del: 1 }], ['img.png', { add: null, del: null }], ['new.py', { add: 2, del: 0 }]]);
  assert.deepStrictEqual(gv.parseLog('abc1234def\x1fabc1234\x1ffix: a | b\x1f1793900000\x1e\n'), [{ hash: 'abc1234def', short: 'abc1234', subject: 'fix: a | b', time: 1793900000000 }]);
});

test('unsafe paths and revisions are refused before git runs', async () => {
  for (const p of ['-o', '../etc/passwd', 'a/../../b', '']) assert.strictEqual(gv.SAFE_PATH(p), false, p);
  assert.strictEqual(gv.SAFE_PATH('src/a b.py'), true);
  assert.strictEqual(gv.SAFE_REV('HEAD~1'), false);
  assert.strictEqual(gv.SAFE_REV('abc1234'), true);
  const never = () => { throw new Error('ran git'); };
  assert.deepStrictEqual(await gv.gitFileDiff({ cwd: '/r' }, '--output=x', never), { error: '잘못된 경로' });
  assert.deepStrictEqual(await gv.gitShow({ cwd: '/r' }, '--all', never), { error: '잘못된 커밋' });
});

test('a real repository: status, diff, show, and the viewer may read listed files', { skip: !hasGit && 'needs git' }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sample-app-')));
  const g = (...a) => spawnSync('git', ['-C', root, '-c', 'user.name=user', '-c', 'user.email=user@example.com', ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'feature/sample');
  fs.writeFileSync(path.join(root, 'a.py'), 'one\ntwo\n');
  fs.writeFileSync(path.join(root, 'old.py'), 'x\n');
  g('add', '.'); g('commit', '-qm', 'init');
  fs.writeFileSync(path.join(root, 'a.py'), 'one\nTWO\nthree\n');          // modified
  g('mv', 'old.py', 'new.py');                                              // renamed (staged)
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs', '노트.md'), '# 노트\n');          // untracked, non-ASCII

  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [], env: {} }, pollMs: 0 });
  const { id } = m.create({ cwd: path.join(root, 'docs') });
  const st = await m.gitStatus(id);
  assert.strictEqual(st.root, root);
  assert.strictEqual(st.branch, 'feature/sample');
  const by = Object.fromEntries(st.files.map((f) => [f.path, f]));
  assert.deepStrictEqual([by['a.py'].work, by['a.py'].unstaged], ['M', { add: 2, del: 1 }]);
  assert.deepStrictEqual([by['new.py'].index, by['new.py'].orig], ['R', 'old.py']);
  assert.strictEqual(by['docs/노트.md'].index, '?');
  assert.deepStrictEqual(st.commits.map((c) => c.subject), ['init']);

  const d = await m.gitDiff(id, 'a.py');
  assert.ok(d.lines.includes('-two') && d.lines.includes('+TWO') && d.lines.includes('+three'));
  assert.match((await m.gitDiff(id, 'not-listed.py')).error, /목록에 없는/);
  const show = await m.gitShow(id, st.commits[0].hash);
  assert.ok(show.lines.some((l) => l.startsWith('diff --git a/a.py')));
  const blanks = show.lines.slice(0, show.lines.findIndex((l) => l.startsWith('diff --git'))).join('\n');
  assert.doesNotMatch(blanks, /\n\n\n/, 'no run of blank lines before the diff');

  assert.deepStrictEqual(m.fileTarget(id, `${root}/docs/노트.md`), { path: `${root}/docs/노트.md`, host: `${root}/docs/노트.md` });
  assert.strictEqual(m.fileTarget(id, `${root}/.git/config`), null);

  const outside = m.create({ cwd: os.tmpdir() === root ? '/' : fs.mkdtempSync(path.join(os.tmpdir(), 'plain-')) });
  assert.deepStrictEqual(await m.gitStatus(outside.id), { notRepo: true });
});
