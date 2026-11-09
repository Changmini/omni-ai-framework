'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { diffKinds, diffStat, escapeAction, serial } = require('../src/renderer/view-logic');

test('diff kinds: headers only before the first hunk of each file', () => {
  const lines = [
    'diff --git a/q.sql b/q.sql', 'index 1111111..2222222 100644', '--- a/q.sql', '+++ b/q.sql',
    '@@ -1,3 +1,3 @@', '--- old note', '+++ new note', ' select 1;',
    'diff --git a/b.py b/b.py', 'new file mode 100644', '--- /dev/null', '+++ b/b.py', '@@ -0,0 +1 @@', '+x = 1',
  ];
  assert.deepStrictEqual(diffKinds(lines), [
    'meta', 'meta', 'meta', 'meta', 'hunk', 'del', 'add', 'ctx',
    'meta', 'meta', 'meta', 'meta', 'hunk', 'add',
  ]);
  assert.deepStrictEqual(diffStat(lines), { add: 2, del: 1 }, 'the removed "-- old note" counts');
});

test('diff kinds: commit view, edit pairs and merge (combined) diffs', () => {
  assert.deepStrictEqual(diffKinds(['commit abc', '', '    feat: x', '', '    - item', 'diff --git a/a b/a']), ['meta', 'ctx', 'ctx', 'ctx', 'ctx', 'meta']);
  assert.deepStrictEqual(diffKinds(['@@ 1번째 수정 @@', '-old', '+new', '---x']), ['hunk', 'del', 'add', 'del']);
  const merge = ['diff --cc a.txt', 'index 1,2..3', '--- a/a.txt', '+++ b/a.txt', '@@@ -1,1 -1,1 +1,2 @@@', '- one', ' +two', '++both', '  same'];
  assert.deepStrictEqual(diffKinds(merge), ['meta', 'meta', 'meta', 'meta', 'hunk', 'del', 'add', 'add', 'ctx']);
});

test('Esc: a terminal or text field keeps its key; otherwise the card, then the viewer', () => {
  const t = (cardOpen, viewerOpen, inField) => escapeAction({ cardOpen, viewerOpen, inField });
  assert.deepStrictEqual(t(true, false, true), { hideCard: true, closeViewer: false, consume: false });
  assert.deepStrictEqual(t(true, true, false), { hideCard: true, closeViewer: false, consume: true });
  assert.deepStrictEqual(t(false, true, false), { hideCard: false, closeViewer: true, consume: true });
  assert.deepStrictEqual(t(false, true, true), { hideCard: false, closeViewer: false, consume: false });
  assert.deepStrictEqual(t(false, false, false), { hideCard: false, closeViewer: false, consume: false });
});

test('serial: one run at a time, and one more after for calls meanwhile', async () => {
  let running = 0;
  let max = 0;
  let runs = 0;
  let release;
  const run = serial(async () => {
    runs++; running++; max = Math.max(max, running);
    if (runs === 1) await new Promise((r) => { release = r; });
    running--;
  });
  const first = run();
  run(); run(); run(); // three calls while the first runs
  assert.strictEqual(runs, 1);
  release();
  await first;
  assert.deepStrictEqual([runs, max], [2, 1]);
  await run();
  assert.strictEqual(runs, 3);
});

test('serial: a failing run does not block later ones', async () => {
  let n = 0;
  const run = serial(async () => { n++; if (n === 1) throw new Error('boom'); });
  await assert.rejects(run());
  await run();
  assert.strictEqual(n, 2);
});
