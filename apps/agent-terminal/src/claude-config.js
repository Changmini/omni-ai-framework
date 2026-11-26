'use strict';

// What Claude Code would load for a project: skills, plugins, hooks,
// subagents and MCP servers, read from disk for the sidebar list.
//
// Locations follow https://code.claude.com/docs (skills, plugins, hooks,
// settings, MCP). The plugin install record (plugins/installed_plugins.json,
// "version": 2, with installPath per plugin) and the plugin cache layout were
// read from disk on Claude Code 2.1.318; they are not documented, so every
// field is optional here. Nothing is executed; files are only read.

const fs = require('node:fs');
const path = require('node:path');
const ViewLogic = require('./renderer/view-logic');

const MAX_ITEMS = 300;
const MAX_FILE = 512 * 1024;

function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

// Whether `file` exists as a file, without reading it.
function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function readJson(file) {
  const t = readText(file);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// `key: value` lines of a markdown file's YAML front matter (flat subset).
// (the same reader as the viewer's, so block values such as
// "description: >-" read the same in the list and in the file)
function frontMatter(text) {
  const fm = ViewLogic.frontMatter(String(text || '').replace(/\r\n?/g, '\n').split('\n'));
  return fm ? Object.fromEntries(fm.pairs) : {};
}

// Nearest folder at or above `dir` with .git or .claude; else `dir` itself.
function projectRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 64 && cur; i++) {
    if (fs.existsSync(path.join(cur, '.git')) || fs.existsSync(path.join(cur, '.claude'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dir;
}

function skillsIn(dir, source) {
  const out = [];
  for (const e of listDir(dir)) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    const text = readText(file);
    if (text == null) continue;
    const fm = frontMatter(text);
    out.push({ name: fm.name || e.name, description: fm.description || '', source, file });
  }
  return out;
}

function commandsIn(dir, source) {
  const out = [];
  for (const e of listDir(dir)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const file = path.join(dir, e.name);
    const fm = frontMatter(readText(file));
    out.push({ name: `/${e.name.slice(0, -3)}`, description: fm.description || '', source, file });
  }
  return out;
}

function agentsIn(dir, source) {
  const out = [];
  for (const e of listDir(dir)) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const file = path.join(dir, e.name);
    const fm = frontMatter(readText(file));
    out.push({ name: fm.name || e.name.slice(0, -3), description: fm.description || '', source, file });
  }
  return out;
}

// hooks: { Event: [{ matcher, hooks: [{ type, command | url | prompt }] }] }
function hooksIn(hooks, source, file = null) {
  const out = [];
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
        if (!h || typeof h !== 'object') continue;
        const target = h.command || h.url || h.prompt || '';
        out.push({
          event,
          matcher: g.matcher || '',
          type: h.type || 'command',
          target: String(target).slice(0, 300),
          source,
          file,
          omni: /omni-agent-terminal\/claude-hook\.sh/.test(String(target)),
        });
      }
    }
  }
  return out;
}

