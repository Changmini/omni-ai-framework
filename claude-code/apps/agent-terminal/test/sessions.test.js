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

test('team and task files are read after team or task tools, else every 10 s while claude runs', () => {
  let t = 0;
  let reads = 0;
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    now: () => t, readTeam: () => null, readTasks: () => { reads++; return null; },
  });
  const { id } = m.create({});
  const poll = (n) => { for (let i = 0; i < n; i++) { m.pollStatus(); t += 500; } };
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'lead' });
  poll(4); // first check: never read yet
  const base = reads;
  // Ordinary tool calls every half second for 8 s: no reads.
  for (let i = 0; i < 16; i++) { m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'lead', tool_name: 'Bash', tool_use_id: `b${i}` }); poll(1); }
  assert.strictEqual(reads, base);
  // A task tool ran: read at the next check (every 2 s).
  m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'lead', tool_name: 'TaskUpdate', tool_use_id: 'u1' });
  poll(4);
  assert.strictEqual(reads, base + 1);
  // Quiet: again only after 10 s.
  poll(16);
  assert.strictEqual(reads, base + 1);
  poll(8);
  assert.strictEqual(reads, base + 2);
});

test('tmux panes are checked every 5 s while active, every 30 s when quiet, once per server per round', async () => {
  let t = 100000;
  const calls = [];
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    now: () => t, listPanes: async (socket) => { calls.push(socket); return new Set(['%0', '%1']); },
  });
  const a = m.create({}).id;
  const b = m.create({}).id;
  const meta = (pane) => ({ pane, socket: '/tmp/tmux-1000/default', title: '' });
  m.onHookEvent(a, { hook_event_name: 'UserPromptSubmit', session_id: 'lead-a' }, meta('%0'));
  m.onHookEvent(b, { hook_event_name: 'UserPromptSubmit', session_id: 'lead-b' }, meta('%1'));
  const poll = async (ms) => { for (let end = t + ms; t < end; t += 500) { m.pollStatus(); await new Promise((r) => setImmediate(r)); } };
  await poll(500);
  assert.strictEqual(calls.length, 1, 'two terminals on one tmux server: one call');
  await poll(10000);
  assert.strictEqual(calls.length, 3, 'every 5 s while active');
  await poll(60000); // goes quiet a minute after the last event
  const quiet = calls.length;
  await poll(60000);
  assert.ok(calls.length - quiet <= 2, `every 30 s when quiet (${calls.length - quiet} in a minute)`);
});

test('a pane listing shared by terminals keeps sessions heard from after it was taken', async () => {
  let t = 100000;
  const lists = {};
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    now: () => t, listPanes: (socket) => new Promise((r) => { lists[socket.endsWith('other') ? 'other' : 'default'] = r; }),
  });
  const a = m.create({}).id;
  const b = m.create({}).id;
  const meta = (pane, socket = '/tmp/tmux-1000/default') => ({ pane, socket, title: '' });
  // Terminal a shows two tmux servers; terminal b shows one of them.
  m.onHookEvent(a, { hook_event_name: 'UserPromptSubmit', session_id: 'lead-a' }, meta('%0', '/tmp/tmux-1000/other'));
  m.onHookEvent(a, { hook_event_name: 'TeammateIdle', session_id: 'mate0', teammate_name: 'docs' }, meta('%3', '/tmp/tmux-1000/other'));
  m.onHookEvent(a, { hook_event_name: 'TeammateIdle', session_id: 'mate', teammate_name: 'critic' }, meta('%7'));
  m.onHookEvent(b, { hook_event_name: 'UserPromptSubmit', session_id: 'lead-b' }, meta('%1'));
  const round = new Map();
  const pa = m.checkPanes(m.sessions.get(a), round); // asks "other" first
  const pb = m.checkPanes(m.sessions.get(b), round); // starts the "default" listing (no %7 in it yet)
  await new Promise((r) => setImmediate(r));
  t += 1000;
  m.onHookEvent(a, { hook_event_name: 'PreToolUse', session_id: 'mate', tool_name: 'Read' }, meta('%7')); // %7 is new
  t += 1000;
  lists.default(new Set(['%1']));
  await new Promise((r) => setImmediate(r));
  lists.other(new Set(['%0', '%3'])); // terminal a reaches the shared listing only now
  await Promise.all([pa, pb]);
  assert.deepStrictEqual(m.list()[0].claude.agents.map((x) => x.name), ['docs', 'critic'], 'heard from after the listing: kept');
});

test('reading tools do not trigger a team file read', () => {
  let t = 0;
  let reads = 0;
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [] }, pollMs: 0,
    now: () => t, readTasks: () => { reads++; return null; },
  });
  const { id } = m.create({});
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'lead' });
  m.pollStatus(); t += 500;
  const base = reads;
  for (const tool of ['TaskList', 'TaskGet', 'TaskOutput']) m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'lead', tool_name: tool, tool_use_id: tool });
  for (let i = 0; i < 8; i++) { m.pollStatus(); t += 500; }
  assert.strictEqual(reads, base);
  m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'lead', tool_name: 'Agent', tool_use_id: 'ag' });
  for (let i = 0; i < 4; i++) { m.pollStatus(); t += 500; }
  assert.strictEqual(reads, base + 1);
});
