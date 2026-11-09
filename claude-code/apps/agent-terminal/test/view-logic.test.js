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

test('serial: a failing run is reported and still runs the one asked for meanwhile', async () => {
  let n = 0;
  const errors = [];
  let release;
  const run = serial(async () => {
    n++;
    if (n === 1) { await new Promise((r) => { release = r; }); throw new Error('boom'); }
  }, (e) => errors.push(e.message));
  const first = run();
  run(); // asked for while the first runs
  release();
  await first; // resolves: no unhandled rejection
  assert.deepStrictEqual([n, errors], [2, ['boom']]);
});

test('markdown blocks: front matter, headings, lists, code, quote, table, rule', () => {
  const { markdownBlocks } = require('../src/renderer/view-logic');
  const md = '---\nname: planning\ndescription: "Plans work"\n---\n# Title\n\nSome **bold** text\ncontinued.\n- one\n  - two\n1. first\n```bash\nnpm test\n# not a heading\n```\n> quoted\n| a | b |\n|---|---|\n| 1 | 2 |\n***';
  assert.deepStrictEqual(markdownBlocks(md), [
    { type: 'front', pairs: [['name', 'planning'], ['description', 'Plans work']] },
    { type: 'h', level: 1, text: 'Title' },
    { type: 'p', text: 'Some **bold** text continued.' },
    { type: 'list', ordered: false, items: [{ depth: 0, text: 'one' }, { depth: 1, text: 'two' }] },
    { type: 'list', ordered: true, items: [{ depth: 0, text: 'first' }] },
    { type: 'code', lang: 'bash', text: 'npm test\n# not a heading' },
    { type: 'quote', text: 'quoted' },
    { type: 'table', rows: [['a', 'b'], ['1', '2']] },
    { type: 'hr' },
  ]);
  assert.deepStrictEqual(markdownBlocks('no front\n---'), [{ type: 'p', text: 'no front' }, { type: 'hr' }]);
});

test('inline spans keep snake_case and turn markup into spans', () => {
  const { inlineSpans } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(inlineSpans('run `npm test`, **now**, *maybe* see [docs](https://example.com) in snake_case_name'), [
    { t: 'text', s: 'run ' }, { t: 'code', s: 'npm test' }, { t: 'text', s: ', ' }, { t: 'b', s: 'now' }, { t: 'text', s: ', ' },
    { t: 'i', s: 'maybe' }, { t: 'text', s: ' see ' }, { t: 'link', s: 'docs', href: 'https://example.com' }, { t: 'text', s: ' in snake_case_name' },
  ]);
});
