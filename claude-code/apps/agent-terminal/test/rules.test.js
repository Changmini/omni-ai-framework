'use strict';

const test = require('node:test');
const assert = require('node:assert');
const RuleLogic = require('../src/renderer/rule-logic');
const { Rules, compile } = require('../src/rules');

const rule = (over) => ({
  id: 'r1', enabled: true, event: 'prompt', cond: { kind: 'none', value: '' }, terminals: null,
  action: { kind: 'context', text: '참고: {terminal} {branch}' }, freq: 'every', ...over,
});
const prompt = (text, sid = 's1') => ({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text, cwd: '/home/user/sample-app' });
const setup = (rules, extra = {}) => {
  const fired = [];
  const r = new Rules({ emit: (ch, p) => fired.push([ch, p]), meta: (id, sid) => (sid === 'other' ? null : { branch: 'feature/sample', cwd: '/x' }), now: () => 1000 });
  r.set({ rules, names: { 1: 'sample-app', 2: 'review' }, ...extra });
  return { r, fired };
};

test('rule logic: subject per event, conditions, variables', () => {
  assert.strictEqual(RuleLogic.subject(prompt('배포 해줘')), '배포 해줘');
  assert.strictEqual(RuleLogic.subject({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } }), 'Bash git push');
  assert.strictEqual(RuleLogic.subject({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/a.js' } }), 'Edit /a.js');
  assert.strictEqual(RuleLogic.subject({ hook_event_name: 'Stop', last_assistant_message: '끝' }), '끝');
  assert.strictEqual(RuleLogic.condHolds({ kind: 'text', value: 'PUSH' }, 'git push'), true);
  assert.strictEqual(RuleLogic.condHolds({ kind: 'regex', value: '^git (push|tag)' }, 'git tag v1'), true);
  assert.strictEqual(RuleLogic.condHolds({ kind: 'regex', value: '(' }, 'anything'), false); // invalid: never
  assert.strictEqual(RuleLogic.condHolds({ kind: 'none', value: '' }, ''), true);
  const v = RuleLogic.vars({ ...prompt('hi'), tool_input: { command: 'ls' } }, { terminal: 't', branch: 'b' });
  assert.strictEqual(RuleLogic.fillText('{terminal}/{branch}/{cwd}/{prompt}/{command}/{nope}', v), 't/b//home/user/sample-app/hi/ls/{nope}');
});

test('rule logic: an action runs only on the events it supports, in scope', () => {
  const ev = { hook_event_name: 'Stop', session_id: 's1' };
  assert.strictEqual(RuleLogic.fires(rule({ event: 'stop' }), ev, '1'), false); // text for Claude on a finished turn
  assert.strictEqual(RuleLogic.fires(rule({ event: 'stop', action: { kind: 'fill', target: '2', text: 'x' } }), ev, '1'), true);
  assert.strictEqual(RuleLogic.fires(rule({ terminals: ['2'] }), prompt('x'), '1'), false);
  assert.strictEqual(RuleLogic.fires(rule({ enabled: false }), prompt('x'), '1'), false);
  assert.strictEqual(RuleLogic.fires(rule({ action: { kind: 'block', text: '' } }), prompt('x'), '1'), false); // block: before a tool only
  assert.match(RuleLogic.describe({ ...rule(), scope: { kind: 'group', id: 'g' }, cond: { kind: 'text', value: '배포' } }, () => '백엔드'),
    /^프롬프트를 받을 때 · 내용에 「배포」 · 그룹 백엔드 → Claude 에게 글 붙이기$/);
  for (const t of RuleLogic.TEMPLATES) assert.ok(RuleLogic.ACTIONS[t.action.kind].events.includes(t.event), t.name);
});

test('rules: text for Claude, filled in, once per session or when it changes', () => {
  const { r, fired } = setup([rule(), rule({ id: 'r2', freq: 'once', action: { kind: 'context', text: '한 번' } }),
    rule({ id: 'r3', freq: 'changed', action: { kind: 'pipeline' } })], { pipeline: { 1: '노드 정보' } });
  assert.deepStrictEqual(r.reply('1', prompt('a')), { additionalContext: '참고: sample-app feature/sample\n\n한 번\n\n노드 정보' });
  assert.deepStrictEqual(r.reply('1', prompt('b')), { additionalContext: '참고: sample-app feature/sample' });
  assert.deepStrictEqual(r.reply('1', prompt('c', 's2')).additionalContext.split('\n\n').length, 3); // a new session never saw them
  r.onEvent('1', { hook_event_name: 'PostCompact', session_id: 's2' }); // its summary may have dropped them
  assert.strictEqual(r.reply('1', prompt('d', 's2')).additionalContext.split('\n\n').length, 3);
  r.set({ rules: [rule({ id: 'r3', freq: 'changed', action: { kind: 'pipeline' } })], pipeline: { 1: '바뀐 정보' } });
  assert.deepStrictEqual(r.reply('1', prompt('e', 's2')), { additionalContext: '바뀐 정보' });
  assert.strictEqual(r.reply('1', prompt('f', 's2')), null);
  assert.strictEqual(r.reply('2', prompt('g')), null); // no pipeline text for that terminal
  assert.strictEqual(r.reply('1', prompt('h', 'other')), null); // not the main session
  assert.ok(fired.every(([ch, p]) => ch === 'rules:fire' && p.source === '1'));
  assert.strictEqual(fired.length, 3 + 1 + 3 + 3 + 1);
});

test('rules: block wins over ask before a tool, with the reasons', () => {
  const pre = { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git push origin' } };
  const { r } = setup([
    rule({ id: 'a', event: 'pre', cond: { kind: 'text', value: 'git push' }, action: { kind: 'ask', text: '확인: {command}' } }),
    rule({ id: 'b', event: 'pre', cond: { kind: 'regex', value: 'rm -rf' }, action: { kind: 'block', text: '' } }),
  ]);
  assert.deepStrictEqual(r.reply('1', pre), { permissionDecision: 'ask', permissionDecisionReason: '확인: git push origin' });
  const both = { ...pre, tool_input: { command: 'git push && rm -rf x' } };
  assert.deepStrictEqual(r.reply('1', both), {
    permissionDecision: 'deny', permissionDecisionReason: '확인: git push && rm -rf x\n자동화 규칙이 이 실행을 막았습니다.',
  });
  assert.strictEqual(r.reply('1', { ...pre, tool_input: { command: 'ls' } }), null);
});

test('rules: page work goes out as fire messages; recent events are kept', () => {
  const stop = { hook_event_name: 'Stop', session_id: 's1', last_assistant_message: '구현 끝' };
  const { r, fired } = setup([
    rule({ id: 'f', event: 'stop', action: { kind: 'fill', target: '2', text: '{terminal} 끝남: {last_answer}', send: true } }),
    rule({ id: 'n', event: 'stop', action: { kind: 'fill', target: null, text: 'x' } }), // no such terminal open
    rule({ id: 'h', event: 'stop', action: { kind: 'highlight' } }),
  ]);
  assert.strictEqual(r.reply('1', stop), null);
  r.onEvent('1', stop);
  r.onEvent('1', { ...stop, agent_id: 'sub' }); // a subagent's: not the session's
  assert.deepStrictEqual(fired.map(([, p]) => p), [
    { ruleId: 'f', source: '1', kind: 'fill', target: '2', text: 'sample-app 끝남: 구현 끝', send: true },
    { ruleId: 'h', source: '1', kind: 'highlight' },
  ]);
  assert.deepStrictEqual(r.recentEvents().map((e) => [e.hook, e.subject, e.vars.terminal]), [['Stop', '구현 끝', 'sample-app']]);
});

test('rules: what the page sends is checked', () => {
  assert.strictEqual(compile({ event: 'nope', action: { kind: 'context' } }), null);
  assert.strictEqual(compile({ event: 'prompt', action: { kind: 'run-anything' } }), null);
  const c = compile({ id: 1, enabled: 'yes', event: 'pre', cond: { kind: 'eval', value: 'x' }, action: { kind: 'ask', send: 1 }, freq: 'often' });
  assert.deepStrictEqual(c, {
    id: '', enabled: false, event: 'pre', cond: { kind: 'none', value: 'x' }, terminals: null,
    action: { kind: 'ask', text: '', target: null, send: false }, freq: 'every',
  });
});
