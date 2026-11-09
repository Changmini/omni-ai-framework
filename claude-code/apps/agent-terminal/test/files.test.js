'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTextFile, VIEW_MAX } = require('../src/files');
const { SessionManager } = require('../src/sessions');

test('readTextFile: text, BOM, large, binary, missing', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-files-'));
  const w = (name, data) => { fs.writeFileSync(path.join(d, name), data); return path.join(d, name); };
  assert.deepStrictEqual(await readTextFile(w('a.py', 'def add(a, b):\n    return a + b\n')),
    { size: 32, text: 'def add(a, b):\n    return a + b\n', truncated: false });
  assert.strictEqual((await readTextFile(w('bom.txt', '﻿한글'))).text, '한글');
  // A Hangul character (3 bytes) cut at the limit is dropped, not shown broken.
  const big = await readTextFile(w('big.txt', `${'a'.repeat(VIEW_MAX - 1)}가나다`));
  assert.strictEqual(big.truncated, true);
  assert.strictEqual(big.text, 'a'.repeat(VIEW_MAX - 1));
  assert.deepStrictEqual(await readTextFile(w('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))), { size: 7, binary: true });
  assert.match((await readTextFile(path.join(d, 'nope.txt'))).error, /파일이 없습니다/);
  assert.match((await readTextFile(d)).error, /파일이 아닙니다/);
});

function setup(platform) {
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }),
    emit: () => {}, shell: { file: 'sh', args: [], env: {} }, pollMs: 0, platform,
  });
  const { id } = m.create({ cwd: '/home/user/sample-app' });
  const read = (file) => m.onHookEvent(id, { hook_event_name: 'PreToolUse', session_id: 'S', tool_name: 'Read', tool_input: { file_path: file } });
  return { m, id, read };
}

test('fileTarget: only files from the log, mapped for WSL on Windows', () => {
  const lin = setup('linux');
  assert.strictEqual(lin.m.fileTarget(lin.id, '/etc/passwd'), null);
  lin.read('/home/user/sample-app/src/a.py');
  assert.deepStrictEqual(lin.m.fileTarget(lin.id, '/home/user/sample-app/src/a.py'),
    { path: '/home/user/sample-app/src/a.py', host: '/home/user/sample-app/src/a.py' });
  lin.read('src/b.py');
  assert.deepStrictEqual(lin.m.fileTarget(lin.id, 'src/b.py'),
    { path: '/home/user/sample-app/src/b.py', host: '/home/user/sample-app/src/b.py' });
  assert.strictEqual(lin.m.fileTarget('99', 'src/b.py'), null);

  const win = setup('win32');
  win.m.reportShellCwd(win.id, { cwd: '/home/user/sample-app', wslDistro: 'Ubuntu', home: '/home/user' });
  win.read('/home/user/sample-app/src/a.py');
  assert.deepStrictEqual(win.m.fileTarget(win.id, '/home/user/sample-app/src/a.py'),
    { path: '/home/user/sample-app/src/a.py', host: '\\\\wsl.localhost\\Ubuntu\\home\\user\\sample-app\\src\\a.py' });
});

test('readFully keeps reading after a short read', async () => {
  const { readFully } = require('../src/files');
  const src = Buffer.from('abcdefghij');
  const fh = { read: async (buf, off, len, pos) => { const n = Math.min(3, len, src.length - pos); src.copy(buf, off, pos, pos + n); return { bytesRead: Math.max(0, n) }; } };
  const buf = Buffer.alloc(8);
  assert.strictEqual(await readFully(fh, buf, 2), 8);
  assert.strictEqual(buf.toString(), 'cdefghij');
  const tail = Buffer.alloc(8);
  assert.strictEqual(await readFully(fh, tail, 6), 4, 'stops at end of file');
});
