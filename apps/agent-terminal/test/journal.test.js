'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../src/journal-logic');
const { Journal } = require('../src/journal');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const P = '/home/user/sample-app';

test('same requests are grouped by their words, a longer one goes with its start', () => {
  const p = (text, t = at(2026, 11, 23)) => ({ k: 'prompt', text, t, project: P, host: P });
  const g = L.groupRepeats([
    p('코드 검토 진행해줘'), p('코드  검토 진행해줘!'), p('코드 검토 진행해줘. 사소한 건 빼고'),
    p('다 진행해줘'), p('다 진행해줘'), p('응'), p('응'), p('/clear'), p('/clear'),
    p('한 번만 나온 요청'), p('x'.repeat(200)), p('x'.repeat(200)),
  ], [p('코드 검토 진행해줘', at(2026, 11, 21)), p('코드 검토 진행해줘', at(2026, 11, 22))]);
  assert.deepStrictEqual(g.map((x) => [x.text, x.count, x.days]), [['코드 검토 진행해줘', 3, 3], ['다 진행해줘', 2, 1]]);
  assert.strictEqual(g[0].project, P);
  assert.strictEqual(g[0].examples.length, 3);
});

test('Bash rules: a prefix per subcommand, the documented form', () => {
  assert.deepStrictEqual(L.bashRules('npm test -- --watch'), ['Bash(npm test *)']);
  assert.deepStrictEqual(L.bashRules('git status && git diff --stat'), ['Bash(git status *)', 'Bash(git diff *)']);
  assert.deepStrictEqual(L.bashRules('python3 scripts/check.py --all'), ['Bash(python3 scripts/check.py *)']);
  assert.deepStrictEqual(L.bashRules('ls -la src'), ['Bash(ls *)']);
  assert.deepStrictEqual(L.bashRules('cat file.txt'), ['Bash(cat *)']);
  assert.deepStrictEqual(L.bashRules('echo $(whoami)'), []); // not guessed
  // Claude Code's own suggestion wins, written the documented way.
  assert.deepStrictEqual(L.rulesFor('Bash', { command: 'npm test' }, [
    { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'npm run lint:*' }] },
    { type: 'setMode', mode: 'acceptEdits' },
  ]), ['Bash(npm run lint *)']);
  assert.deepStrictEqual(L.rulesFor('WebFetch', {}, [{ type: 'addRules', behavior: 'allow', rules: ['WebFetch(domain:example.com)'] }]), ['WebFetch(domain:example.com)']);
});

test('dangerous or open-ended rules are never offered', () => {
  for (const r of ['Bash(rm *)', 'Bash(git push *)', 'Bash(git reset *)', 'Bash(sudo apt *)', 'Bash(python3 *)', 'Bash(npm *)', 'Bash(curl *)', 'Bash(*)']) {
    assert.strictEqual(L.isDangerous(r), true, r);
  }
  for (const r of ['Bash(npm test *)', 'Bash(git status *)', 'Bash(python3 scripts/check.py *)', 'WebFetch(domain:example.com)']) {
    assert.strictEqual(L.isDangerous(r), false, r);
  }
});

test('approvals: only granted requests count, grouped by project and rule, marked when already added', () => {
  const perm = (id, command, project = P) => ({ k: 'perm', id, tool: 'Bash', input: { command }, rules: L.bashRules(command), project, host: project });
  const entries = [
    perm('a', 'npm test'), { k: 'grant', id: 'a' },
    perm('b', 'npm test -- x'), { k: 'grant', id: 'b' },
    perm('c', 'npm test'), // refused: no grant
    perm('d', 'git status'), { k: 'grant', id: 'd' },
    perm('e', 'rm -rf build'), { k: 'grant', id: 'e' },
    perm('f', 'npm test', '/home/user/other-app'), { k: 'grant', id: 'f' },
  ];
  const g = L.groupApprovals(entries, new Map([[P, new Set(['Bash(git status *)'])]]));
  assert.deepStrictEqual(g.map((x) => [x.project, x.rule, x.count, x.added]), [
    [P, 'Bash(npm test *)', 2, false],
    [P, 'Bash(git status *)', 1, true],
    ['/home/user/other-app', 'Bash(npm test *)', 1, false],
  ]);
  const s = L.summarize(entries, { project: P });
  assert.deepStrictEqual(s.projects, ['/home/user/other-app', P]);
  assert.strictEqual(s.counts.permissions, 5);
  assert.strictEqual(s.approvals.length, 2);
});

