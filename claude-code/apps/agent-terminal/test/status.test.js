'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { StatusTracker, findError, stripAnsi } = require('../src/status');

test('stripAnsi removes color and cursor sequences', () => {
  assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m \x1b[2K\x1b]0;title\x07ok'), 'red ok');
});

test('findError matches common shell and node errors', () => {
  assert.ok(findError('Error: listen EADDRINUSE: address already in use :::3000'));
  assert.ok(findError("claude : The term 'claude' is not recognized as the name of a cmdlet"));
  assert.ok(findError('bash: claude: command not found'));
  assert.strictEqual(findError('all good\nno errors here'), null);
});

test('status goes working -> idle -> error -> cleared -> exited', () => {
  let t = 0;
  const s = new StatusTracker({ now: () => t, activeMs: 1000 });
  s.onOutput('hello\n');
  assert.strictEqual(s.status, 'working');
  t = 2000;
  assert.strictEqual(s.status, 'idle');
  s.onOutput('\x1b[31mError: Port 3000 is already in use\x1b[0m\r\n');
  assert.strictEqual(s.status, 'error');
  assert.match(s.error, /Port 3000/);
  s.onInput();
  t = 5000;
  assert.strictEqual(s.status, 'idle');
  s.onExit();
  assert.strictEqual(s.status, 'exited');
});

test('error split across chunks is still detected', () => {
  const s = new StatusTracker({ now: () => 0 });
  s.onOutput('Err');
  assert.strictEqual(s.error, null);
  s.onOutput('or: boom\n');
  assert.strictEqual(s.error, 'Error: boom');
});

test('the last matching line is reported, not the echoed command', () => {
  assert.strictEqual(
    findError('$ echo "Error: x"\r\nError: x\r\n$ '),
    'Error: x',
  );
});
