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
  await gv.runGit(['status'], { cwd: 'C:/Users/user/sample-app', platform: 'win32', exec }); // a Windows folder: Windows git
  const base = ['--no-optional-locks', '-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', '/home/user/sample-app', 'status'];
  const winBase = base.map((a) => (a === '/home/user/sample-app' ? 'C:/Users/user/sample-app' : a));
  assert.deepStrictEqual(calls, [['wsl.exe', ['-d', 'Ubuntu', '-e', 'git', ...base]], ['git', base], ['git', winBase]]);
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
  g('add', '.'); g('commit', '-qm', 'init', '-m', '- first item\n+ second item');
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
  // A new folder is one entry; its files come on demand and may then be read.
  assert.strictEqual(by['docs/'].index, '?');
  assert.strictEqual(m.fileTarget(id, `${root}/docs/노트.md`), null, 'not listed yet');
  assert.deepStrictEqual(await m.gitUntracked(id, 'docs/'), { files: ['docs/노트.md'], total: 1 });
  assert.match((await m.gitUntracked(id, 'a.py')).error, /목록에 없는 폴더/);
  assert.deepStrictEqual(st.commits.map((c) => c.subject), ['init']);

  // A rename is diffed with its old path: not shown as a whole new file.
  const ren = await m.gitDiff(id, 'new.py');
  assert.ok(ren.lines.some((l) => l === 'rename from old.py'), ren.lines.join('\n'));
  assert.ok(!ren.lines.some((l) => l === 'new file mode 100644'));
  const d = await m.gitDiff(id, 'a.py');
  // Copy: diffed with -C against its original.
  fs.writeFileSync(path.join(root, 'tpl.py'), 'template = 1\n'.repeat(20)); g('add', 'tpl.py'); g('commit', '-qm', 'tpl');
  fs.copyFileSync(path.join(root, 'tpl.py'), path.join(root, 'tpl_copy.py'));
  g('add', 'tpl_copy.py');
  // (status lists a copy as 'C' only with copy detection on; the entry is set here)
  m.sessions.get(id).git.orig.set('tpl_copy.py', { orig: 'tpl.py', copy: true });
  m.sessions.get(id).git.files.add('tpl_copy.py');
  const cp = await m.gitDiff(id, 'tpl_copy.py');
  assert.ok(cp.lines.includes('copy from tpl.py'), cp.lines.join('\n'));
  assert.ok(d.lines.includes('-two') && d.lines.includes('+TWO') && d.lines.includes('+three'));
  assert.match((await m.gitDiff(id, 'not-listed.py')).error, /목록에 없는/);
  const show = await m.gitShow(id, st.commits[0].hash);
  assert.ok(show.lines.some((l) => l.startsWith('diff --git a/a.py')));
  // Body lines are indented, so "- item" never reads as a removed line.
  assert.ok(show.lines.includes('    - first item') && show.lines.includes('    + second item'), show.lines.join('\n'));
  const blanks = show.lines.slice(0, show.lines.findIndex((l) => l.startsWith('diff --git'))).join('\n');
  assert.doesNotMatch(blanks, /\n\n\n/, 'no run of blank lines before the diff');

  assert.deepStrictEqual(m.fileTarget(id, `${root}/docs/노트.md`), { path: `${root}/docs/노트.md`, host: `${root}/docs/노트.md` });
  assert.strictEqual(m.fileTarget(id, `${root}/.git/config`), null);

  const outside = m.create({ cwd: os.tmpdir() === root ? '/' : fs.mkdtempSync(path.join(os.tmpdir(), 'plain-')) });
  assert.deepStrictEqual(await m.gitStatus(outside.id), { notRepo: true });
});

test('only "not a git repository" is shown as such; other failures show their reason', async () => {
  const fail = (stderr) => async () => ({ ok: false, code: 128, stdout: '', stderr });
  assert.deepStrictEqual(await gv.gitStatus({ cwd: '/x' }, fail('fatal: not a git repository (or any of the parent directories): .git')), { notRepo: true });
  assert.deepStrictEqual(await gv.gitStatus({ cwd: '/x' }, fail("fatal: detected dubious ownership in repository at '//wsl.localhost/Ubuntu/home/user/sample-app'\nTo add an exception...")),
    { error: "fatal: detected dubious ownership in repository at '//wsl.localhost/Ubuntu/home/user/sample-app'" });
  assert.deepStrictEqual(await gv.gitStatus({ cwd: '/x' }, fail('')), { error: 'git을 실행하지 못했습니다' });
});

