'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/allow-rules');

function fakeGit(ignoredCode) {
  const calls = [];
  const run = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'check-ignore') return { ok: ignoredCode === 0, code: ignoredCode, stdout: '' };
    if (args[0] === 'rev-parse') return { ok: true, code: 0, stdout: '.git/info/exclude\n' };
    return { ok: false, code: 128, stdout: '' };
  };
  return { run, calls };
}

test('adds only new rules, keeps other settings, excludes the file from git when not ignored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allow-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  const file = path.join(dir, '.claude', 'settings.local.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'x', permissions: { allow: ['Bash(git status *)'], deny: ['Bash(git push *)'] } }));
  const git = fakeGit(1);
  const req = { project: dir, host: dir, rules: ['Bash(git status *)', 'Bash(npm test *)', 'Bash(npm test *)'], target: {}, runGit: git.run };
  const pre = await A.previewAllow(req);
  assert.deepStrictEqual([pre.exists, pre.add, pre.ignored], [true, ['Bash(npm test *)'], false]);
  assert.strictEqual(fs.readFileSync(file, 'utf8').includes('npm test'), false); // a preview writes nothing
  const r = await A.addAllow(req);
  assert.deepStrictEqual([r.added, r.excluded], [1, true]);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(data, { model: 'x', permissions: { allow: ['Bash(git status *)', 'Bash(npm test *)'], deny: ['Bash(git push *)'] } });
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), `${A.EXCLUDE_LINE}\n`);
  await A.addAllow(req); // again: nothing doubled
  assert.strictEqual(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), `${A.EXCLUDE_LINE}\n`);
  assert.deepStrictEqual([...(await A.allowedIn(dir))], ['Bash(git status *)', 'Bash(npm test *)']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('creates the file when missing; leaves a broken one alone; no exclude when ignored or not a repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allow-'));
  const git = fakeGit(0);
  const r = await A.addAllow({ project: dir, host: dir, rules: ['Bash(npm test *)'], target: {}, runGit: git.run });
  assert.deepStrictEqual([r.added, r.excluded], [1, false]);
  assert.ok(!git.calls.some((c) => c.startsWith('rev-parse')));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')), { permissions: { allow: ['Bash(npm test *)'] } });

  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ broken');
  const bad = await A.addAllow({ project: dir, host: dir, rules: ['Bash(ls *)'], target: {}, runGit: fakeGit(128).run });
  assert.ok(bad.error);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'), '{ broken');
  fs.rmSync(dir, { recursive: true, force: true });
});
