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
  // Just started: no hook yet, but the status line told its session.
  assert.strictEqual(promptBlock({ status: 'running', claude: { status: null, session: { id: 's1', name: null } } }), null);
  assert.strictEqual(promptBlock({ status: 'exited', claude: { status: null, session: { id: 's1', name: null } } }), 'no-claude');
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

test('pipelines: nodes in arrow order, loops included', () => {
  const { pipelineOrder } = require('../src/renderer/view-logic');
  const node = (id) => ({ id, name: id, x: 0, y: 0, prompt: '' });
  const p = { nodes: ['c', 'a', 'b', 'd'].map(node), edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };
  assert.deepStrictEqual(pipelineOrder(p), ['a', 'b', 'c', 'd']); // unlinked d keeps its place among sources
  // A loop (b -> a) still gives every node once, starting at the earliest.
  const q = { nodes: ['a', 'b', 'c'].map(node), edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'c' }] };
  assert.deepStrictEqual(pipelineOrder(q), ['a', 'b', 'c']);
  // Arrows to missing nodes and self-arrows are ignored.
  const r = { nodes: ['a', 'b'].map(node), edges: [{ from: 'a', to: 'a' }, { from: 'x', to: 'b' }] };
  assert.deepStrictEqual(pipelineOrder(r), ['a', 'b']);
  assert.deepStrictEqual(pipelineOrder({ nodes: [], edges: [] }), []);
});

test('pipelines: what the Claude of a node is told', () => {
  const { pipelineContext } = require('../src/renderer/view-logic');
  const node = (id, name, memo = '') => ({ id, name, x: 0, y: 0, memo });
  const p = {
    name: '앱 개발',
    nodes: [node('a', '조사', '요구 정리'), node('b', '화면', '로그인 화면'), node('c', '통합'), node('d', 'API'), node('e', '외딴')],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'b', to: 'c' }, { from: 'd', to: 'c' }, { from: 'b', to: 'b' }, { from: 'b', to: 'gone' }],
  };
  const sessions = { a: { claude: { id: 'id-a', name: 'research' } }, b: { claude: { id: 'id-b', name: null } }, c: { claude: null } };
  const text = pipelineContext(p, 'b', (id) => sessions[id] || null);
  assert.strictEqual(text, [
    '[Omni Agent Terminal] 사용자가 그린 파이프라인 「앱 개발」에서 이 세션은 「화면」 노드입니다. 세션 구성을 알려 주는 참고 정보이며 작업 지시가 아닙니다.',
    '- 이 노드 메모: 로그인 화면',
    '- 이전 노드: 「조사」 — 세션 「research」(id id-a) — 메모: 요구 정리',
    '- 다음 노드: 「통합」 — Claude 없음', // once, though two arrows; self and missing nodes left out
    '- 다른 Claude에게 일을 맡길 때: 이 블록과, 다른 Claude에게서 받은 [Omni Agent Terminal] 블록을 모두 고치거나 줄이지 말고 원문 그대로 함께 넘기세요.',
  ].join('\n'));
  // Two steps away (API -> 통합) is not part of 화면's text; an unbound node says so.
  assert.match(pipelineContext(p, 'c', () => null), /이전 노드: 「화면」 — 세션 없음 — 메모: 로그인 화면\n- 이전 노드: 「API」 — 세션 없음\n/);
  assert.match(pipelineContext(p, 'e', () => null), /화살표로 이어진 노드 없음\n- 다른 Claude에게 일을 맡길 때/);
  assert.strictEqual(pipelineContext(p, 'nope', () => null), '');
  // A long memo is cut.
  const long = { ...p, nodes: [node('a', '조사', 'x'.repeat(1100)), node('b', '화면')] };
  assert.match(pipelineContext(long, 'a', () => null), /메모: x{1000}…/);
});

test('pipelines: lines that reopen a saved Claude session', () => {
  const { resumeLines } = require('../src/renderer/view-logic');
  const id = '9dcfb3a3-3265-4bc8-a267-350314271fd4';
  assert.deepStrictEqual(resumeLines({ id, cwd: "/home/user/it's app" }, 'linux'), [`cd '/home/user/it'\\''s app'`, `claude --resume ${id}`]);
  assert.deepStrictEqual(resumeLines({ id, cwd: "C:\\work\\it's" }, 'win32'), [`cd 'C:\\work\\it''s'`, `claude --resume ${id}`]);
  assert.deepStrictEqual(resumeLines({ id, cwd: '/home/user/sample-app', wsl: 'Ubuntu-24.04' }, 'win32'), ['wsl -d Ubuntu-24.04', "cd '/home/user/sample-app'", `claude --resume ${id}`]);
  assert.deepStrictEqual(resumeLines({ id, cwd: '/x', wsl: 'odd name' }, 'win32')[0], 'wsl'); // default distro rather than a strange name
  assert.deepStrictEqual(resumeLines({ id }, 'linux'), [`claude --resume ${id}`]); // folder unknown
  // As its agent again: a resumed session does not keep the agent's instructions on its own.
  assert.deepStrictEqual(resumeLines({ id, cwd: '/x' }, 'linux', 'omni-pipeline:lead'), ["cd '/x'", `claude --resume ${id} --agent omni-pipeline:lead`]);
  assert.deepStrictEqual(resumeLines({ id }, 'linux', 'x; rm -rf ~'), [`claude --resume ${id}`]); // odd agent left out
  assert.deepStrictEqual(resumeLines({ id: 'x; rm -rf ~', cwd: '/x' }, 'linux'), []); // never typed
  assert.deepStrictEqual(resumeLines(null, 'linux'), []);
});