test('the skill prompt is one line without control characters', () => {
  const t = L.skillPrompt({ count: 7, days: 3, examples: [{ text: '코드 검토 진행해줘' }, { text: '코드 검토\n진행해줘\x1b[A' }] });
  assert.ok(!/[\x00-\x1f]/.test(t));
  assert.match(t, /^skill-creator 스킬로/);
  assert.match(t, /「코드 검토 진행해줘」/);
  assert.match(t, /7회, 3일/);
});

test('journal: records by day, pairs approvals, deletes a day or all, keeps 30 days, can be turned off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  let t = at(2026, 11, 23);
  const j = new Journal({ dir, now: () => t });
  const ctx = { sid: 's1', project: P, host: P, primary: true };
  j.onHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '코드 검토 진행해줘' }, ctx);
  j.onHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '팀원에게 온 메시지' }, { ...ctx, primary: false });
  const req = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' } };
  j.onHook({ hook_event_name: 'PermissionRequest', ...req }, ctx);
  j.onHook({ hook_event_name: 'PostToolUse', tool_use_id: 'u1', ...req }, ctx);
  j.onHook({ hook_event_name: 'PostToolUse', tool_use_id: 'u2', ...req }, ctx); // no request before it
  j.onInterrupt(ctx);
  const e = j.read('2026-11-23');
  assert.deepStrictEqual(e.map((x) => x.k), ['prompt', 'perm', 'grant', 'interrupt']);
  assert.deepStrictEqual(e[1].rules, ['Bash(npm test *)']);
  assert.strictEqual(e[2].id, e[1].id);

  // An old day is pruned when a new day starts.
  fs.writeFileSync(path.join(dir, '2026-09-01.jsonl'), '{"k":"prompt","text":"x"}\n');
  t = at(2026, 11, 24);
  j.onHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '다 진행해줘' }, ctx);
  assert.deepStrictEqual(j.days(), ['2026-11-24', '2026-11-23']);
  assert.strictEqual(j.otherPrompts('2026-11-24').length, 1);

  assert.deepStrictEqual(j.clear('2026-11-23'), ['2026-11-24']);
  j.setEnabled(false);
  j.onHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: '기록 안 됨' }, ctx);
  assert.strictEqual(j.read('2026-11-24').length, 1);
  assert.strictEqual(new Journal({ dir }).enabled, false); // remembered
  assert.deepStrictEqual(j.clear(), []);
  assert.deepStrictEqual(j.read('../config'), []); // not a day: nothing read
  fs.rmSync(dir, { recursive: true, force: true });
});

test('corrections: sentences that correct how Claude works, grouped, asked to go into .claude/ only', () => {
  const p = (text, t = at(2026, 11, 23)) => ({ k: 'prompt', text, t, project: P, host: P });
  assert.deepStrictEqual(L.correctionSentences('코드 검토 진행해줘. 사소한 건 개선 항목으로 두지마. 너무 자주 반복한다'),
    ['사소한 건 개선 항목으로 두지마.', '너무 자주 반복한다']);
  assert.deepStrictEqual(L.correctionSentences('한글 답변 언제까지 말 안 들을거야?'), ['한글 답변 언제까지 말 안 들을거야?']);
  assert.deepStrictEqual(L.correctionSentences('로그인 화면 버그 고쳐줘'), []);
  assert.deepStrictEqual(L.correctionSentences('지마켓 검색 결과 정리해줘'), []);
  assert.deepStrictEqual(L.correctionSentences(`하지 마 ${'x'.repeat(500)}`), []); // a long task, not a correction
  const g = L.groupCorrections(
    [p('정신차려 한글로 답해야지.'), p('정신차려, 한글로 답해야지!'), p('레포에서는 빼줘')],
    [p('정신차려 한글로 답해야지', at(2026, 11, 20))],
  );
  assert.deepStrictEqual(g.map((x) => [x.count, x.days, x.project]), [[2, 2, P]]);
  const q = L.claudeDirPrompt(g);
  assert.ok(!/[\x00-\x1f]/.test(q));
  assert.match(q, /\.claude\/ 폴더 안에/);
  assert.match(q, /CLAUDE\.md 와 \.claude\/ 밖의 파일은 고치지 마/);
  assert.match(q, /먼저 보여 주고 내 확인을 받아/);
  assert.strictEqual(L.summarize([p('항상 테스트부터 돌려줘')]).corrections.length, 1);
});
