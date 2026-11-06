'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { activityEntry } = require('../src/activity');
const { SessionManager } = require('../src/sessions');

test('prompt: first non-empty line, shortened', () => {
  const e = activityEntry({ hook_event_name: 'UserPromptSubmit', prompt: '\n  fix the login bug\nmore' }, 5);
  assert.deepStrictEqual(e, { at: 5, who: null, kind: 'prompt', text: 'fix the login bug', detail: { prompt: '\n  fix the login bug\nmore' } });
  const long = activityEntry({ hook_event_name: 'UserPromptSubmit', prompt: 'x'.repeat(500) }, 5);
  assert.strictEqual(long.text.length, 160);
  assert.strictEqual(activityEntry({ hook_event_name: 'UserPromptSubmit', prompt: '  ' }, 5), null);
});

test('tool summaries for built-in tools', () => {
  const t = (tool_name, tool_input) => activityEntry({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'u1' }, 1);
  assert.deepStrictEqual([t('Edit', { file_path: '/r/a.js' }).text, t('Edit', { file_path: '/r/a.js' }).file], ['/r/a.js', '/r/a.js']);
  assert.strictEqual(t('NotebookEdit', { notebook_path: '/r/n.ipynb' }).file, '/r/n.ipynb');
  assert.deepStrictEqual([t('Bash', { command: 'npm test\necho hi' }).text, t('Bash', { command: 'x' }).file], ['npm test', null]);
  assert.strictEqual(t('Grep', { pattern: 'TODO', path: 'src' }).text, 'TODO · src');
  assert.strictEqual(t('WebFetch', { url: 'https://a.b' }).text, 'https://a.b');
  assert.strictEqual(t('WebSearch', { query: 'xterm' }).text, 'xterm');
  assert.strictEqual(t('Agent', { subagent_type: 'Explore', description: 'find routes' }).text, 'Explore · find routes');
  assert.strictEqual(t('mcp__x__y', null).text, '');
  assert.strictEqual(t('Bash', { command: 'ls' }).useId, 'u1');
});

test('events that are not shown', () => {
  assert.strictEqual(activityEntry({ hook_event_name: 'PostToolUse' }, 1), null);
  assert.strictEqual(activityEntry({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'x' }, 1), null);
  // Already logged by PermissionRequest.
  assert.strictEqual(activityEntry({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' }, 1), null);
  assert.strictEqual(activityEntry({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: 'pick one' }, 1).text, 'pick one');
  assert.strictEqual(activityEntry({ hook_event_name: 'Stop', agent_id: 'a' }, 1), null);
  assert.strictEqual(activityEntry(null, 1), null);
});

function setup(platform = 'linux') {
  const events = [];
  let t = 1000;
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }),
    emit: (ch, p) => events.push([ch, p]),
    shell: { file: 'sh', args: [], env: {} },
    now: () => t++,
    pollMs: 0,
    platform,
  });
  const { id } = m.create({ cwd: '/repo' });
  return { m, id, events };
}

test('the session log: who, failure marks the call, cap', () => {
  const { m, id, events } = setup();
  const sid = 'S1';
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: 'go' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 'b1' });
  m.onHookEvent(id, { hook_event_name: 'PostToolUseFailure', session_id: sid, tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 'b1', error: 'exit 1' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: sid, agent_id: 'a1', agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: '/repo/x.js' }, tool_use_id: 'r1' });
  const log = m.activity(id).entries;
  assert.strictEqual(m.activity(id).max, 200);
  assert.deepStrictEqual(log.map((e) => [e.kind, e.who, e.tool || null]),
    [['prompt', null, null], ['fail', null, 'Bash'], ['tool', 'Explore', 'Read']]);
  assert.strictEqual(log[1].error, 'exit 1');
  const sent = events.filter(([c]) => c === 'session:activity').map(([, p]) => p.entry.n);
  assert.deepStrictEqual(sent, [1, 2, 2, 3]); // the failure re-sends line 2

  // A second claude session in the same terminal (tmux) is named.
  m.onHookEvent(id, { hook_event_name: 'TeammateIdle', session_id: 'S2', teammate_name: 'tester' });
  assert.strictEqual(m.activity(id).entries.at(-1).who, 'tester');
  // Named the same way as in the sidebar.
  assert.strictEqual(m.list()[0].claude.agents.find((a) => a.id === 'session:S2').name, 'tester');

  for (let i = 0; i < 250; i++) m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Bash', tool_input: { command: `c${i}` } });
  assert.strictEqual(m.activity(id).entries.length, 200);
  assert.strictEqual(m.activity(id).entries.at(-1).text, 'c249');
  assert.deepStrictEqual(m.activity('nope').entries, []);
});

