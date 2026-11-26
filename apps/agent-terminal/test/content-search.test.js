'use strict';
// The file tab's content search: git grep in a repository, the folder read
// without git; literal text, smart case, limits.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cs = require('../src/content-search');
const { SessionManager } = require('../src/sessions');

test('checkQuery, smart case and long lines', () => {
  assert.strictEqual(cs.checkQuery('a'), null);
  assert.strictEqual(cs.checkQuery('ab\ncd'), null);
  assert.strictEqual(cs.checkQuery('사용'), '사용');
  assert.strictEqual(cs.ignoreCaseFor('hello'), true);
  assert.strictEqual(cs.ignoreCaseFor('Hello'), false);
  const long = `${'x'.repeat(500)}needle${'y'.repeat(500)}`;
  const clipped = cs.clipLine(long, 'needle', true);
  assert.ok(clipped.length <= cs.LINE_MAX + 2 && clipped.includes('needle') && clipped.startsWith('…') && clipped.endsWith('…'));
  assert.deepStrictEqual(cs.parseGrepLine('src/a b.js\u000012\u0000const x = 1;'), ['src/a b.js', 12, 'const x = 1;']);
  assert.strictEqual(cs.parseGrepLine('broken'), null);
});

test('Hits: at most PER_FILE_MAX lines shown per file, HITS_MAX in all', () => {
  const h = new cs.Hits('x', true);
  for (let k = 1; k <= cs.PER_FILE_MAX + 5; k++) h.add('a.txt', k, 'x');
  assert.deepStrictEqual([h.files[0].hits.length, h.files[0].more, h.count, h.total], [cs.PER_FILE_MAX, 5, cs.PER_FILE_MAX, cs.PER_FILE_MAX + 5]);
  for (let k = 1; k <= cs.HITS_MAX; k++) if (!h.add(`f${k}.txt`, 1, 'x')) break;
  assert.strictEqual(h.result().truncated, true);
  assert.strictEqual(h.result().count, cs.HITS_MAX);
});

function project(git) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omni-grep-')));
  const root = path.join(base, 'sample-app');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'users.js'), 'function createUser() {}\n// TODO: 사용자 검증\nconst User = 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# sample\ncreateUser 설명\n');
  fs.mkdirSync(path.join(root, 'private', '.history'), { recursive: true });
  fs.writeFileSync(path.join(root, 'private', '.history', '2026-11-16_09-00-00.html'), '<p>createUser</p>\n');
  fs.writeFileSync(path.join(root, 'logo.bin'), Buffer.from([0, 1, 2, 99, 114, 101, 97, 116, 101, 85, 115, 101, 114]));
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    fs.mkdirSync(path.join(root, 'build'));
    fs.writeFileSync(path.join(root, 'build', 'out.js'), 'createUser()\n');
    execFileSync('git', ['add', 'src', '.gitignore'], { cwd: root });
    fs.writeFileSync(path.join(root, 'new.txt'), 'createuser in an untracked file\n');
  }
  return root;
}

async function manager(root) {
  const m = new SessionManager({ spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0 });
  const { id } = m.create({ cwd: root });
  await m.fileTree(id, '');
  return { m, id };
}

for (const git of [true, false]) {
  test(`searchText ${git ? 'with git grep' : 'without git'}: lines by file, binary skipped${git ? ', ignored files left out' : ''}`, async () => {
    const root = project(git);
    const { m, id } = await manager(root);
    let r = await m.searchText(id, 'createuser');
    const found = Object.fromEntries(r.files.map((f) => [f.path, f.hits.map((x) => x.line)]));
    assert.deepStrictEqual(found['src/users.js'], [1]);
    assert.deepStrictEqual(found['README.md'], [2]);
    assert.ok(!found['logo.bin'], 'binary skipped');
    assert.ok(!Object.keys(found).some((f) => f.startsWith('private/.history/')), "the preview's earlier drawings left out");
    if (git) {
      assert.deepStrictEqual(found['new.txt'], [1], 'untracked files too');
      assert.ok(!found['build/out.js'], 'ignored files left out');
    }
    assert.strictEqual(r.ignoreCase, true);
    r = await m.searchText(id, 'User');
    const cased = Object.fromEntries(r.files.map((f) => [f.path, f.hits.map((x) => x.line)]));
    assert.deepStrictEqual(cased, { 'README.md': [2], 'src/users.js': [1, 3] }, 'a capital letter: case counts (not new.txt\'s "createuser")');
    assert.strictEqual(r.ignoreCase, false);
    r = await m.searchText(id, '사용자');
    assert.deepStrictEqual(r.files.map((f) => [f.path, f.hits[0].line, f.hits[0].text]), [['src/users.js', 2, '// TODO: 사용자 검증']]);
    r = await m.searchText(id, 'no such words');
    assert.deepStrictEqual([r.files, r.count], [[], 0]);
    assert.match((await m.searchText(id, 'x')).error, /2자/);
  });
}

test('a newer search stops the one running', async () => {
  const root = project(true);
  const { m, id } = await manager(root);
  const [a, b] = await Promise.all([m.searchText(id, 'createuser'), m.searchText(id, 'createuser')]);
  assert.deepStrictEqual(a, { stale: true });
  assert.ok(b.files.length > 0);
});

test('one file full of matches leaves room for the others', () => {
  const h = new cs.Hits('x', true);
  for (let k = 1; k <= 5000; k++) assert.ok(h.add('reports/run.log', k, 'x'));
  assert.ok(h.add('src/a.js', 1, 'x'), 'still searching');
  const r = h.result();
  assert.deepStrictEqual(r.files.map((f) => [f.path, f.hits.length, f.more]), [['reports/run.log', cs.PER_FILE_MAX, 5000 - cs.PER_FILE_MAX], ['src/a.js', 1, 0]]);
  assert.strictEqual(r.truncated, false);
  const big = new cs.Hits('x', true);
  let k = 0;
  while (big.add('huge.log', ++k, 'x'));
  assert.strictEqual(big.total, cs.SEEN_MAX, 'stops after SEEN_MAX lines found');
  assert.strictEqual(big.result().truncated, true);
});

test('a too long query says so', async () => {
  const root = project(true);
  const { m, id } = await manager(root);
  assert.match((await m.searchText(id, 'y'.repeat(cs.QUERY_MAX + 1))).error, /200자 이하/);
});

test('streamGit: an abort stops git at once, even while it prints nothing', async () => {
  const { spawn } = require('node:child_process');
  const { streamGit } = require('../src/git-view');
  const ac = new AbortController();
  const started = Date.now();
  const p = streamGit(['grep'], { cwd: '.', spawnFn: () => spawn('sleep', ['30']), signal: ac.signal, sep: 10 }, () => true);
  setTimeout(() => ac.abort(), 100);
  const r = await p;
  assert.ok(Date.now() - started < 5000, 'not left running');
  assert.strictEqual(r.stopped, true);
});
