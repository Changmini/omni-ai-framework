'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PLUGIN_DIR, readAppSkills, readAppSkillFile, installedElsewhere, outline } = require('../src/app-skills');

function tree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

test('outline: title, first paragraph and the checklist of a skill body', () => {
  const o = outline('---\nname: x\n---\n\n# 제목\n\n첫 줄\n둘째 줄\n\n| 표 |\n\n```\n진행:\n- [ ] 1. 하나\n- [x] 2. 둘\n```\n');
  assert.deepStrictEqual(o, { title: '제목', summary: '첫 줄 둘째 줄', steps: ['1. 하나', '2. 둘'] });
  assert.deepStrictEqual(outline('no heading'), { title: '', summary: 'no heading', steps: [] });
});

test('readAppSkills lists skills and agents in order, with how to call them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-skills-'));
  try {
    tree(root, {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'sample-plugin', version: '1.2.0' }),
      'skills/zeta/SKILL.md': '---\nname: zeta\n---\n# Z\n',
      'skills/develop/SKILL.md': '---\nname: develop\nargument-hint: "[요청]"\n---\n# 이끌기\n\n요약.\n',
      'skills/develop/guide.md': '# guide\n',
      'agents/reviewer.md': '---\nname: reviewer\ndescription: 리뷰어\n---\n',
      'agents/lead.md': '---\nname: lead\ndescription: 팀장\n---\n',
    });
    const r = readAppSkills(root);
    assert.strictEqual(r.plugin, 'sample-plugin');
    assert.strictEqual(r.version, '1.2.0');
    assert.deepStrictEqual(r.skills.map((s) => s.name), ['develop', 'zeta']);
    assert.strictEqual(r.skills[0].call, '/sample-plugin:develop [요청]');
    assert.deepStrictEqual(r.skills[0].files, ['skills/develop/SKILL.md', 'skills/develop/guide.md']);
    assert.deepStrictEqual(r.agents.map((a) => [a.name, a.call]), [['lead', 'claude --agent sample-plugin:lead'], ['reviewer', '']]);
    assert.strictEqual(readAppSkills(path.join(root, 'nope')), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('readAppSkillFile reads only Markdown inside the plugin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-skills-'));
  try {
    tree(root, { 'skills/a/SKILL.md': 'hi', 'notes.txt': 'no' });
    fs.writeFileSync(path.join(os.tmpdir(), 'omni-outside.md'), 'outside');
    assert.strictEqual(readAppSkillFile('skills/a/SKILL.md', root), 'hi');
    assert.strictEqual(readAppSkillFile('notes.txt', root), null);
    assert.strictEqual(readAppSkillFile('../omni-outside.md', root), null);
    assert.strictEqual(readAppSkillFile(path.join(os.tmpdir(), 'omni-outside.md'), root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(os.tmpdir(), 'omni-outside.md'), { force: true });
  }
});

test('installedElsewhere looks for omni-pipeline@<marketplace> in the install record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-claude-'));
  try {
    assert.strictEqual(installedElsewhere(dir), false);
    tree(dir, { 'plugins/installed_plugins.json': JSON.stringify({ plugins: { 'omni-core@m': [] } }) });
    assert.strictEqual(installedElsewhere(dir), false);
    tree(dir, { 'plugins/installed_plugins.json': JSON.stringify({ plugins: { 'omni-pipeline@m': [] } }) });
    assert.strictEqual(installedElsewhere(dir), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PLUGIN_DIR is the repository\'s claude-code/plugins/omni-pipeline, which has develop', (t) => {
  assert.strictEqual(PLUGIN_DIR, path.resolve(__dirname, '..', '..', '..', 'claude-code', 'plugins', 'omni-pipeline'));
  if (!fs.existsSync(PLUGIN_DIR)) return t.skip('not inside the omni-ai-framework repository');
  const r = readAppSkills();
  assert.ok(r && r.skills.some((s) => s.name === 'develop'));
  assert.ok(r.agents.some((a) => a.name === 'router'));
});