test('editorUrl: only files from the log; Windows, Linux and WSL forms', () => {
  const { m, id } = setup('win32');
  const read = (file) => m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: { file_path: file } });
  assert.strictEqual(m.editorUrl(id, '/etc/passwd'), null);
  read('/repo/a b#1.js');
  assert.strictEqual(m.editorUrl(id, '/repo/a b#1.js'), 'vscode://file/repo/a%20b%231.js');
  read('C:\\work\\app.js');
  assert.strictEqual(m.editorUrl(id, 'C:\\work\\app.js'), 'vscode://file/C:/work/app.js');
  read('rel/x.js');
  assert.strictEqual(m.editorUrl(id, 'rel/x.js'), 'vscode://file/repo/rel/x.js');
  m.reportShellCwd(id, { cwd: '/home/u/p', wslDistro: 'Ubuntu-24.04', home: '/home/u' });
  read('/home/u/p/m.py');
  assert.strictEqual(m.editorUrl(id, '/home/u/p/m.py'), 'vscode://vscode-remote/wsl+Ubuntu-24.04/home/u/p/m.py');
});

test('the log keeps the whole input and puts the result on its call', () => {
  const { m, id, events } = setup();
  m.onHookEvent(id, { hook_event_name: 'UserPromptSubmit', session_id: 'S', prompt: 'line one\nline two' });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test\n  --silent', description: 'run tests' } });
  m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'S', tool_name: 'Bash', tool_use_id: 'b1', tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
  m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'S', tool_name: 'Bash', tool_use_id: 'gone', tool_response: { stdout: 'x' } });
  m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: '/home/user/sample-app/a.py' } });
  m.onHookEvent(id, { hook_event_name: 'PostToolUse', session_id: 'S', tool_name: 'Read', tool_use_id: 'r1',
    tool_response: { type: 'text', file: { filePath: '/home/user/sample-app/a.py', content: 'x'.repeat(100000), numLines: 900, startLine: 1, totalLines: 900 } } });
  const log = m.activity(id).entries;
  assert.strictEqual(log.length, 3, 'a result adds no line; an unknown call is ignored');
  assert.strictEqual(log[0].detail.prompt, 'line one\nline two');
  assert.deepStrictEqual(log[1].detail.input, { command: 'npm test\n  --silent', description: 'run tests' });
  assert.deepStrictEqual(log[1].result, { stdout: 'ok', stderr: '', interrupted: false });
  assert.deepStrictEqual(log[2].result, { type: 'text', file: { filePath: '/home/user/sample-app/a.py', numLines: 900, startLine: 1, totalLines: 900 } }, 'file content dropped');
  assert.strictEqual(events.filter(([c]) => c === 'session:activity').length, 5);
});

test('details are cut to a bounded size', () => {
  const { clip, DETAIL_MAX } = require('../src/activity');
  const c = clip({ content: 'x'.repeat(200000), list: Array(500).fill('y'.repeat(300)), deep: { a: { b: { c: { d: { e: 1 } } } } } });
  assert.ok(JSON.stringify(c).length <= DETAIL_MAX);
  assert.match(c.content, /자 생략\)$/);
  assert.strictEqual(clip(undefined), undefined);
  assert.strictEqual(clip('short'), 'short');
});
