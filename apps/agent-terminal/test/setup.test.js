'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP = path.join(__dirname, '..');
const SETUP = path.join(APP, 'scripts', 'setup-linux.sh');

test('the page loads the bundled Korean font files that exist', () => {
  const html = fs.readFileSync(path.join(APP, 'src/renderer/index.html'), 'utf8');
  const links = [...html.matchAll(/href="(\.\.\/\.\.\/node_modules\/@fontsource\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 1);
  for (const l of links) assert.ok(fs.existsSync(path.join(APP, 'src/renderer', l)), l);
  assert.match(fs.readFileSync(path.join(APP, 'src/renderer/styles.css'), 'utf8'), /"Nanum Gothic Coding"/);
});

test('setup-linux.sh parses, is executable and has LF endings', () => {
  assert.strictEqual(spawnSync('bash', ['-n', SETUP]).status, 0);
  assert.ok(fs.statSync(SETUP).mode & 0o111, 'executable');
  assert.ok(!fs.readFileSync(SETUP, 'utf8').includes('\r'));
});

test('setup-linux.sh --dry-run lists every step without changing anything',
  { skip: (process.platform !== 'linux' || spawnSync('which', ['apt-cache']).status !== 0) && 'needs Linux with apt' }, () => {
    const r = spawnSync('bash', [SETUP, '--dry-run'], { encoding: 'utf8', env: { ...process.env, HOME: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'omni-setup-')) } });
    assert.strictEqual(r.status, 0, r.stderr);
    for (const step of ['apt-get install', 'build-essential', 'npm install', 'chmod 4755', '실행기 만들기', '완료']) {
      assert.ok(r.stdout.includes(step), `missing: ${step}\n${r.stdout}`);
    }
  });
