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
