'use strict';

// Timer rules of the 자동화 tab (event `timer`, action `agent`) and the
// 자동화 결과 tab they write to.
//
// Every `minutes`, and once at start for a run missed while the app was
// closed, a timer rule runs Claude in the background (`claude -p`, no tools
// granted) once for each project that has Claude conversations in the period.
// Its input is the requests the user typed there, read from Claude Code's
// conversation files (<claude dir>/projects/*/*.jsonl; the fields used were
// read from files of Claude Code 2.1.332 and are not documented, so every one
// is optional). What Claude answers is kept as a result; results and the time
// of each rule's last run live in the app's data folder.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const RuleLogic = require('./renderer/rule-logic');
const { wslToWindows, decodeOutput } = require('./wsl');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_RESULTS = 100;
const MAX_CATCH_UP = 7 * 24 * HOUR; // a long-closed app reads at most this far back
const MAX_PROMPT = 600; // characters of one request given to the agent
const MAX_HISTORY = 60000; // characters of requests given to the agent per run
const RUN_TIMEOUT = 10 * 60 * 1000;
const TICK = 60 * 1000;
const WSL_START = 'PATH="$HOME/.local/bin:$PATH"; command -v claude >/dev/null 2>&1 || { [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; }; exec claude "$@"';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// ---------- results (the 자동화 결과 tab) ----------

class Results {
  constructor({ file, emit = () => {}, now = Date.now }) {
    this.file = file;
    this.emit = emit;
    this.now = now;
    const saved = readJson(file, []);
    // A run cut off by closing the app is not running any more.
    this.items = (Array.isArray(saved) ? saved : []).map((r) => (r && r.status === 'running' ? { ...r, status: 'failed', error: '앱이 닫혀 끝나지 못했습니다' } : r)).filter(Boolean);
  }

  save() {
    try { writeJson(this.file, this.items); } catch { /* kept in memory */ }
    this.emit(this.items);
  }

