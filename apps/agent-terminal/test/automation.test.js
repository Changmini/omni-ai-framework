'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const RuleLogic = require('../src/renderer/rule-logic');
const { Rules } = require('../src/rules');
const { Results, Automation, readRequests, requestText, buildPrompt, parseSkills, runClaude, HOUR, MINUTE } = require('../src/automation');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omni-auto-'));
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (cwd, at, content, extra = {}) => line({ type: 'user', cwd, timestamp: new Date(at).toISOString(), message: { role: 'user', content }, ...extra });

test('requestText keeps typed requests and slash commands, drops the rest', () => {
  const u = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
  assert.strictEqual(requestText(u('README 오타 고쳐줘')), 'README 오타 고쳐줘');
  assert.strictEqual(requestText(u('<command-message>x</command-message>\n<command-name>/omni-pipeline:develop</command-name>\n<command-args>이름 검사</command-args>')), '/omni-pipeline:develop 이름 검사');
  assert.strictEqual(requestText(u([{ type: 'text', text: '그림 보고 고쳐줘' }, { type: 'image' }])), '그림 보고 고쳐줘');
  assert.strictEqual(requestText(u([{ type: 'tool_result', content: 'ok' }])), '');
  assert.strictEqual(requestText(u('hi', { isMeta: true })), '');
  assert.strictEqual(requestText(u('hi', { isSidechain: true })), '');
  assert.strictEqual(requestText(u('<local-command-stdout>x</local-command-stdout>')), '');
  assert.strictEqual(requestText({ type: 'assistant', message: { role: 'assistant', content: 'x' } }), '');
});