test('pipelines: the recommended pipeline (lead, implementer, reviewer)', () => {
  const { recommendedPipeline, pipelineOrder } = require('../src/renderer/view-logic');
  let n = 0;
  const p = recommendedPipeline(() => `r${n++}`);
  assert.strictEqual(p.name, '권장 개발 파이프라인');
  assert.deepStrictEqual(p.nodes.map((x) => x.name), ['팀장', '구현', '리뷰어']);
  const name = (id) => p.nodes.find((x) => x.id === id).name;
  assert.deepStrictEqual(p.edges.map((e) => `${name(e.from)}→${name(e.to)}`), ['팀장→구현', '구현→리뷰어', '팀장→리뷰어', '리뷰어→팀장']);
  assert.ok(p.nodes.every((x) => x.memo && x.memo.length <= 1000)); // sent to Claude whole
  assert.deepStrictEqual(pipelineOrder(p).map(name), ['팀장', '구현', '리뷰어']);
  assert.strictEqual(new Set([p.id, ...p.nodes.map((x) => x.id)]).size, 4);
  // One terminal: 구현 and 리뷰어 are subagents inside 팀장's session.
  assert.deepStrictEqual(p.nodes.map((x) => x.within ? name(x.within) : null), [null, '팀장', '팀장']);
});

test('pipelines: subagent nodes show the subagent of their type in the host session', () => {
  const { sameAgent, subagentState, pipelineContext, subagentsInRecommended, recommendedPipeline } = require('../src/renderer/view-logic');
  assert.ok(sameAgent('omni-pipeline:implementer', 'omni-pipeline:implementer'));
  assert.ok(sameAgent('implementer', 'omni-pipeline:implementer')); // with or without the plugin prefix
  assert.ok(!sameAgent('reviewer', 'omni-pipeline:implementer'));
  assert.ok(!sameAgent('', 'x') && !sameAgent('x', ''));
  const node = { agent: 'omni-pipeline:implementer' };
  assert.deepStrictEqual(subagentState(node, null), { state: 'rest', tool: null });
  assert.deepStrictEqual(subagentState(node, [{ type: 'Explore', status: 'working' }]), { state: 'rest', tool: null });
  assert.deepStrictEqual(subagentState(node, [{ type: 'omni-pipeline:implementer', status: 'working', tool: 'Edit' }]), { state: 'working', tool: 'Edit' });
  assert.deepStrictEqual(subagentState(node, [{ type: 'omni-pipeline:implementer', status: 'waiting', tool: 'Bash' }]).state, 'waiting');
  assert.deepStrictEqual(subagentState(node, [{ type: 'omni-pipeline:implementer', status: 'working', teammate: true }]).state, 'rest'); // a teammate is not a subagent
  // For Claude: a subagent node's place is its host session.
  let k = 0;
  const p = recommendedPipeline(() => `r${k++}`);
  assert.match(pipelineContext(p, p.nodes[0].id, () => ({ claude: { id: 's1', name: null } })), /다음 노드: 「구현」 — 「팀장」 세션 안의 서브에이전트/);
  // The recommended pipeline as first shipped (three terminals) becomes the
  // same, once; a session saved on 구현 stays on the node.
  const old = () => { const q = recommendedPipeline(() => `o${k++}`); for (const x of q.nodes) delete x.within; return q; };
  const a = old();
  assert.strictEqual(subagentsInRecommended(a), true);
  assert.deepStrictEqual(a.nodes.map((x) => Boolean(x.within)), [false, true, true]);
  assert.strictEqual(subagentsInRecommended(a), false);
  const b = old();
  b.nodes[1].claude = { id: 's2' };
  assert.strictEqual(subagentsInRecommended(b), true);
  assert.deepStrictEqual(b.nodes[1].claude, { id: 's2' });
  const c = old();
  c.name = '내 파이프라인';
  assert.strictEqual(subagentsInRecommended(c), false);
});

test('pipelines: lines that start a node Claude as its agent', () => {
  const { startLines, recommendedPipeline } = require('../src/renderer/view-logic');
  assert.deepStrictEqual(startLines({ cwd: '/home/user/sample-app' }, 'linux', 'omni-pipeline:lead'), ["cd '/home/user/sample-app'", 'claude --agent omni-pipeline:lead']);
  assert.deepStrictEqual(startLines({ cwd: '/home/user/sample-app', wsl: 'Ubuntu' }, 'win32', 'reviewer'), ['wsl -d Ubuntu', "cd '/home/user/sample-app'", 'claude --agent reviewer']);
  assert.deepStrictEqual(startLines({ cwd: 'C:\\work' }, 'win32', ''), ["cd 'C:\\work'", 'claude']); // no agent: plain claude
  assert.deepStrictEqual(startLines(null, 'linux', 'x; rm -rf ~'), ['claude']); // an odd name is never typed
  let n = 0;
  assert.deepStrictEqual(recommendedPipeline(() => `r${n++}`).nodes.map((x) => x.agent), ['omni-pipeline:lead', 'omni-pipeline:implementer', 'omni-pipeline:reviewer']);
});
