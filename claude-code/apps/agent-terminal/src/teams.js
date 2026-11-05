'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Agent team and task files written by Claude Code. Layout from
// https://code.claude.com/docs/en/agent-teams (team name = "session-" + first
// 8 characters of the lead's session id). Task files ({id, subject, status,
// owner}) were read from disk on Claude Code 2.1.318; their format is not
// documented, so every field is optional here.

function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// -> { name, members: [{ name, agentId, agentType }] } or null
function readTeam(sessionId, base = claudeDir()) {
  if (!sessionId) return null;
  const name = `session-${sessionId.slice(0, 8)}`;
  const cfg = readJson(path.join(base, 'teams', name, 'config.json'));
  if (!cfg || !Array.isArray(cfg.members)) return null;
  const members = cfg.members
    .filter((m) => m && typeof m.name === 'string')
    .map((m) => ({ name: m.name, agentId: m.agentId || m.agent_id || null, agentType: m.agentType || m.agent_type || null }));
  return { name, members };
}

// Tasks of a team, or of a single session when it has no team.
// -> { total, done, inProgress: [subject...] } or null
function readTasks(sessionId, base = claudeDir()) {
  if (!sessionId) return null;
  for (const dirName of [`session-${sessionId.slice(0, 8)}`, sessionId]) {
    const dir = path.join(base, 'tasks', dirName);
    let files;
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
    const tasks = files.map((f) => readJson(path.join(dir, f))).filter((t) => t && typeof t === 'object');
    if (!tasks.length) continue;
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'completed').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').map((t) => ({ subject: String(t.subject || ''), owner: t.owner || null })),
    };
  }
  return null;
}

module.exports = { claudeDir, readTeam, readTasks };
