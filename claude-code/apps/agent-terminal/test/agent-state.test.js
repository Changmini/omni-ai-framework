'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { emptyState, reduce, withTeam } = require('../src/agent-state');

const run = (...evs) => evs.reduce((s, e) => reduce(s, e, 1), emptyState());

test('prompt -> tool -> stop', () => {
  let s = run({ hook_event_name: 'UserPromptSubmit' });
  assert.strictEqual(s.status, 'working');
  s = reduce(s, { hook_event_name: 'PreToolUse', tool_name: 'Edit' });
  assert.deepStrictEqual([s.status, s.tool], ['working', 'Edit']);
  s = reduce(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  assert.strictEqual(s.tool, null);
  s = reduce(s, { hook_event_name: 'Stop' });
  assert.strictEqual(s.status, 'idle');
});

test('permission prompts mark the session as waiting until work resumes', () => {
  let s = run({ hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.deepStrictEqual([s.status, s.message], ['waiting', 'Claude needs your permission to use Bash']);
  s = reduce(s, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  assert.deepStrictEqual([s.status, s.message], ['working', null]);
  s = reduce(s, { hook_event_name: 'PermissionRequest', tool_name: 'Write' });
  assert.strictEqual(s.status, 'waiting');
});

test('subagent events update the subagent, not the main agent', () => {
  let s = run({ hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
  s = reduce(s, { hook_event_name: 'PreToolUse', tool_name: 'Grep', agent_id: 'a1', agent_type: 'Explore' });
  assert.deepStrictEqual(s.agents.a1, { type: 'Explore', name: null, status: 'working', tool: 'Grep' });
  assert.strictEqual(s.tool, null, 'main agent tool unchanged');
  s = reduce(s, { hook_event_name: 'SubagentStop', agent_id: 'a1' });
  assert.deepStrictEqual(s.agents, {});
});

test('API errors and session end', () => {
  let s = run({ hook_event_name: 'UserPromptSubmit' }, { hook_event_name: 'StopFailure', error: 'rate_limit' });
  assert.deepStrictEqual([s.status, s.message], ['error', 'API 오류: rate_limit']);
  s = reduce(s, { hook_event_name: 'SessionEnd', cwd: '/p' });
  assert.deepStrictEqual([s.status, s.cwd], [null, '/p']);
});

test('reduce does not mutate its input', () => {
  const s0 = run({ hook_event_name: 'SubagentStart', agent_id: 'a1' });
  const copy = JSON.stringify(s0);
  reduce(s0, { hook_event_name: 'SubagentStop', agent_id: 'a1' });
  assert.strictEqual(JSON.stringify(s0), copy);
});

test('withTeam lists teammates by name with live status when known', () => {
  let s = run({ hook_event_name: 'PreToolUse', tool_name: 'Read', agent_id: 'T1' }, { hook_event_name: 'TeammateIdle', teammate_name: 'reviewer' });
  const team = { name: 't', members: [
    { name: 'lead', agentId: 'L', agentType: 'team-lead' },
    { name: 'tester', agentId: 'T1' },
    { name: 'reviewer', agentId: 'R1' },
  ] };
  const v = withTeam(s, team);
  assert.deepStrictEqual(Object.keys(v.agents).sort(), ['R1', 'T1']);
  assert.deepStrictEqual([v.agents.T1.name, v.agents.T1.status, v.agents.T1.tool], ['tester', 'working', 'Read']);
  assert.strictEqual(v.agents.R1.status, 'idle');
});

test('teammates seen in hooks merge with the team config by name (real 2.1.318 ids)', () => {
  const s = run(
    { hook_event_name: 'SubagentStart', agent_id: 'aalpha-e4df144e1a900f86', agent_type: 'alpha' },
    { hook_event_name: 'PreToolUse', agent_id: 'aalpha-e4df144e1a900f86', agent_type: 'alpha', tool_name: 'SendMessage' },
  );
  const v = withTeam(s, { name: 'session-2dec611b', members: [
    { name: 'team-lead', agentId: 'team-lead@session-2dec611b', agentType: 'team-lead' },
    { name: 'alpha', agentId: 'alpha@session-2dec611b', agentType: 'general-purpose' },
  ] });
  assert.deepStrictEqual(Object.keys(v.agents), ['alpha@session-2dec611b']);
  assert.deepStrictEqual([v.agents['alpha@session-2dec611b'].status, v.agents['alpha@session-2dec611b'].tool], ['working', 'SendMessage']);
});

test('TeammateIdle after SubagentStop does not bring the teammate back', () => {
  const s = run(
    { hook_event_name: 'SubagentStart', agent_id: 'abeta-1', agent_type: 'beta' },
    { hook_event_name: 'SubagentStop', agent_id: 'abeta-1', agent_type: 'beta' },
    { hook_event_name: 'TeammateIdle', agent_id: 'abeta-1', teammate_name: 'beta' },
  );
  assert.deepStrictEqual(s.agents, {});
  assert.strictEqual(withTeam(s, null).agents, s.agents);
  assert.deepStrictEqual(s.teammates, { beta: { status: 'idle' } }, 'name still marked idle');
});

test('late events from a stopped subagent do not bring it back', () => {
  let s = run(
    { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' },
    { hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash' },
    { hook_event_name: 'SubagentStop', agent_id: 'a1' },
  );
  const after = reduce(s, { hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Bash' });
  assert.deepStrictEqual(after.agents, {});
  assert.strictEqual(after, s, 'state unchanged');
});

test('main Stop with no background tasks clears leftover agents', () => {
  const s = run(
    { hook_event_name: 'PreToolUse', agent_id: 'lost', tool_name: 'Bash' },
    { hook_event_name: 'SubagentStart', agent_id: 'bg', agent_type: 'worker' },
  );
  assert.strictEqual(Object.keys(s.agents).length, 2);
  assert.strictEqual(Object.keys(reduce(s, { hook_event_name: 'Stop', background_tasks: [{ id: 't', status: 'running' }] }).agents).length, 2);
  assert.deepStrictEqual(reduce(s, { hook_event_name: 'Stop', background_tasks: [] }).agents, {});
  assert.strictEqual(Object.keys(reduce(s, { hook_event_name: 'Stop' }).agents).length, 2, 'no field: keep');
});
