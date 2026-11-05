'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startHookServer } = require('../src/hook-server');
const { buildClaudeSettings, HOOK_EVENTS } = require('../src/claude-settings');
const { shellLaunch, parseCwdReport } = require('../src/shell');
const { gitBranch } = require('../src/git');
const { readTeam, readTasks } = require('../src/teams');

test('hook server accepts only token-bearing POSTs and passes the terminal id', async () => {
  const got = [];
  const cwds = [];
  const srv = await startHookServer({ onEvent: (id, ev) => got.push([id, ev.hook_event_name]), onCwd: (id, d) => cwds.push([id, d]), token: 'tok' });
  const post = (headers, body = '{"hook_event_name":"Stop"}', route = 'hook') =>
    fetch(`http://127.0.0.1:${srv.port}/${route}`, { method: 'POST', headers, body }).then(async (r) => [r.status, await r.text()]);
  try {
    assert.deepStrictEqual(await post({ 'x-omni-token': 'tok', 'x-omni-terminal': '3' }), [200, '']);
    assert.deepStrictEqual(await post({ 'x-omni-token': 'bad', 'x-omni-terminal': '3' }), [403, '']);
    assert.deepStrictEqual(await post({ 'x-omni-token': 'tok', 'x-omni-terminal': '3' }, 'not json'), [200, '']);
    assert.deepStrictEqual(got, [['3', 'Stop']]);
    assert.deepStrictEqual(await post({ 'x-omni-token': 'tok', 'x-omni-terminal': '3' }, '{"cwd":"C:\\\\work\\\\proj"}', 'cwd'), [200, '']);
    assert.deepStrictEqual(await post({ 'x-omni-token': 'bad', 'x-omni-terminal': '3' }, '{"cwd":"/x"}', 'cwd'), [403, '']);
    assert.deepStrictEqual(cwds, [['3', { cwd: 'C:\\work\\proj' }]]);
    assert.strictEqual(srv.cwdUrl, `http://127.0.0.1:${srv.port}/cwd`);
  } finally { srv.close(); }
});

test('settings file has one http hook per event, with env-var headers', () => {
  const s = buildClaudeSettings(4321);
  assert.deepStrictEqual(Object.keys(s.hooks), HOOK_EVENTS);
  const h = s.hooks.Stop[0].hooks[0];
  assert.strictEqual(h.url, 'http://127.0.0.1:4321/hook');
  assert.deepStrictEqual(h.allowedEnvVars, ['OMNI_TERMINAL_ID', 'OMNI_HOOK_TOKEN']);
});

test('shell launch: PowerShell gets the script encoded, bash an rcfile, zsh a ZDOTDIR', () => {
  const ps = shellLaunch('win32', {});
  assert.strictEqual(ps.file, 'powershell.exe');
  const script = Buffer.from(ps.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /function global:claude/);
  assert.match(script, /--settings \$env:OMNI_CLAUDE_SETTINGS/);
  assert.match(script, /OMNI_CWD_URL/);
  assert.match(script, /function global:wsl/);
  assert.match(script, /IFS=; exec bash --rcfile \$OMNI_INIT_BASH -i/);
  assert.deepStrictEqual(shellLaunch('linux', { SHELL: '/bin/bash' }).args.slice(0, 1), ['--rcfile']);
  assert.match(shellLaunch('darwin', { SHELL: '/bin/zsh' }).env.ZDOTDIR, /shell-init[\\/]zsh$/);
});

test('parseCwdReport handles OSC 7 and OSC 9;9', () => {
  assert.strictEqual(parseCwdReport(7, 'file://host/home/u/my%20proj'), '/home/u/my proj');
  assert.strictEqual(parseCwdReport(7, 'file://host/C:/Users/u'), 'C:/Users/u');
  assert.strictEqual(parseCwdReport(9, '9;"C:\\Users\\u\\proj"'), 'C:\\Users\\u\\proj');
  assert.strictEqual(parseCwdReport(9, '4;1;50'), null);
  assert.strictEqual(parseCwdReport(7, 'nonsense'), null);
});

test('gitBranch reads HEAD from the nearest .git, including worktree files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-git-'));
  fs.mkdirSync(path.join(root, 'repo/.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'repo/src/deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'repo/.git/HEAD'), 'ref: refs/heads/feature/x\n');
  assert.strictEqual(gitBranch(path.join(root, 'repo/src/deep')), 'feature/x');
  fs.mkdirSync(path.join(root, 'wtgit'));
  fs.writeFileSync(path.join(root, 'wtgit/HEAD'), '0123456789abcdef\n');
  fs.mkdirSync(path.join(root, 'wt'));
  fs.writeFileSync(path.join(root, 'wt/.git'), 'gitdir: ../wtgit\n');
  assert.strictEqual(gitBranch(path.join(root, 'wt')), '0123456');
  assert.strictEqual(gitBranch(os.tmpdir() === '/' ? '/' : path.join(root)), null);
});

test('team and task files are read defensively', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-claude-'));
  const sid = 'abcdef12-3456';
  fs.mkdirSync(path.join(base, 'teams/session-abcdef12'), { recursive: true });
  fs.writeFileSync(path.join(base, 'teams/session-abcdef12/config.json'), JSON.stringify({ members: [{ name: 'lead', agentId: 'x', agentType: 'team-lead' }, { name: 'dev' }, 5] }));
  assert.deepStrictEqual(readTeam(sid, base).members.map((m) => m.name), ['lead', 'dev']);
  assert.strictEqual(readTeam('zzzzzzzz', base), null);

  fs.mkdirSync(path.join(base, 'tasks', sid), { recursive: true });
  fs.writeFileSync(path.join(base, 'tasks', sid, '1.json'), JSON.stringify({ id: '1', subject: 'a', status: 'completed' }));
  fs.writeFileSync(path.join(base, 'tasks', sid, '2.json'), JSON.stringify({ id: '2', subject: 'b', status: 'in_progress', owner: 'dev' }));
  fs.writeFileSync(path.join(base, 'tasks', sid, '3.json'), '{broken');
  assert.deepStrictEqual(readTasks(sid, base), { total: 2, done: 1, inProgress: [{ subject: 'b', owner: 'dev' }] });
});

test('hook server answers 200 to an oversized event and still passes its key fields', async () => {
  const got = [];
  const srv = await startHookServer({ onEvent: (id, ev, meta) => got.push([id, ev, meta]), token: 'tok' });
  const big = 'x'.repeat(9 * 1024 * 1024);
  const post = (body) => fetch(`http://127.0.0.1:${srv.port}/hook`, {
    method: 'POST', headers: { 'x-omni-token': 'tok', 'x-omni-terminal': '2' }, body,
  }).then((r) => r.status);
  try {
    const plain = JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { content: big } });
    assert.strictEqual(await post(plain), 200);
    const wrapped = `{"omni":{"pane":"%3","title":"@builder"},"event":${JSON.stringify({ session_id: 's2', hook_event_name: 'PostToolUse', agent_type: 'general-purpose', tool_name: 'Write', tool_response: big })}}`;
    assert.strictEqual(await post(wrapped), 200);
    assert.deepStrictEqual(got[0], ['2', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write' }, { pane: '', title: '', socket: '' }]);
    assert.deepStrictEqual(got[1][1], { session_id: 's2', hook_event_name: 'PostToolUse', agent_type: 'general-purpose', tool_name: 'Write' });
    assert.deepStrictEqual(got[1][2], { pane: '%3', title: '@builder', socket: '' });
  } finally { srv.close(); }
});
