'use strict';

// Adding allow rules (the "돌아보기" tab) to a project's
// .claude/settings.local.json: the project-local settings, "You, in this one
// project only" (https://code.claude.com/docs/en/settings, verified 2026-11).
// Claude Code keeps that file out of git only when it creates the file
// itself; one created here would not be, so when git does not ignore it the
// file is added to the repository's .git/info/exclude (this computer only,
// never committed).
//
// `project`: the folder as Claude sees it (a Linux path inside WSL); `host`:
// the same folder as this app reads it; `toHost` maps a path of the former
// kind to the latter.

const fs = require('node:fs');
const path = require('node:path');

const REL = '.claude/settings.local.json';
const EXCLUDE_LINE = '**/.claude/settings.local.json';

const fileOf = (host) => path.join(host, '.claude', 'settings.local.json');
const shownOf = (project) => `${String(project).replace(/[\\/]+$/, '')}${/^[a-zA-Z]:|\\/.test(project) ? '\\.claude\\settings.local.json' : `/${REL}`}`;

async function readSettings(file) {
  let text;
  try { text = await fs.promises.readFile(file, 'utf8'); } catch { return { exists: false, data: {} }; }
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? { exists: true, data } : { exists: true, error: true };
  } catch { return { exists: true, error: true }; }
}

const allowOf = (data) => (data.permissions && Array.isArray(data.permissions.allow) ? data.permissions.allow.filter((x) => typeof x === 'string') : []);

// The rules already allowed in a project's local settings.
async function allowedIn(host) {
  const r = await readSettings(fileOf(host));
  return new Set(r.error ? [] : allowOf(r.data));
}

// Whether git ignores the file: true, false, or null (not a repository, no git).
async function ignored(target, runGit) {
  const r = await runGit(['check-ignore', '-q', REL], target);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  return null;
}

// What adding `rules` would do, for the confirmation: { file, exists,
// allow (now), add (new ones), ignored, error }.
async function previewAllow({ project, host, rules, target, runGit }) {
  const r = await readSettings(fileOf(host));
  if (r.error) return { file: shownOf(project), error: '설정 파일이 올바른 JSON 이 아니라 고치지 않습니다' };
  const allow = allowOf(r.data);
  return {
    file: shownOf(project),
    exists: r.exists,
    allow,
    add: rules.filter((x, i) => typeof x === 'string' && !allow.includes(x) && rules.indexOf(x) === i),
    ignored: await ignored(target, runGit),
  };
}

// Adds the rules (other settings kept as they are) and, when git does not
// ignore the file, excludes it locally. -> { added, file, excluded } or { error }
async function addAllow({ project, host, rules, target, runGit, toHost = (p) => p }) {
  const file = fileOf(host);
  const r = await readSettings(file);
  if (r.error) return { error: '설정 파일이 올바른 JSON 이 아니라 고치지 않습니다' };
  const data = r.data;
  const allow = allowOf(data);
  const add = rules.filter((x, i) => typeof x === 'string' && x && !allow.includes(x) && rules.indexOf(x) === i);
  let excluded = false;
  if (add.length) {
    data.permissions = data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions) ? data.permissions : {};
    data.permissions.allow = [...(Array.isArray(data.permissions.allow) ? data.permissions.allow : []), ...add];
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  }
  if ((await ignored(target, runGit)) === false) excluded = await excludeLocally(project, target, runGit, toHost);
  return { added: add.length, file: shownOf(project), excluded };
}

async function excludeLocally(project, target, runGit, toHost) {
  const r = await runGit(['rev-parse', '--git-path', 'info/exclude'], target);
  const rel = r.ok ? r.stdout.trim() : '';
  if (!rel) return false;
  const abs = /^([a-zA-Z]:|[\\/])/.test(rel) ? rel : `${String(project).replace(/[\\/]+$/, '')}/${rel}`;
  const file = toHost(abs) || abs;
  let text = '';
  try { text = await fs.promises.readFile(file, 'utf8'); } catch { /* none yet */ }
  if (text.split(/\r?\n/).includes(EXCLUDE_LINE)) return true;
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}${EXCLUDE_LINE}\n`);
    return true;
  } catch { return false; }
}

module.exports = { allowedIn, previewAllow, addAllow, EXCLUDE_LINE };