test('readRequests groups the period\'s requests by project folder', async () => {
  const dir = tmp();
  const now = Date.parse('2026-11-27T12:00:00Z');
  try {
    fs.mkdirSync(path.join(dir, 'projects', '-home-user-sample-app'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'projects', '-home-user-other'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects', '-home-user-sample-app', 'a.jsonl'),
      user('/home/user/sample-app', now - 20 * HOUR, '오래된 요청')
      + user('/home/user/sample-app', now - 2 * HOUR, '두 번째')
      + user('/home/user/sample-app', now - 3 * HOUR, '첫 번째')
      + line({ type: 'assistant', cwd: '/home/user/sample-app', timestamp: new Date(now - HOUR).toISOString(), message: { role: 'assistant', content: 'x' } })
      + 'not json\n');
    fs.writeFileSync(path.join(dir, 'projects', '-home-user-other', 'b.jsonl'), user('/home/user/other', now - HOUR, '다른 프로젝트'));
    const got = await readRequests(dir, now - 12 * HOUR);
    assert.deepStrictEqual([...got.keys()].sort(), ['/home/user/other', '/home/user/sample-app']);
    assert.deepStrictEqual(got.get('/home/user/sample-app').map((r) => r.text), ['첫 번째', '두 번째']);
    assert.strictEqual((await readRequests(path.join(dir, 'none'), 0)).size, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('buildPrompt fills the rule text, adds the requests and, for skills, the answer form', () => {
  const rule = { action: { kind: 'agent', preset: 'skills', text: RuleLogic.SKILLS_PROMPT } };
  const p = buildPrompt(rule, { project: '/home/user/sample-app', minutes: 90, skills: ['develop'], requests: [{ at: Date.parse('2026-11-27T01:00:00Z'), text: '배포 체크리스트 만들어줘' }] });
  assert.match(p, /\/home\/user\/sample-app/);
  assert.match(p, /지난 1시간 30분 동안/);
  // A text saved before {period} keeps {hours}, in whole hours.
  assert.match(buildPrompt({ action: { kind: 'agent', text: '지난 {hours}시간' } }, { project: '/p', minutes: 720, skills: [], requests: [] }), /지난 12시간/);
  assert.match(p, /이미 있는 스킬\(develop\)/);
  assert.match(p, /배포 체크리스트 만들어줘/);
  assert.match(p, /"skills": \[/);
  const plain = buildPrompt({ action: { kind: 'agent', preset: '', text: '요약해줘' } }, { project: '/p', minutes: 60, skills: [], requests: [] });
  assert.doesNotMatch(plain, /답 형식/);
  // Many long requests: the oldest are left out, the newest kept.
  const many = Array.from({ length: 400 }, (_, i) => ({ at: i * 1000, text: `${i} ${'가'.repeat(590)}` }));
  const big = buildPrompt(rule, { project: '/p', minutes: 720, skills: [], requests: many });
  assert.ok(big.length < 70000);
  assert.match(big, /399 /);
  assert.doesNotMatch(big, /\] 0 /);
});

test('parseSkills reads the JSON answer and cleans each recommendation', () => {
  const s = parseSkills('여기 있습니다\n```json\n{"skills":[{"name":"Deploy Check!","title":"배포 전 점검","why":"매번 같은 순서","evidence":["배포 전 시험","배포 전 마이그레이션"],"count":4},{"name":"x"}]}\n```');
  assert.deepStrictEqual(s, [{ name: 'deploy-check', title: '배포 전 점검', why: '매번 같은 순서', evidence: ['배포 전 시험', '배포 전 마이그레이션'], count: 4 }]);
  assert.deepStrictEqual(parseSkills('{"skills": []}'), []);
  assert.strictEqual(parseSkills('추천 없음'), null);
  assert.strictEqual(parseSkills('{"other": 1}'), null);
});

test('Results keeps the newest 100, survives a restart, and ends a cut-off run as failed', () => {
  const dir = tmp();
  const file = path.join(dir, 'results.json');
  let t = 0;
  try {
    const a = new Results({ file, now: () => ++t });
    const run = a.add({ ruleName: 'r', status: 'running' });
    for (let i = 0; i < 105; i++) a.add({ ruleName: `n${i}`, text: 'x' });
    assert.strictEqual(a.list().length, 100);
    assert.strictEqual(a.list()[0].ruleName, 'n104');
    a.add({ ruleName: 'last', status: 'running' });
    const b = new Results({ file });
    assert.strictEqual(b.list()[0].status, 'failed');
    assert.ok(!b.list().some((x) => x.id === run.id), 'the oldest dropped');
    b.remove(b.list()[0].id);
    assert.strictEqual(b.list().length, 99);
    b.clear();
    assert.strictEqual(new Results({ file }).list().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function setup({ now, requestsAt = [], period = { every: 12 } } = {}) {
  const dir = tmp();
  const claude = path.join(dir, 'claude');
  fs.mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'projects', 'p', 's.jsonl'), requestsAt.map((at, i) => user('/home/user/sample-app', at, `요청 ${i}`)).join(''));
  const rules = new Rules();
  rules.set({ rules: [{ id: 't', name: '추천 스킬 찾기', enabled: true, event: 'timer', ...period, action: { kind: 'agent', preset: 'skills', text: RuleLogic.SKILLS_PROMPT } }] });
  const results = new Results({ file: path.join(dir, 'results.json'), now: () => now.t });
  const calls = [];
  const run = async (o) => { calls.push(o); return { text: '{"skills":[{"name":"sample","title":"제목","why":"이유","evidence":[]}]}', cost: 0.02 }; };
  const auto = new Automation({ rules, results, claudeDirs: () => [{ dir: claude, distro: null }], stateFile: path.join(dir, 'state.json'), run, now: () => now.t });
  return { dir, auto, results, calls, stateFile: path.join(dir, 'state.json') };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test('Automation: a new rule waits a full period, then runs once per project', async () => {
  const now = { t: Date.parse('2026-11-27T00:00:00Z') };
  const s = setup({ now, requestsAt: [now.t + 2 * HOUR, now.t + 3 * HOUR] });
  try {
    s.auto.tick();
    await settle();
    assert.strictEqual(s.calls.length, 0, 'not at once');
    now.t += 11 * HOUR;
    s.auto.tick();
    await settle();
    assert.strictEqual(s.calls.length, 0);
    now.t += HOUR;
    s.auto.tick();
    await settle();
    assert.strictEqual(s.calls.length, 1);
    assert.strictEqual(s.calls[0].cwd, '/home/user/sample-app');
    assert.match(s.calls[0].prompt, /요청 0/);
    const r = s.results.list()[0];
    assert.deepStrictEqual([r.status, r.kind, r.requests, r.skills[0].name, r.cost], ['done', 'skills', 2, 'sample', 0.02]);
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('Automation: a rule set in minutes runs after that many minutes', async () => {
  const now = { t: Date.parse('2026-11-27T00:00:00Z') };
  const s = setup({ now, requestsAt: [now.t + MINUTE], period: { minutes: 10 } });
  try {
    s.auto.tick();
    now.t += 9 * MINUTE;
    s.auto.tick();
    await settle();
    assert.strictEqual(s.calls.length, 0);
    now.t += MINUTE;
    s.auto.tick();
    await settle();
    assert.strictEqual(s.calls.length, 1);
    assert.match(s.calls[0].prompt, /지난 10분 동안/);
    assert.strictEqual(s.results.list()[0].minutes, 10);
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('Automation: a run missed while the app was closed happens once at start', async () => {
  const now = { t: Date.parse('2026-11-27T00:00:00Z') };
  const s = setup({ now, requestsAt: [now.t + HOUR] });
  try {
    fs.writeFileSync(s.stateFile, JSON.stringify({ last: { t: now.t - 3 * 24 * HOUR } }));
    const fresh = new Automation({ rules: s.auto.rules, results: s.results, claudeDirs: s.auto.claudeDirs, stateFile: s.stateFile, run: s.auto.run, now: () => now.t + 2 * HOUR });
    fresh.tick();
    await settle();
    fresh.tick();
    await settle();
    assert.strictEqual(s.calls.length, 1);
    assert.ok(s.results.list()[0].minutes >= 50 * 60, 'read since the last run');
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

test('Automation: run now, a failing run, and nothing to read', async () => {
  const now = { t: Date.parse('2026-11-27T00:00:00Z') };
  const s = setup({ now, requestsAt: [] });
  try {
    assert.strictEqual(s.auto.runNow('t'), true);
    await settle();
    assert.strictEqual(s.results.list()[0].kind, 'note', 'manual run with no conversations says so');
    assert.strictEqual(s.auto.runNow('nope'), false);
    fs.writeFileSync(path.join(s.dir, 'claude', 'projects', 'p', 's.jsonl'), user('/home/user/sample-app', now.t - HOUR, '요청'));
    s.auto.run = async () => { throw new Error('claude를 실행하지 못했습니다: ENOENT'); };
    s.auto.runNow('t');
    await settle();
    const r = s.results.list()[0];
    assert.deepStrictEqual([r.status, r.error], ['failed', 'claude를 실행하지 못했습니다: ENOENT']);
    assert.deepStrictEqual(Object.keys(s.auto.state()), ['t']);
  } finally { fs.rmSync(s.dir, { recursive: true, force: true }); }
});

function fakeSpawn(stdout, code = 0) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    let input = '';
    c.stdin = { on() {}, end(s) { input = s; setImmediate(() => { c.stdout.emit('data', Buffer.from(stdout)); c.emit('close', code); }); } };
    c.kill = () => {};
    calls.push({ cmd, args, opts, input: () => input });
    return c;
  };
  return { fn, calls };
}

test('runClaude: prompt on stdin, no tools, WSL through wsl.exe, the result read', async () => {
  const ok = fakeSpawn('{"type":"result","is_error":false,"result":"답","total_cost_usd":0.01}\n');
  const r = await runClaude({ prompt: '질문', cwd: '/home/user/sample-app', platform: 'linux', spawnFn: ok.fn });
  assert.deepStrictEqual(r, { text: '답', cost: 0.01 });
  const c = ok.calls[0];
  assert.strictEqual(c.cmd, 'claude');
  assert.deepStrictEqual(c.args, ['-p', '--output-format', 'json', '--max-turns', '3', '--tools', '']);
  assert.strictEqual(c.opts.cwd, '/home/user/sample-app');
  assert.strictEqual(c.input(), '질문');
  assert.strictEqual(c.opts.env.OMNI_AUTOMATION, '1');

  const wsl = fakeSpawn('{"type":"result","is_error":false,"result":"x"}');
  await runClaude({ prompt: 'q', cwd: '/home/user/sample-app', distro: 'Ubuntu', platform: 'win32', spawnFn: wsl.fn });
  assert.strictEqual(wsl.calls[0].cmd, 'wsl.exe');
  assert.deepStrictEqual(wsl.calls[0].args.slice(0, 5), ['-d', 'Ubuntu', '--cd', '/home/user/sample-app', '-e']);
  assert.ok(wsl.calls[0].args.includes('--tools'));
  assert.deepStrictEqual(wsl.calls[0].args.slice(5, 7), ['bash', '-lc'], 'not interactive: ~/.bashrc may start tmux');

  const bad = fakeSpawn('{"type":"result","is_error":true,"result":"Credit balance is too low"}', 1);
  await assert.rejects(runClaude({ prompt: 'q', cwd: '/x', platform: 'linux', spawnFn: bad.fn }), /Credit balance/);
});
