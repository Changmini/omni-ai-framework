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

test('Esc: a terminal or text field keeps its key; otherwise the card, then the find bar, then the viewer', () => {
  const t = (cardOpen, viewerOpen, inField, findOpen = false, inFind = false) => escapeAction({ cardOpen, viewerOpen, inField, findOpen, inFind });
  const none = { hideCard: false, closeFind: false, closeViewer: false };
  assert.deepStrictEqual(t(true, false, true), { ...none, hideCard: true, consume: false });
  assert.deepStrictEqual(t(true, true, false), { ...none, hideCard: true, consume: true });
  assert.deepStrictEqual(t(false, true, false), { ...none, closeViewer: true, consume: true });
  assert.deepStrictEqual(t(false, true, true), { ...none, consume: false });
  assert.deepStrictEqual(t(false, false, false), { ...none, consume: false });
  // The find bar open: Esc in the text or in its box closes it, not the viewer.
  assert.deepStrictEqual(t(false, true, false, true), { ...none, closeFind: true, consume: true });
  assert.deepStrictEqual(t(false, true, true, true, true), { ...none, closeFind: true, consume: true });
  // The card open and focus in the find box: only the card goes.
  assert.deepStrictEqual(t(true, true, true, true, true), { ...none, hideCard: true, consume: true });
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

test('treeMarks: a changed submodule marks its folder; files deep in a new folder are new', () => {
  const { treeMarks } = require('../src/renderer/view-logic');
  const t = treeMarks([['vendor/lib', 'M'], ['out/', 'U']]);
  assert.strictEqual(t.dir('vendor/lib'), 'M', 'submodule folder');
  assert.strictEqual(t.dir('vendor'), 'M');
  assert.strictEqual(t.file('out/a/b/c.txt'), 'U');
  assert.strictEqual(t.dir('out/a'), 'U');
  assert.strictEqual(t.file('outside.txt'), null, 'a sibling with the same prefix is not inside');
});

test('treeMarks.own gives only the mark git gave the path itself', () => {
  const { treeMarks } = require('../src/renderer/view-logic');
  const t = treeMarks([['reports/', 'U'], ['src/a.py', 'M']]);
  assert.strictEqual(t.file('reports/run.log'), 'U');
  assert.strictEqual(t.own('reports/run.log'), null);
  assert.strictEqual(t.own('src/a.py'), 'M');
});

test('preview: what a new drawing does, where the preview goes, how wide', () => {
  const { previewOnChange, previewPlacement, previewWidth, historyLabel } = require('../src/renderer/view-logic');
  assert.strictEqual(previewOnChange({ open: true, userClosed: false, detached: false }), 'reload');
  assert.strictEqual(previewOnChange({ open: false, userClosed: false, detached: false }), 'open');
  assert.strictEqual(previewOnChange({ open: false, userClosed: true, detached: false }), 'badge');
  assert.strictEqual(previewOnChange({ open: true, userClosed: false, detached: true }), 'none');
  assert.strictEqual(previewPlacement(1200), 'split');
  assert.strictEqual(previewPlacement(600), 'tab');
  assert.strictEqual(previewWidth(0.5, 1200), 600);
  assert.strictEqual(previewWidth(0.9, 1200), 1200 - 360 - 6, 'the terminal keeps its minimum');
  assert.strictEqual(previewWidth(0.1, 1200), 320, 'the preview keeps its minimum');
  assert.strictEqual(previewWidth(NaN, 1000), 500);
  assert.strictEqual(historyLabel('2026-11-16_18-02-31.html', '2026-11-16'), '18:02:31');
  assert.strictEqual(historyLabel('2026-11-15_09-00-00-2.html', '2026-11-16'), '11-15 09:00:00');
  assert.strictEqual(historyLabel('x.html', '2026-11-16'), '');
});

test('a drawing that keeps leaving is shown again once, then left stopped', () => {
  const { previewRestore } = require('../src/renderer/view-logic');
  assert.strictEqual(previewRestore(0, 100000), 'restore');
  assert.strictEqual(previewRestore(100000, 101000), 'halt');
  assert.strictEqual(previewRestore(100000, 106000), 'restore');
});

test('textRanges marks every match of a content search in a line', () => {
  const { textRanges } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(textRanges('Hello hello HELLO', 'hello', true), [[0, 5], [6, 11], [12, 17]]);
  assert.deepStrictEqual(textRanges('Hello hello', 'Hello', false), [[0, 5]]);
  assert.deepStrictEqual(textRanges('사용자 생성 사용자', '사용자', true), [[0, 3], [7, 10]]);
  assert.deepStrictEqual(textRanges('abc', '', true), []);
});

test('hitView: no indent, and a far match brought into view', () => {
  const { hitView } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(hitView('    return user;', 'user', true), { text: 'return user;', ranges: [[7, 11]] });
  const far = `${'a'.repeat(80)} user`;
  const v = hitView(far, 'user', true);
  assert.ok(v.text.startsWith('…'));
  assert.strictEqual(v.text.slice(v.ranges[0][0], v.ranges[0][1]), 'user');
});

test('entersWsl: a shortcut line that opens a shell inside WSL', () => {
  const { entersWsl } = require('../src/renderer/view-logic');
  for (const l of ['wsl', 'wsl -d Ubuntu-24.04', 'WSL.exe -d Ubuntu ~', 'wsl --cd ~/x', '  wsl -u user -d Ubuntu  ']) assert.strictEqual(entersWsl(l), true, l);
  for (const l of ['& "C:\\Program Files\\WSL\\wsl.exe" -d Ubuntu-24.04', 'C:\\Windows\\System32\\wsl.exe -d Ubuntu-24.04', '"C:\\Windows\\System32\\wsl.exe" ~', '& wsl.exe --distribution=Ubuntu']) assert.strictEqual(entersWsl(l), true, l);
  for (const l of ['wsl ls', 'wsl -d Ubuntu -- ls', 'wsl --shutdown', 'cd ~/ai-gateway', 'echo wsl', 'mywsl -d x']) assert.strictEqual(entersWsl(l), false, l);
});

test('shellReady: a report, or output after the echo and then quiet; never during a silent start', () => {
  const { shellReady } = require('../src/renderer/view-logic');
  const sentAt = 10000;
  // WSL reported in (its first prompt).
  assert.strictEqual(shellReady({ reportAt: 14000, lastDataAt: 10050, sentAt, now: 14100 }), true);
  // Booting silently: only the echo of the line so far, however long.
  assert.strictEqual(shellReady({ reportAt: 9000, lastDataAt: 10050, sentAt, now: 18000 }), false);
  // No report possible (tmux from ~/.bashrc, NAT): its prompt came, then quiet.
  assert.strictEqual(shellReady({ lastDataAt: 14000, sentAt, now: 14500, prompt: true }), false, 'still drawing');
  assert.strictEqual(shellReady({ lastDataAt: 14000, sentAt, now: 14900, prompt: true }), true);
  // A warning of wsl.exe's own, WSL still starting: not a prompt, so a long quiet first.
  assert.strictEqual(shellReady({ lastDataAt: 11000, sentAt, now: 12000 }), false);
  assert.strictEqual(shellReady({ lastDataAt: 11000, sentAt, now: 15100 }), true, 'an unusual prompt still goes, later');
  // A new terminal (lateMs 0): any output, then quiet.
  assert.strictEqual(shellReady({ lastDataAt: 10200, sentAt, now: 11100, lateMs: 0, prompt: true }), true);
});

test('promptLike: a prompt, not a message', () => {
  const { promptLike } = require('../src/renderer/view-logic');
  for (const t of ['user@sample-host:~$ ', 'PS C:\\Users\\user> ', 'root@x:/# ', 'sample-app on main ❯ ', 'user@host ~ % ']) assert.strictEqual(promptLike(t), true, t);
  for (const t of ['wsl: A localhost proxy configuration was detected but not mirrored into WSL.', 'Welcome to Ubuntu 24.04', '']) assert.strictEqual(promptLike(t), false, t);
});

test('findAll: every match in the shown text, smart case, capped', () => {
  const { findAll } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(findAll('User user USER', 'user'), [[0, 4], [5, 9], [10, 14]]);
  assert.deepStrictEqual(findAll('User user USER', 'User'), [[0, 4]], 'a capital letter: case counts');
  assert.deepStrictEqual(findAll('사용자 생성 사용자', '사용자'), [[0, 3], [7, 10]]);
  assert.deepStrictEqual(findAll('aaaa', 'aa'), [[0, 2], [2, 4]], 'not overlapping');
  assert.strictEqual(findAll('x'.repeat(100), 'x', 10).length, 10);
  assert.deepStrictEqual(findAll('abc', ''), []);
});

test('promptInput: a prompt shortcut is one message', () => {
  const { promptInput } = require('../src/renderer/view-logic');
  assert.strictEqual(promptInput('코드 검토 진행해줘  \n', true), '코드 검토 진행해줘');
  assert.strictEqual(promptInput('첫 줄\r\n둘째 줄', true), '\x1b[200~첫 줄\r둘째 줄\x1b[201~');
  assert.strictEqual(promptInput('첫 줄\n\n  둘째 줄', false), '첫 줄 둘째 줄');
  assert.strictEqual(promptInput('a\x1b[201~\tb\x03', true), 'a[201~b'); // no key or paste-end escape gets through
});

test('promptBlock: a prompt goes only to a Claude ready for input', () => {
  const { promptBlock } = require('../src/renderer/view-logic');
  assert.strictEqual(promptBlock({ status: 'running', claude: { status: 'idle' } }), null);
  assert.strictEqual(promptBlock({ status: 'running', claude: { status: 'working' } }), null);
  assert.strictEqual(promptBlock({ status: 'running', claude: { status: 'waiting' } }), 'waiting'); // Enter would answer the dialog
  assert.strictEqual(promptBlock({ status: 'running', claude: { status: null } }), 'no-claude');
  assert.strictEqual(promptBlock({ status: 'running' }), 'no-claude');
  assert.strictEqual(promptBlock({ status: 'exited', claude: { status: 'idle' } }), 'no-claude');
});

test('terminal groups: navigation, new terminal, ungroup target, summary', () => {
  const { groupNav, newTerminalGroup, ungroupTarget, groupSummary } = require('../src/renderer/view-logic');
  const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const order = ['1', '2', '3', '4', '5'];
  const groupOf = { 1: 'a', 2: 'a', 3: 'b', 4: 'a', 5: 'b' };
  assert.deepStrictEqual(groupNav(order, groupOf, '3'), ['3', '5']); // Ctrl+1 = 3, Ctrl+2 = 5
  assert.deepStrictEqual(groupNav(order, groupOf, '1'), ['1', '2', '4']);
  assert.deepStrictEqual(groupNav(order, {}, '1'), order);
  assert.strictEqual(newTerminalGroup(groups, groupOf, '3'), 'b');
  assert.strictEqual(newTerminalGroup(groups, groupOf, null), 'a'); // nothing shown: the first group
  assert.strictEqual(newTerminalGroup(groups, { 9: 'gone' }, '9'), 'a');
  assert.strictEqual(newTerminalGroup([], {}, null), null); // a default group is made
  assert.strictEqual(ungroupTarget(groups, 'b'), 'a');
  assert.strictEqual(ungroupTarget(groups, 'a'), 'b');
  assert.strictEqual(ungroupTarget([{ id: 'a' }], 'a'), null);
  assert.deepStrictEqual(groupSummary(['waiting', 'working', 'idle', 'waiting']), { dots: ['waiting', 'working', 'idle', 'waiting'], waiting: 2 });
});
