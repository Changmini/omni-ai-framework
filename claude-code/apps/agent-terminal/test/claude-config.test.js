'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanClaudeConfig, frontMatter, projectRoot } = require('../src/claude-config');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-cfg-'));
  const cd = path.join(root, 'home/.claude');
  const proj = path.join(root, 'work/app');
  const pdir = path.join(cd, 'plugins/cache/mk/tools/1.2.0');
  const off = path.join(cd, 'plugins/cache/mk/quiet/0.1.0');
  write(path.join(cd, 'skills/writing/SKILL.md'), '---\nname: writing-docs\ndescription: Writes docs. Use when asked.\n---\nbody');
  write(path.join(cd, 'agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews diffs\n---\n');
  write(path.join(cd, 'settings.json'), {
    enabledPlugins: { 'tools@mk': true, 'quiet@mk': false, 'ghost@mk': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/h/.local/share/omni-agent-terminal/claude-hook.sh' }] }] },
  });
  write(path.join(cd, 'plugins/installed_plugins.json'), { version: 2, plugins: {
    'tools@mk': [{ scope: 'user', installPath: pdir, version: '1.2.0' }],
    'quiet@mk': [{ scope: 'user', installPath: off, version: '0.1.0' }],
  } });
  write(path.join(pdir, 'skills/deploying/SKILL.md'), '---\nname: deploying\ndescription: Deploys\n---\n');
  write(path.join(pdir, 'agents/builder.md'), '---\nname: builder\n---\n');
  write(path.join(pdir, 'hooks/hooks.json'), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }] } });
  write(path.join(off, 'skills/hidden/SKILL.md'), '---\nname: hidden\n---\n');
  write(path.join(proj, '.git/HEAD'), 'ref: refs/heads/main\n');
  write(path.join(proj, '.claude/skills/local-skill/SKILL.md'), '---\nname: local-skill\ndescription: Project only\n---\n');
  write(path.join(proj, '.claude/commands/ship.md'), '---\ndescription: Ship it\n---\n');
  write(path.join(proj, '.claude/settings.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'ctx.sh' }] }] } });
  write(path.join(proj, '.claude/settings.local.json'), { enabledPlugins: { 'quiet@mk': true } });
  write(path.join(proj, '.mcp.json'), { mcpServers: { db: { command: 'node', args: ['db.js'] } } });
  write(path.join(root, 'home/.claude.json'), { mcpServers: { web: { type: 'http', url: 'https://x' } }, projects: { [proj]: { mcpServers: { mine: { command: 'm' } } } } });
  fs.mkdirSync(path.join(proj, 'src/deep'), { recursive: true });
  return { cd, proj, json: path.join(root, 'home/.claude.json') };
}

test('frontMatter and projectRoot', () => {
  assert.deepStrictEqual(frontMatter('---\nname: "a"\ndescription: b c\n---\nx'), { name: 'a', description: 'b c' });
  assert.deepStrictEqual(frontMatter('no front matter'), {});
  const { proj } = fixture();
  assert.strictEqual(projectRoot(path.join(proj, 'src/deep')), proj);
});

test('lists skills, plugins, hooks, agents and MCP servers from every scope', () => {
  const { cd, proj, json } = fixture();
  const c = scanClaudeConfig({ claudeDir: cd, claudeJson: json, cwd: path.join(proj, 'src/deep') });
  assert.strictEqual(c.project, proj);
  const names = (k) => c[k].map((x) => x.name).sort();
  // quiet@mk is enabled by the project's local settings, so its skill counts too.
  assert.deepStrictEqual(names('skills'), ['/ship', 'local-skill', 'quiet:hidden', 'tools:deploying', 'writing-docs']);
  assert.deepStrictEqual(c.plugins.map((p) => [p.name, p.enabled, Boolean(p.missing)]).sort(),
    [['ghost', true, true], ['quiet', true, false], ['tools', true, false]]);
  assert.ok(!('dir' in c.plugins[0]), 'install paths are not sent to the page');
  assert.deepStrictEqual(c.hooks.map((x) => [x.event, x.matcher, x.source, x.omni]).sort(), [
    ['PreToolUse', 'Bash', '플러그인 tools', false],
    ['SessionStart', '', '프로젝트', false],
    ['Stop', '', '사용자', true],
  ]);
  assert.deepStrictEqual(names('agents'), ['reviewer', 'tools:builder']);
  assert.deepStrictEqual(c.mcp.map((m) => [m.name, m.source]).sort(), [['db', '프로젝트'], ['mine', '로컬'], ['web', '사용자']]);
});

test('disabled plugins contribute nothing; missing files are fine', () => {
  const { cd, json } = fixture();
  const c = scanClaudeConfig({ claudeDir: cd, claudeJson: json, cwd: null });
  assert.ok(!c.skills.some((s) => s.name === 'quiet:hidden'));
  assert.strictEqual(c.plugins.find((p) => p.name === 'quiet').enabled, false);
  const empty = scanClaudeConfig({ claudeDir: '/nonexistent', claudeJson: '/nonexistent.json', cwd: '/nonexistent' });
  assert.deepStrictEqual([empty.skills, empty.plugins, empty.hooks, empty.agents, empty.mcp], [[], [], [], [], []]);
});

test('mapPath lets WSL install paths be read from the host', () => {
  const { cd, json } = fixture();
  const rec = JSON.parse(fs.readFileSync(path.join(cd, 'plugins/installed_plugins.json')));
  const real = rec.plugins['tools@mk'][0].installPath;
  rec.plugins['tools@mk'][0].installPath = '/home/user/.claude/plugins/cache/mk/tools/1.2.0';
  fs.writeFileSync(path.join(cd, 'plugins/installed_plugins.json'), JSON.stringify(rec));
  const c = scanClaudeConfig({ claudeDir: cd, claudeJson: json, cwd: null, mapPath: (p) => (p.startsWith('/home/user/') ? real : p) });
  assert.ok(c.skills.some((s) => s.name === 'tools:deploying'));
});

test('each item names the file behind it, and the viewer may read only those', () => {
  const { cd, proj, json } = fixture();
  const c = scanClaudeConfig({ claudeDir: cd, claudeJson: json, cwd: proj });
  const fileOf = (k, name) => c[k].find((x) => x.name === name).file;
  assert.strictEqual(fileOf('skills', 'writing-docs'), path.join(cd, 'skills/writing/SKILL.md'));
  assert.strictEqual(fileOf('skills', '/ship'), path.join(proj, '.claude/commands/ship.md'));
  assert.strictEqual(fileOf('agents', 'reviewer'), path.join(cd, 'agents/reviewer.md'));
  assert.strictEqual(fileOf('agents', 'tools:builder'), path.join(cd, 'plugins/cache/mk/tools/1.2.0/agents/builder.md'));
  assert.strictEqual(fileOf('mcp', 'db'), path.join(proj, '.mcp.json'));
  assert.strictEqual(fileOf('mcp', 'web'), json);
  assert.ok(c.hooks.some((h) => h.event === 'SessionStart' && h.file === path.join(proj, '.claude/settings.json')));
  assert.ok(c.hooks.some((h) => h.event === 'PreToolUse' && h.file.endsWith(path.join('tools', '1.2.0', 'hooks', 'hooks.json'))));
  // A plugin without README falls back to its manifest; none at all: no file.
  assert.strictEqual(c.plugins.find((p) => p.name === 'tools').file, null);
  fs.mkdirSync(path.join(cd, 'plugins/cache/mk/tools/1.2.0/.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(cd, 'plugins/cache/mk/tools/1.2.0/.claude-plugin/plugin.json'), '{"name":"tools"}');
  const c2 = scanClaudeConfig({ claudeDir: cd, claudeJson: json, cwd: proj });
  assert.strictEqual(c2.plugins.find((p) => p.name === 'tools').file, path.join(cd, 'plugins/cache/mk/tools/1.2.0/.claude-plugin/plugin.json'));

  const { SessionManager } = require('../src/sessions');
  const m = new SessionManager({
    spawn: () => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }), emit: () => {}, shell: { file: 'sh', args: [], env: {} }, pollMs: 0,
    scanConfig: scanClaudeConfig, claudePaths: { dir: cd, json },
  });
  const { id } = m.create({ cwd: proj });
  assert.strictEqual(m.fileTarget(id, path.join(cd, 'agents/reviewer.md')), null, 'not before the list is read');
  m.claudeConfig(id);
  const skill = path.join(cd, 'skills/writing/SKILL.md');
  assert.deepStrictEqual(m.fileTarget(id, skill), { path: skill, host: skill });
  assert.strictEqual(m.fileTarget(id, path.join(cd, 'settings.json.omni-backup')), null);
});
