'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SessionManager, defaultShell } = require('../src/sessions');

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
    shell: { file: 'sh', args: [] },
    pollMs: 0,
  });
  return { m, events, ptys };
}

test('defaultShell picks PowerShell on Windows', () => {
  assert.strictEqual(defaultShell('win32', {}).file, 'powershell.exe');
  assert.strictEqual(defaultShell('linux', { SHELL: '/bin/zsh' }).file, '/bin/zsh');
});

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