  add(entry) {
    const item = { id: `x${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: this.now(), status: 'done', ...entry };
    this.items.unshift(item);
    this.items.length = Math.min(this.items.length, MAX_RESULTS);
    this.save();
    return item;
  }

  update(id, patch) {
    const item = this.items.find((r) => r.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.save();
  }

  remove(id) {
    this.items = this.items.filter((r) => r.id !== id);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  list() {
    return this.items.slice();
  }
}

// ---------- requests from Claude's conversation files ----------

// The request a user line holds, or '' for anything else: tool results,
// text Claude Code adds (isMeta, <local-command-…>, reminders), subagents'
// conversations. A slash command is given as "/name args".
function requestText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain) return '';
  const m = entry.message;
  if (!m || m.role !== 'user') return '';
  let text = '';
  if (typeof m.content === 'string') text = m.content;
  else if (Array.isArray(m.content)) {
    if (m.content.some((c) => c && c.type === 'tool_result')) return '';
    text = m.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n');
  }
  text = text.trim();
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text);
    return `${cmd[1].trim()} ${args ? args[1].trim() : ''}`.trim();
  }
  if (/^<(local-command|system-reminder|bash-|user-memory)/.test(text) || /^Caveat:/.test(text)) return '';
  return text;
}

// Requests made since `since` in the conversation files under `claudeDir`,
// by project folder: Map(cwd -> [{ at, text }]). Files not touched since
// then are not opened. Read line by line without blocking: the files can
// hold hundreds of MB (over \\wsl.localhost, slowly), and the main process
// also carries every terminal's output.
async function readRequests(claudeDir, since) {
  const out = new Map();
  const root = path.join(claudeDir, 'projects');
  let dirs = [];
  try { dirs = (await fs.promises.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = (await fs.promises.readdir(path.join(root, d.name))).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(root, d.name, f);
      try {
        if ((await fs.promises.stat(file)).mtimeMs < since) continue;
      } catch { continue; }
      const stream = fs.createReadStream(file, { encoding: 'utf8' });
      stream.on('error', () => {});
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!/"type"\s*:\s*"user"/.test(line)) continue; // skip the rest unparsed
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          const at = Date.parse(e.timestamp);
          if (!(at >= since) || typeof e.cwd !== 'string') continue;
          const req = requestText(e);
          if (!req) continue;
          if (!out.has(e.cwd)) out.set(e.cwd, []);
          out.get(e.cwd).push({ at, text: req });
        }
      } catch { /* a file that went away or cannot be read: skipped */ }
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at);
  return out;
}

// Skill names found for a project: its .claude/skills and the user's.
function skillNames(projectHost, claudeDir) {
  const names = new Set();
  for (const dir of [projectHost && path.join(projectHost, '.claude', 'skills'), path.join(claudeDir, 'skills')]) {
    if (!dir) continue;
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) names.add(e.name); } catch { /* none */ }
  }
  return [...names].sort();
}

const stamp = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// What the agent is given: the rule's text (its {project}, {period}, {hours},
// {skills} filled), the requests of the period, and for a preset the form of
// the answer.
function buildPrompt(rule, { project, minutes, skills, requests }) {
  const head = RuleLogic.fillText(rule.action.text || '', { project, period: RuleLogic.periodText(minutes), hours: String(Math.max(1, Math.round(minutes / 60))), skills: skills.length ? skills.join(', ') : '없음' }).trim();
  let history = '';
  for (const r of requests.slice().reverse()) { // newest first, so the cap drops the oldest
    const one = r.text.replace(/\s+/g, ' ').slice(0, MAX_PROMPT);
    const line = `- [${stamp(r.at)}] ${one}\n`;
    if (history.length + line.length > MAX_HISTORY) break;
    history = line + history;
  }
  const parts = [head, `## 요청 기록 (${requests.length}개)`, history.trim()];
  if (rule.action.preset === 'skills') {
    parts.push([
      '## 답 형식',
      '도구를 쓰지 말고, 다른 말 없이 아래 형식의 JSON 하나만 출력한다. 추천이 없으면 "skills": [].',
      '{"skills": [{"name": "kebab-case 이름", "title": "한 줄 제목", "why": "스킬로 만들면 좋은 이유", "evidence": ["근거가 된 요청을 정리한 문장"], "count": 되풀이된 횟수}]}',
    ].join('\n'));
  }
  return parts.filter(Boolean).join('\n\n');
}

// The recommendations in the agent's answer, or null when there are none to
// read (the answer is then kept as text).
function parseSkills(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let data;
  try { data = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!data || !Array.isArray(data.skills)) return null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return data.skills.slice(0, 10).map((x) => ({
    name: str(x && x.name, 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill',
    title: str(x && x.title, 120),
    why: str(x && x.why, 600),
    evidence: (Array.isArray(x && x.evidence) ? x.evidence : []).map((e) => str(e, 300)).filter(Boolean).slice(0, 5),
    count: Number.isInteger(x && x.count) && x.count > 0 ? x.count : null,
  })).filter((x) => x.title || x.why);
}

// ---------- running Claude in the background ----------

// Runs `claude -p` in `cwd` (inside WSL distro `distro` when given) with
// `prompt` on stdin; resolves { text, cost } or rejects with a message.
// No tools at all (`--tools ""`, Claude Code 2.1.332): it only reads the
// prompt and answers. The app's hooks are not
// added (that is the terminals' wrapper), so nothing reports back to the app.
function runClaude({ prompt, cwd, distro = null, platform = process.platform, spawnFn = spawn, timeout = RUN_TIMEOUT }) {
  const args = ['-p', '--output-format', 'json', '--max-turns', '3', '--tools', ''];
  let cmd = 'claude';
  let argv = args;
  const opts = { cwd: distro ? undefined : cwd, env: { ...process.env, OMNI_AUTOMATION: '1' }, windowsHide: true };
  for (const k of Object.keys(opts.env)) if (/^OMNI_(TERMINAL|HOOK|CWD_URL|CLAUDE_SETTINGS|PLUGIN_DIR)/.test(k)) delete opts.env[k];
  if (distro && platform === 'win32') {
    // A login bash (not interactive: ~/.bashrc may start tmux or another
    // shell, and claude would then never run) with ~/.local/bin, where the
    // native installer puts claude, and nvm, where npm installs often live.
    cmd = 'wsl.exe';
    argv = ['-d', distro, '--cd', cwd, '-e', 'bash', '-lc', WSL_START, 'claude', ...args];
  } else if (platform === 'win32') {
    opts.shell = true; // claude.cmd from npm
    argv = args.map((a) => (a === '' ? '""' : a));
  }
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnFn(cmd, argv, opts); } catch (err) { reject(new Error(`claude를 실행하지 못했습니다: ${err.message}`)); return; }
    const out = [];
    const errOut = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('시간 초과로 멈췄습니다')); }, timeout);
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => errOut.push(b));
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`claude를 실행하지 못했습니다: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = decodeOutput(Buffer.concat(out));
      const line = stdout.split('\n').map((l) => l.trim()).reverse().find((l) => l.startsWith('{'));
      let res = null;
      try { res = line ? JSON.parse(line) : null; } catch { res = null; }
      if (res && typeof res.result === 'string' && !res.is_error) { resolve({ text: res.result, cost: Number(res.total_cost_usd) || 0 }); return; }
      const why = (res && res.result) || decodeOutput(Buffer.concat(errOut)).trim().split('\n').slice(-3).join(' ') || `종료 코드 ${code}`;
      reject(new Error(String(why).slice(0, 500)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// ---------- the timer ----------

class Automation {
  // rules: the Rules instance (timers(), rule(id)); results: Results;
  // claudeDirs(): [{ dir, distro }] to read (the host's and those of WSL
  // terminals seen); stateFile: where each rule's last run is kept.
  constructor({ rules, results, claudeDirs, stateFile, run = runClaude, now = Date.now, emit = () => {} }) {
    this.rules = rules;
    this.results = results;
    this.claudeDirs = claudeDirs;
    this.stateFile = stateFile;
    this.run = run;
    this.now = now;
    this.emit = emit;
    const s = readJson(stateFile, {});
    this.last = s && typeof s.last === 'object' && s.last ? s.last : {};
    this.busy = new Set();
    this.timer = null;
  }

  saveState() {
    try { writeJson(this.stateFile, { last: this.last }); } catch { /* kept in memory */ }
    this.emit(this.state());
  }

  // { ruleId: { last, running } } for the 자동화 tab.
  state() {
    return Object.fromEntries(this.rules.timers().map((r) => [r.id, { last: this.last[r.id] || null, running: this.busy.has(r.id) }]));
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // Runs each timer rule that is due. A rule never run before starts its
  // clock now; one whose time passed while the app was closed runs once.
  tick() {
    const now = this.now();
    let changed = false;
    for (const rule of this.rules.timers()) {
      const last = this.last[rule.id];
      if (!last) { this.last[rule.id] = now; changed = true; continue; }
      if (now - last >= rule.minutes * MINUTE && !this.busy.has(rule.id)) this.runRule(rule).catch(() => {});
    }
    if (changed) this.saveState();
  }

  runNow(ruleId) {
    const rule = this.rules.rule(ruleId);
    if (!rule || rule.event !== 'timer' || rule.action.kind !== 'agent') return false;
    if (this.busy.has(rule.id)) return false;
    this.runRule(rule, true).catch(() => {});
    return true;
  }

  async runRule(rule, manual = false) {
    const now = this.now();
    const since = Math.max(this.last[rule.id] && !manual ? this.last[rule.id] : now - rule.minutes * MINUTE, now - MAX_CATCH_UP);
    const minutes = Math.max(1, Math.round((now - since) / MINUTE));
    const period = RuleLogic.periodText(minutes);
    this.busy.add(rule.id);
    this.last[rule.id] = now;
    this.saveState();
    try {
      const jobs = [];
      for (const { dir, distro } of this.claudeDirs()) {
        for (const [cwd, requests] of await readRequests(dir, since)) {
          const host = distro ? wslToWindows(cwd, distro) || cwd : cwd;
          jobs.push({ cwd, distro, host, claudeDir: dir, requests });
        }
      }
      if (!jobs.length) {
        if (manual) this.results.add({ ruleId: rule.id, ruleName: rule.name, kind: 'note', text: `지난 ${period} 동안 Claude 대화 기록이 없어 실행하지 않았습니다.` });
        return;
      }
      for (const job of jobs) {
        const prompt = buildPrompt(rule, { project: job.cwd, minutes, skills: skillNames(job.host, job.claudeDir), requests: job.requests });
        const item = this.results.add({
          ruleId: rule.id, ruleName: rule.name, project: job.cwd, distro: job.distro, status: 'running',
          kind: rule.action.preset || 'text', requests: job.requests.length, minutes,
        });
        try {
          const { text, cost } = await this.run({ prompt, cwd: job.cwd, distro: job.distro });
          const skills = rule.action.preset === 'skills' ? parseSkills(text) : null;
          this.results.update(item.id, { status: 'done', text: skills ? '' : text.slice(0, 20000), skills, cost });
        } catch (err) {
          this.results.update(item.id, { status: 'failed', error: String(err.message || err).slice(0, 500) });
        }
      }
    } finally {
      this.busy.delete(rule.id);
      this.emit(this.state());
    }
  }
}

module.exports = { Results, Automation, readRequests, requestText, buildPrompt, parseSkills, runClaude, skillNames, HOUR, MINUTE };