function mcpIn(servers, source, file = null) {
  if (!servers || typeof servers !== 'object') return [];
  return Object.entries(servers).map(([name, s]) => ({
    name,
    type: (s && (s.type || (s.url ? 'http' : 'stdio'))) || 'stdio',
    description: s && (s.url || [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter(Boolean).join(' ')) || '',
    source,
    file,
  }));
}

/**
 * @param {object} o
 * @param {string} o.claudeDir   ~/.claude (or CLAUDE_CONFIG_DIR) as this host can read it
 * @param {string} o.claudeJson  ~/.claude.json as this host can read it
 * @param {string|null} o.cwd    the terminal's folder as this host can read it
 * @param {(p: string) => string} [o.mapPath] maps paths stored inside the
 *        config (plugin installPath) to readable ones, e.g. WSL -> \\wsl.localhost
 */
function scanClaudeConfig({ claudeDir, claudeJson, cwd, mapPath = (p) => p }) {
  const project = cwd ? projectRoot(cwd) : null;
  const pc = project ? path.join(project, '.claude') : null;

  const userFile = path.join(claudeDir, 'settings.json');
  const projFile = pc && path.join(pc, 'settings.json');
  const localFile = pc && path.join(pc, 'settings.local.json');
  const userSettings = readJson(userFile) || {};
  const projSettings = (pc && readJson(projFile)) || {};
  const localSettings = (pc && readJson(localFile)) || {};

  // enabledPlugins: later scopes override earlier ones.
  const enabled = { ...userSettings.enabledPlugins, ...projSettings.enabledPlugins, ...localSettings.enabledPlugins };

  const plugins = [];
  const record = readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'));
  const installed = record && record.plugins && typeof record.plugins === 'object' ? record.plugins : {};
  for (const [id, entries] of Object.entries(installed)) {
    const list = Array.isArray(entries) ? entries : [entries];
    const e = list.find((x) => x && x.installPath) || list[0] || {};
    const [name, marketplace] = id.split('@');
    const dir = e.installPath ? mapPath(e.installPath) : null;
    plugins.push({
      id, name, marketplace: marketplace || '',
      version: e.version || '',
      scope: e.scope || '',
      enabled: enabled[id] === true,
      dir,
      // What to read for a plugin: its README, else its manifest.
      file: dir ? [path.join(dir, 'README.md'), path.join(dir, '.claude-plugin', 'plugin.json')].find(isFile) || null : null,
    });
  }
  // Enabled in settings but not installed (e.g. not fetched yet).
  for (const [id, on] of Object.entries(enabled)) {
    if (on === true && !installed[id]) {
      const [name, marketplace] = id.split('@');
      plugins.push({ id, name, marketplace: marketplace || '', version: '', scope: '', enabled: true, dir: null, missing: true });
    }
  }

  const skills = [
    ...skillsIn(path.join(claudeDir, 'skills'), '사용자'),
    ...commandsIn(path.join(claudeDir, 'commands'), '사용자'),
    ...(pc ? [...skillsIn(path.join(pc, 'skills'), '프로젝트'), ...commandsIn(path.join(pc, 'commands'), '프로젝트')] : []),
  ];
  const agents = [
    ...agentsIn(path.join(claudeDir, 'agents'), '사용자'),
    ...(pc ? agentsIn(path.join(pc, 'agents'), '프로젝트') : []),
  ];
  const hooks = [
    ...hooksIn(userSettings.hooks, '사용자', userFile),
    ...hooksIn(projSettings.hooks, '프로젝트', projFile),
    ...hooksIn(localSettings.hooks, '로컬', localFile),
  ];
  const cj = readJson(claudeJson) || {};
  const projEntry = project && cj.projects && typeof cj.projects === 'object'
    ? Object.entries(cj.projects).find(([p]) => path.resolve(mapPath(p)) === path.resolve(project))
    : null;
  const mcp = [
    ...mcpIn(cj.mcpServers, '사용자', claudeJson),
    ...mcpIn(projEntry && projEntry[1] && projEntry[1].mcpServers, '로컬', claudeJson),
    ...(project ? mcpIn((readJson(path.join(project, '.mcp.json')) || {}).mcpServers, '프로젝트', path.join(project, '.mcp.json')) : []),
  ];

  // Only enabled plugins contribute.
  for (const p of plugins) {
    if (!p.enabled || !p.dir) continue;
    const src = `플러그인 ${p.name}`;
    skills.push(...skillsIn(path.join(p.dir, 'skills'), src).map((s) => ({ ...s, name: `${p.name}:${s.name}` })));
    skills.push(...commandsIn(path.join(p.dir, 'commands'), src).map((s) => ({ ...s, name: `/${p.name}:${s.name.slice(1)}` })));
    agents.push(...agentsIn(path.join(p.dir, 'agents'), src).map((a) => ({ ...a, name: `${p.name}:${a.name}` })));
    hooks.push(...hooksIn((readJson(path.join(p.dir, 'hooks', 'hooks.json')) || {}).hooks, src, path.join(p.dir, 'hooks', 'hooks.json')));
    mcp.push(...mcpIn((readJson(path.join(p.dir, '.mcp.json')) || {}).mcpServers, src, path.join(p.dir, '.mcp.json')));
  }

  const cap = (a) => a.slice(0, MAX_ITEMS);
  return {
    project,
    skills: cap(skills),
    plugins: cap(plugins.map(({ dir, ...rest }) => rest)),
    hooks: cap(hooks),
    agents: cap(agents),
    mcp: cap(mcp),
  };
}

module.exports = { scanClaudeConfig, frontMatter, projectRoot };
