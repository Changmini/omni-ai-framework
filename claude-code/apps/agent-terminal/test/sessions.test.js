'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SessionManager } = require('../src/sessions');

function fakePty() {
  const pty = { written: [], killed: false, size: null };
  pty.onData = (fn) => { pty.emitData = fn; };
  pty.onExit = (fn) => { pty.emitExit = fn; };
  pty.write = (d) => pty.written.push(d);
  pty.resize = (c, r) => { pty.size = [c, r]; };
  pty.kill = () => { pty.killed = true; };
  return pty;
}

function setup() {
  const events = [];
  const ptys = [];
  const m = new SessionManager({
    spawn: (file, args, opts) => { const p = fakePty(); p.spawnArgs = { file, args, opts }; ptys.push(p); return p; },
    emit: (ch, payload) => events.push([ch, payload]),
    shell: { file: 'sh', args: [], env: { SHELL_VAR: '1' } },
    extraEnv: { OMNI_CLAUDE_SETTINGS: '/x.json' },
    gitBranch: (d) => (d === '/repo' ? 'main' : null),
    readTeam: () => ({ name: 'session-abcdef12', members: [{ name: 'lead', agentId: 'L', agentType: 'team-lead' }, { name: 'tester', agentId: 'T1', agentType: null }] }),
    readTasks: () => ({ total: 3, done: 1, inProgress: [{ subject: 'write tests', owner: 'tester' }] }),
    pollMs: 0,
  });
  return { m, events, ptys };
}

test('create starts the shell in cwd and types the launch command', () => {
  const { m, ptys } = setup();
  const info = m.create({ name: ' api ', cwd: '/tmp', command: 'claude' });
  assert.deepStrictEqual([info.id, info.name, info.cwd], ['1', 'api', '/tmp']);
  assert.strictEqual(ptys[0].spawnArgs.opts.cwd, '/tmp');
  assert.deepStrictEqual(ptys[0].written, ['claude\r']);
});

test('sendLine writes text then Enter separately', () => {
  const { m, ptys } = setup();
  const { id } = m.create({ command: '' });
  m.sendLine(id, '/compact');
  assert.deepStrictEqual(ptys[0].written, ['/compact', '\r']);
});

test('output is forwarded and errors change status until next input', () => {
  const { m, events, ptys } = setup();
  const { id } = m.create({ command: '' });
  ptys[0].emitData('Error: Port 3000 is already in use\n');
  assert.deepStrictEqual(events.find(([c]) => c === 'session:data')[1], { id, data: 'Error: Port 3000 is already in use\n' });
  m.pollStatus();
  assert.strictEqual(events.at(-1)[1].status, 'error');
  m.write(id, '\r');
  m.pollStatus();
  assert.notStrictEqual(events.at(-1)[1].status, 'error');
});

test('exit and kill', () => {
  const { m, events, ptys } = setup();
  const a = m.create({ command: '' });
  const b = m.create({ command: '' });
  ptys[0].emitExit({ exitCode: 0 });
  assert.strictEqual(m.list().find((s) => s.id === a.id).status, 'exited');
  assert.strictEqual(m.write(a.id, 'x'), false, 'no writes after exit');
  m.kill(b.id);
  assert.ok(ptys[1].killed);
  assert.ok(events.some(([c, p]) => c === 'session:removed' && p.id === b.id));
  assert.strictEqual(m.list().length, 1);
});

test('each terminal gets its id and the hook settings in its env', () => {
  const { m, ptys } = setup();
  m.create({});
  m.create({});
  const env = ptys[1].spawnArgs.opts.env;
  assert.strictEqual(env.OMNI_TERMINAL_ID, '2');
  assert.strictEqual(env.OMNI_CLAUDE_SETTINGS, '/x.json');
  assert.strictEqual(env.SHELL_VAR, '1');
});

