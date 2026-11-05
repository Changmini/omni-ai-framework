'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planFromStatus, PlanUsage } = require('../src/plan-usage');
const { startHookServer } = require('../src/hook-server');
const { STATUS_LINE_COMMAND, buildClaudeSettings } = require('../src/claude-settings');

const INIT = path.join(__dirname, '..', 'src', 'shell-init');

// rate_limits as Claude Code 2.1.318 sent it to a status line.
const STATUS = {
  session_id: 's', model: { id: 'claude-opus-5-5' },
  rate_limits: { five_hour: { used_percentage: 23.4, resets_at: 1793893800 }, seven_day: { used_percentage: 28, resets_at: 1794096000 } },
};

test('the current session (five_hour) window is read; absent windows give nothing', () => {
  assert.deepStrictEqual(planFromStatus(STATUS), { pct: 23, resetsAt: 1793893800000 });
  assert.strictEqual(planFromStatus({ session_id: 's' }), null); // API key, or before the first answer
  assert.strictEqual(planFromStatus({ rate_limits: { seven_day: { used_percentage: 5 } } }), null);
  assert.deepStrictEqual(planFromStatus({ rate_limits: { five_hour: { used_percentage: 140 } } }), { pct: 100, resetsAt: null });
});

test('PlanUsage keeps the latest value and emits only on change', () => {
  const sent = [];
  const p = new PlanUsage({ emit: (c, v) => sent.push([c, v]), now: () => 5 });
  p.report({});
  p.report(STATUS);
  p.report(STATUS);
  p.report({ rate_limits: { five_hour: { used_percentage: 30, resets_at: 1793893800 } } });
  assert.deepStrictEqual(sent.map(([c, v]) => [c, v.pct]), [['plan:usage', 23], ['plan:usage', 30]]);
  assert.deepStrictEqual(p.get(), { pct: 30, resetsAt: 1793893800000, at: 5 });
});

test('the settings carry the status line next to the hooks', () => {
  const s = buildClaudeSettings(4321);
  assert.deepStrictEqual(s.statusLine, { type: 'command', command: STATUS_LINE_COMMAND });
  assert.ok(s.hooks.Stop);
});

test('the status line command posts its input to /status and runs the user status line', async (t) => {
  if (spawnSync('curl', ['--version']).status !== 0) return t.skip('no curl');
  const got = [];
  const srv = await startHookServer({ onEvent() {}, onStatusLine: (id, d) => got.push([id, d]), token: 'tok' });
  try {
    const run = (extra) => spawnSync('bash', ['-c', STATUS_LINE_COMMAND], {
      input: JSON.stringify(STATUS), encoding: 'utf8',
      env: { ...process.env, OMNI_HOOK_TOKEN: 'tok', OMNI_TERMINAL_ID: '3', OMNI_CWD_URL: srv.cwdUrl, ...extra },
    });
    const plain = run({ OMNI_USER_STATUSLINE: '' });
    assert.strictEqual(plain.stdout, '', 'no status line of its own');
    // The user's own command gets the same input; ~ and pipes work as in settings.
    const mine = run({ OMNI_USER_STATUSLINE: 'python3 -c "import json,sys; print(\'mine\', json.load(sys.stdin)[\'model\'][\'id\'])" | tr a-z A-Z' });
    assert.strictEqual(mine.stdout, 'MINE CLAUDE-OPUS-5-5\n');
    for (let i = 0; i < 100 && got.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(got.length, 2);
    assert.deepStrictEqual(got[0], ['3', STATUS]);
    // A wrong token is refused.
    run({ OMNI_HOOK_TOKEN: 'bad' });
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(got.length, 2);
  } finally { srv.close(); }
});

test('user-statusline.py: local, then project, then user settings', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) return t.skip('no python3');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-sl-'));
  const w = (f, o) => { fs.writeFileSync(path.join(d, f), typeof o === 'string' ? o : JSON.stringify(o)); return path.join(d, f); };
  const local = w('local.json', { permissions: {} });
  const project = w('project.json', { statusLine: { type: 'command', command: 'echo project' } });
  const user = w('user.json', { statusLine: { type: 'command', command: '~/.claude/sl.sh' } });
  const bad = w('bad.json', '{ not json');
  const run = (...files) => spawnSync('python3', [path.join(INIT, 'user-statusline.py'), ...files], { encoding: 'utf8' }).stdout;
  assert.strictEqual(run(local, project, user), 'echo project');
  assert.strictEqual(run(bad, local, path.join(d, 'missing.json'), user), '~/.claude/sl.sh');
  assert.strictEqual(run(local), '');
});
