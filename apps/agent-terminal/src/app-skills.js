'use strict';

// The plugin the app bundles (plugins/omni-pipeline) and loads into the claude
// of its terminals with --plugin-dir (src/shell-init): read for the 스킬 tab.
// Only Markdown files inside the plugin folder are read; nothing is executed.

const fs = require('node:fs');
const path = require('node:path');
const { frontMatter } = require('./claude-config');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins', 'omni-pipeline');
const MAX_FILE = 256 * 1024;
// Shown first, in this order; any other skill or agent follows by name.
const SKILL_ORDER = ['develop', 'build', 'spec-check'];
const AGENT_ORDER = ['lead', 'router', 'implementer', 'reviewer'];
// Agents meant as the main session (claude --agent <plugin>:<name>).
const MAIN_AGENTS = new Set(['lead']);

function readText(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size <= MAX_FILE ? fs.readFileSync(file, 'utf8') : null;
  } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function ordered(items, order) {
  const rank = (n) => (order.includes(n) ? order.indexOf(n) : order.length);
  return items.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

// The body after the front matter: its first "# " heading, the first paragraph
// under it, and the checklist in the first code block that holds "- [ ]" lines
// (a skill's progress list).
function outline(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = body.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^# \S/.test(l));
  const title = h1 >= 0 ? lines[h1].slice(2).trim() : '';
  let summary = '';
  for (let i = h1 + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { if (summary) break; continue; }
    if (/^(#|\||```|- |\d+\. )/.test(l)) { if (summary) break; continue; }
    summary += (summary ? ' ' : '') + l;
  }
  const steps = [];
  const fence = body.match(/```[^\n]*\n([\s\S]*?)```/g) || [];
  for (const block of fence) {
    const items = [...block.matchAll(/^- \[[ x]\] (.+)$/gm)].map((m) => m[1].trim());
    if (items.length) { steps.push(...items); break; }
  }
  return { title, summary, steps };
}

function readAppSkills(dir = PLUGIN_DIR) {
  const manifest = (() => { try { return JSON.parse(readText(path.join(dir, '.claude-plugin', 'plugin.json'))); } catch { return null; } })();
  if (!manifest || !manifest.name) return null;
  const plugin = manifest.name;
  const skills = [];
  for (const e of listDir(path.join(dir, 'skills'))) {
    if (!e.isDirectory()) continue;
    const folder = path.join(dir, 'skills', e.name);
    const text = readText(path.join(folder, 'SKILL.md'));
    if (text == null) continue;
    const fm = frontMatter(text);
    const name = fm.name || e.name;
    const hint = fm['argument-hint'] || '';
    // SKILL.md first, then the files it points to (setup-guide.md, ...).
    const files = ['SKILL.md', ...listDir(folder).filter((f) => f.isFile() && /\.md$/.test(f.name) && f.name !== 'SKILL.md').map((f) => f.name).sort()]
      .map((f) => path.posix.join('skills', e.name, f));
    skills.push({ name, call: `/${plugin}:${name}${hint ? ` ${hint}` : ''}`, ...outline(text), files });
  }
  const agents = [];
  for (const e of listDir(path.join(dir, 'agents'))) {
    if (!e.isFile() || !/\.md$/.test(e.name)) continue;
    const text = readText(path.join(dir, 'agents', e.name));
    if (text == null) continue;
    const fm = frontMatter(text);
    const name = fm.name || e.name.replace(/\.md$/, '');
    agents.push({
      name,
      description: fm.description || '',
      call: MAIN_AGENTS.has(name) ? `claude --agent ${plugin}:${name}` : '',
      file: path.posix.join('agents', e.name),
    });
  }
  return { plugin, version: manifest.version || '', skills: ordered(skills, SKILL_ORDER), agents: ordered(agents, AGENT_ORDER) };
}

// One Markdown file of the plugin by its path inside it, or null.
function readAppSkillFile(rel, dir = PLUGIN_DIR) {
  if (typeof rel !== 'string' || !/\.md$/.test(rel)) return null;
  const root = path.resolve(dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
  return readText(file);
}

// Whether the user installed the plugin from a marketplace: then that copy is
// the one claude uses and the app does not add its own (src/shell-init).
function installedElsewhere(claudeDir, plugin = 'omni-pipeline') {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.keys((record && record.plugins) || {}).some((id) => id.startsWith(`${plugin}@`));
  } catch { return false; }
}

module.exports = { PLUGIN_DIR, readAppSkills, readAppSkillFile, installedElsewhere, outline };