test('wsl.exe messages (UTF-16) are decoded', async () => {
  const msg = Buffer.from('There is no distribution with the supplied name.\r\n', 'utf16le');
  const r = await gv.runGit(['status'], { cwd: '/x', distro: 'Gone', platform: 'win32',
    exec: (f, a, o, cb) => cb(Object.assign(new Error('exit 1'), { code: 1 }), msg, Buffer.alloc(0)) });
  assert.strictEqual(r.stderr.trim(), 'There is no distribution with the supplied name.');
});

test('a long list of changes is cut at MAX_FILES and counted', async () => {
  const n = gv.MAX_FILES + 30;
  const status = ['## main', ...Array.from({ length: n }, (_, k) => `?? build/f${k}.o`)].join('\0');
  const run = async (args) => ({ ok: true, stdout: args[0] === 'rev-parse' ? '/home/user/sample-app\n' : args[0] === 'status' ? status : '', stderr: '' });
  const r = await gv.gitStatus({ cwd: '/home/user/sample-app' }, run);
  assert.deepStrictEqual([r.files.length, r.total], [gv.MAX_FILES, n]);
});

test('only the latest of overlapping status reads is kept for the viewer', async () => {
  const { SessionManager: SM } = require('../src/sessions');
  const gates = [];
  const runner = (args) => new Promise((resolve) => {
    if (args.includes('rev-parse')) { resolve({ ok: true, stdout: '/home/user/sample-app\n', stderr: '' }); return; }
    if (args.includes('status')) { gates.push(resolve); return; }
    resolve({ ok: true, stdout: '', stderr: '' });
  });
  const m = new SM({ spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [], env: {} }, pollMs: 0, gitRunner: runner });
  const { id } = m.create({ cwd: '/home/user/sample-app' });
  const older = m.gitStatus(id);
  const newer = m.gitStatus(id);
  await new Promise((r) => setImmediate(r));
  gates[1]({ ok: true, stdout: '## main\0 M new.py\0', stderr: '' }); // the newer read finishes first
  await newer;
  gates[0]({ ok: true, stdout: '## main\0 M old.py\0', stderr: '' });
  await older;
  assert.ok(m.fileTarget(id, '/home/user/sample-app/new.py'));
  assert.strictEqual(m.fileTarget(id, '/home/user/sample-app/old.py'), null);
});

test('the root found last time is reused for the same folder, and checked again when stale', async () => {
  const calls = [];
  let rootOk = true;
  const runner = async (args, t) => {
    calls.push([args[0], t.cwd]);
    if (args[0] === 'rev-parse') return { ok: true, stdout: '/home/user/sample-app\n', stderr: '' };
    if (args[0] === 'status') return rootOk ? { ok: true, stdout: '## main\0', stderr: '' } : { ok: false, stdout: '', stderr: 'fatal: cannot change to' };
    return { ok: true, stdout: '', stderr: '' };
  };
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [], env: {} }, pollMs: 0, gitRunner: runner });
  const { id } = m.create({ cwd: '/home/user/sample-app/src' });
  await m.gitStatus(id);
  await m.gitStatus(id, false);
  assert.strictEqual(calls.filter(([c]) => c === 'rev-parse').length, 1, 'a quick (not fresh) read skipped rev-parse');
  await m.gitStatus(id);
  assert.strictEqual(calls.filter(([c]) => c === 'rev-parse').length, 2, 'a fresh read finds the root again');
  calls.length = 0;
  assert.ok(calls.filter(([c]) => c === 'status').every(([, cwd]) => cwd === '/home/user/sample-app'));
  rootOk = false;
  const r = await m.gitStatus(id, false);
  assert.match(r.error, /cannot change/);
  assert.strictEqual(calls.filter(([c]) => c === 'rev-parse').length, 1, 'stale root: found again');
  m.setCwd(id, '/home/user/other');
  rootOk = true;
  await m.gitStatus(id, false);
  assert.strictEqual(calls.filter(([c]) => c === 'rev-parse').length, 2, 'another folder: not reused');
});

test('rootDir: filesystem and drive roots', () => {
  assert.deepStrictEqual([gv.rootDir(''), gv.rootDir('C:'), gv.rootDir('/home/user/sample-app')], ['/', 'C:/', '/home/user/sample-app']);
});