test('hook events drive the claude view, team and tasks', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'abcdef1234', cwd: '/repo' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  let view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual([view.status, view.tool], ['working', 'Bash']);
  assert.deepStrictEqual(events.find(([c]) => c === 'session:meta')[1], { id, cwd: '/repo', branch: 'main' });

  m.onHookEvent(id, { hook_event_name: 'TaskCreated', task_id: '1', task_subject: 'x' });
  view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.strictEqual(view.team, 'session-abcdef12');
  assert.deepStrictEqual(view.agents.map((a) => [a.name, a.teammate]), [['tester', true]]);
  assert.strictEqual(view.tasks.done, 1);

  m.onHookEvent(id, { hook_event_name: 'SessionEnd' });
  view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual([view.status, view.team, view.agents.length], [null, null, 0]);
});

test('hook events for unknown terminals are ignored', () => {
  const { m, events } = setup();
  m.onHookEvent('99', { hook_event_name: 'Stop' });
  assert.strictEqual(events.length, 0);
});

test('rename sets a custom name; empty goes back to the folder name', () => {
  const { m, events } = setup();
  const { id } = m.create({ cwd: '/repo' });
  assert.strictEqual(m.rename(id, '  백엔드 API  '), true);
  assert.strictEqual(m.list()[0].name, '백엔드 API');
  assert.deepStrictEqual(events.at(-1), ['session:meta', { id, name: '백엔드 API' }]);
  m.rename(id, '   ');
  assert.strictEqual(m.list()[0].name, null);
  assert.strictEqual(m.rename('99', 'x'), false);
  m.rename(id, 'x'.repeat(200));
  assert.strictEqual(m.list()[0].name.length, 80);
});

test('reorder changes the listed order and ignores unknown ids', () => {
  const { m } = setup();
  const ids = [m.create({}).id, m.create({}).id, m.create({}).id];
  assert.strictEqual(m.reorder([ids[2], 'nope', ids[0]]), true);
  assert.deepStrictEqual(m.list().map((s) => s.id), [ids[2], ids[0], ids[1]]);
  assert.strictEqual(m.reorder('x'), false);
  m.kill(ids[0]);
  assert.deepStrictEqual(m.list().map((s) => s.id), [ids[2], ids[1]]);
});

test('tmux split-pane team (real 2.1.318 events): lead keeps the LED, teammates listed, cleared at the end', () => {
  const fixture = require('./fixtures/tmux-split-team-2.1.318.json');
  // No team file here: in split-pane mode the config listed only the lead.
  const events = [];
  const m = new SessionManager({ spawn: () => fakePty(), emit: (c, p) => events.push([c, p]), shell: { file: 'sh', args: [] }, pollMs: 0 });
  const { id } = m.create({});
  const views = [];
  for (const { pane, ev } of fixture) {
    m.onHookEvent(id, ev, { pane, title: '' });
    views.push(events.filter(([c]) => c === 'session:agent').at(-1)[1].claude);
  }
  // While teammates worked, the lead's status came only from the lead's pane.
  const mid = views[fixture.findIndex((f) => f.pane === '%2' && f.ev.hook_event_name === 'TeammateIdle')];
  assert.deepStrictEqual(mid.agents.filter((a) => a.teammate).map((a) => [a.name, a.status]).sort(), [['alpha', 'idle'], ['beta', 'idle']]);
  assert.ok(mid.team, 'shown as a team');
  const leadStatuses = new Set(views.map((v) => v.status));
  assert.ok(!views.some((v, i) => fixture[i].pane !== '%0' && v.status !== views[i - 1]?.status), 'teammate events never changed the lead status');
  assert.ok(leadStatuses.has('working') && leadStatuses.has('idle'));
  // The lead's last Stop (background_tasks: []) removes the teammates.
  const last = views.at(-1);
  assert.deepStrictEqual(last.agents.filter((a) => a.teammate), []);
  assert.strictEqual(last.team, null);
});

test('a second, unrelated claude session in the same terminal is listed, not merged', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'A' }, { pane: '%0' });
  m.onHookEvent(id, { hook_event_name: 'Stop', session_id: 'A' }, { pane: '%0' });
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'B' }, { pane: '%5' });
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.strictEqual(view.status, 'idle', 'main session unchanged');
  assert.deepStrictEqual(view.agents.map((a) => [a.name, a.status, a.teammate]), [['claude %5', 'working', false]]);
  m.onHookEvent(id, { hook_event_name: 'SessionEnd', session_id: 'B' }, { pane: '%5' });
  assert.deepStrictEqual(events.filter(([c]) => c === 'session:agent').at(-1)[1].claude.agents, []);
});

