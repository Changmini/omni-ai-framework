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
  // "---" under a line is a heading (setext); a leading "---" without keys is a rule.
  assert.deepStrictEqual(markdownBlocks('no front\n---'), [{ type: 'h', level: 2, text: 'no front' }]);
  assert.deepStrictEqual(markdownBlocks('---\n\nIntro\n\n---\nAfter'), [{ type: 'hr' }, { type: 'p', text: 'Intro' }, { type: 'hr' }, { type: 'p', text: 'After' }]);
});

test('inline spans keep snake_case and turn markup into spans', () => {
  const { inlineSpans } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(inlineSpans('run `npm test`, **now**, *maybe* see [docs](https://example.com) in snake_case_name'), [
    { t: 'text', s: 'run ' }, { t: 'code', s: 'npm test' }, { t: 'text', s: ', ' }, { t: 'b', s: 'now' }, { t: 'text', s: ', ' },
    { t: 'i', s: 'maybe' }, { t: 'text', s: ' see ' }, { t: 'link', s: 'docs', href: 'https://example.com' }, { t: 'text', s: ' in snake_case_name' },
  ]);
});

test('front matter: block values and lists; indented code; single-dash tables', () => {
  const { markdownBlocks, frontMatter } = require('../src/renderer/view-logic');
  const md = '---\nname: reviewer\ndescription: >-\n  Reviews diffs\n  for bugs.\ntools:\n  - Read\n  - Grep\nnotes: |\n  line one\n  line two\n---\nTitle\n=====\n\n    code here\n    more\n\n| a | b |\n|-|-|\n| 1 | 2 |';
  assert.deepStrictEqual(markdownBlocks(md), [
    { type: 'front', pairs: [['name', 'reviewer'], ['description', 'Reviews diffs for bugs.'], ['tools', 'Read, Grep'], ['notes', 'line one\nline two']] },
    { type: 'h', level: 1, text: 'Title' },
    { type: 'code', lang: '', text: 'code here\nmore' },
    { type: 'table', rows: [['a', 'b'], ['1', '2']] },
  ]);
  assert.strictEqual(frontMatter(['---', 'just text', '---']), null);
  // The config list reads descriptions the same way.
  assert.deepStrictEqual(require('../src/claude-config').frontMatter('---\nname: x\ndescription: >-\n  multi\n  line\n---\n'), { name: 'x', description: 'multi line' });
});

test('relativeInside keeps a relative link in the folder of the file shown', () => {
  const { relativeInside } = require('../src/renderer/view-logic');
  assert.strictEqual(relativeInside('reference.md'), 'reference.md');
  assert.strictEqual(relativeInside('./docs/a%20b.md#part'), 'docs/a b.md');
  assert.strictEqual(relativeInside('docs/../ref.md'), 'ref.md');
  assert.strictEqual(relativeInside('docs\\ref.md'), 'docs/ref.md');
  assert.strictEqual(relativeInside('../../notes.md'), null);
  assert.strictEqual(relativeInside('docs/../../x.md'), null);
  assert.strictEqual(relativeInside('%E0%A4%A'), null, 'bad escapes');
  assert.strictEqual(relativeInside('#top'), null);
});

test('searchFiles: every term in the path, names first, marks in the name', () => {
  const { searchFiles } = require('../src/renderer/view-logic');
  const files = ['src/app/main.js', 'docs/main-notes.md', 'README.md', 'src/maintain/x.txt', 'test/test_main.py'];
  assert.deepStrictEqual(searchFiles(files, 'MAIN', 10).map((r) => r.path), ['src/app/main.js', 'docs/main-notes.md', 'test/test_main.py', 'src/maintain/x.txt']);
  const [first] = searchFiles(files, 'test main', 10);
  assert.deepStrictEqual(first, { path: 'test/test_main.py', dir: 'test/', name: 'test_main.py', marks: [[0, 4], [5, 9]] });
  assert.deepStrictEqual(searchFiles(files, '  ', 10), []);
  assert.strictEqual(searchFiles(files, 'm', 2).length, 2);
});

test('statusMark and treeMarks color changes like other editors', () => {
  const { statusMark, treeMarks } = require('../src/renderer/view-logic');
  const marks = ['M ', ' M', 'A ', 'AM', 'R ', '??', 'UU', 'AA', 'D ', ' D', 'MD', '  '].map((xy) => statusMark(xy[0], xy[1]));
  assert.deepStrictEqual(marks, ['M', 'M', 'A', 'A', 'R', 'U', 'C', 'C', null, null, null, null]);
  const t = treeMarks([['src/a.py', 'M'], ['src/deep/b.py', 'A'], ['reports/', 'U'], ['x.md', 'C'], ['gone.txt', null]]);
  assert.deepStrictEqual(['src/a.py', 'src/deep/b.py', 'reports/r1.md', 'x.md', 'src/z.py', 'gone.txt'].map((p) => t.file(p)), ['M', 'A', 'U', 'C', null, null]);
  assert.deepStrictEqual(['src', 'src/deep', 'reports', 'reports/sub', 'docs'].map((p) => t.dir(p)), ['M', 'A', 'U', 'U', null]);
});