test('`claude --agent` (agent_type, no agent_id) is the main session, not a teammate', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'A', agent_type: 'reviewer' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'A', agent_type: 'reviewer', tool_name: 'Read' });
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual([view.status, view.tool, view.agents.length], ['working', 'Read', 0]);
});

test('a teammate that reported first is moved beside the lead once it says TeammateIdle', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'T', agent_type: 'general-purpose', tool_name: 'Read' }, { pane: '%1' });
  m.onHookEvent(id, { hook_event_name: 'TeammateIdle', session_id: 'T', agent_type: 'general-purpose', teammate_name: 'alpha' }, { pane: '%1' });
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'L' }, { pane: '%0' });
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.strictEqual(view.status, 'working', 'the lead is now the main session');
  assert.deepStrictEqual(view.agents.map((a) => [a.name, a.teammate]), [['alpha', true]]);
});

test('a demoted teammate takes its pane along: the next main session is not focusable through it', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'T', tool_name: 'Read' }, { pane: '%1', socket: '/tmp/tmux-1000/default' });
  m.onHookEvent(id, { hook_event_name: 'TeammateIdle', session_id: 'T', teammate_name: 'alpha' }, { pane: '%1' });
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'L' }); // app wrapper claude: no pane
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.strictEqual(view.status, 'working');
  assert.strictEqual(view.focusable, false);
  assert.strictEqual(view.agents[0].focusable, true);
});

test('a session promoted to main is no longer listed beside it', () => {
  const { m, events } = setup();
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'A' });
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'B' }, { pane: '%5' });
  m.onHookEvent(id, { hook_event_name: 'SessionEnd', session_id: 'A' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'B', tool_name: 'Bash' }, { pane: '%5' });
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual([view.status, view.tool, view.agents.length], ['working', 'Bash', 0]);
});

test('git branch is looked up only when the folder changes or a recheck is asked', () => {
  let lookups = 0;
  const fake = () => ({ onData() {}, onExit() {}, write() {}, kill() {} });
  const m = new SessionManager({ spawn: fake, emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0, gitBranch: () => { lookups++; return 'main'; } });
  const { id } = m.create({ cwd: '/repo' });
  const base = lookups;
  for (let i = 0; i < 20; i++) m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'A', cwd: '/repo', tool_name: 'Read' });
  assert.strictEqual(lookups, base, 'no lookups for repeated events in the same folder');
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'A', cwd: '/repo/sub' });
  assert.strictEqual(lookups, base + 1);
  m.onHookEvent(id, { hook_event_name: 'Stop', session_id: 'A' });
  assert.strictEqual(lookups, base + 2, 'end of turn rechecks the branch');
});

test('shell exit clears the team and tasks', () => {
  let exit;
  const fake = () => ({ onData() {}, onExit(fn) { exit = fn; }, write() {}, kill() {} });
  const events = [];
  const m = new SessionManager({
    spawn: fake, emit: (c, p) => events.push([c, p]), shell: { file: 'sh', args: [] }, pollMs: 0,
    readTeam: () => ({ name: 'session-x', members: [{ name: 'lead', agentType: 'team-lead' }, { name: 'dev', agentId: 'd' }] }),
    readTasks: () => ({ total: 2, done: 1, inProgress: [] }),
  });
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'x' });
  m.onHookEvent(id, { hook_event_name: 'TaskCreated', session_id: 'x' });
  assert.ok(events.filter(([c]) => c === 'session:agent').at(-1)[1].claude.team);
  exit({ exitCode: 0 });
  const view = events.filter(([c]) => c === 'session:agent').at(-1)[1].claude;
  assert.deepStrictEqual([view.team, view.tasks, view.agents.length], [null, null, 0]);
});
