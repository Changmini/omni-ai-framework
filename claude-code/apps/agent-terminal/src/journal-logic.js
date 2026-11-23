'use strict';

// What the "돌아보기" tab shows, from the day's records (journal.js): the
// commands approved most (candidates for the allow list) and the requests
// made again and again (candidates for a skill). Pure: no files, no clock.
//
// Allow rules follow https://code.claude.com/docs/en/permissions (verified
// 2026-11): "Bash(npm test *)" allows `npm test` with any arguments; for a
// compound command (&&, ||, ;, |, &) every subcommand must be allowed.

const KEEP_DAYS = 30;
const REPEAT_MAX_LEN = 120; // longer prompts are one-off tasks, not repeated requests
const REPEAT_KEY_MIN = 4; // "응", "ok": too short to say anything
const REPEAT_MIN = 2;
const EXAMPLES = 5;

const pad = (n) => String(n).padStart(2, '0');

// Local calendar day "YYYY-MM-DD" of a time (ms).
function dayOf(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The days kept: today and the KEEP_DAYS - 1 before it.
function keptDays(now, keep = KEEP_DAYS) {
  const out = [];
  const d = new Date(now);
  for (let i = 0; i < keep; i++) {
    out.push(dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime()));
  }
  return out;
}

// A prompt reduced to what makes two requests the same: no case, spaces,
// punctuation or symbols.
function promptKey(text) {
  return String(text).toLowerCase().normalize('NFC').replace(/[\s\p{P}\p{S}]+/gu, '');
}

const isRepeatable = (text) => {
  const t = String(text || '').trim();
  return t.length > 0 && t.length <= REPEAT_MAX_LEN && !t.startsWith('/') && promptKey(t).length >= REPEAT_KEY_MIN;
};

// Prompts grouped as the same request: equal keys, or a key that starts with
// a shorter one ("코드 검토 진행해줘. 사소한 건 빼고" goes with "코드 검토
// 진행해줘"). -> [{ key, text, count, examples: [{ t, text }], project }]
// (count >= REPEAT_MIN, most first). `others`: prompts of the other kept
// days, for `days` (on how many days the request was made).
function groupRepeats(prompts, others = []) {
  const items = prompts.filter((p) => isRepeatable(p.text)).map((p) => ({ ...p, key: promptKey(p.text) }));
  items.sort((a, b) => a.key.length - b.key.length || a.t - b.t);
  const groups = [];
  for (const p of items) {
    const g = groups.find((x) => p.key.startsWith(x.key));
    if (g) g.items.push(p);
    else groups.push({ key: p.key, items: [p] });
  }
  const otherKeys = others.filter((p) => isRepeatable(p.text)).map((p) => ({ key: promptKey(p.text), day: dayOf(p.t) }));
  return groups.filter((g) => g.items.length >= REPEAT_MIN).map((g) => {
    const byText = new Map();
    for (const p of g.items) byText.set(p.text.trim(), (byText.get(p.text.trim()) || 0) + 1);
    const root = g.items.filter((p) => p.key === g.key);
    const text = [...byText].filter(([t]) => root.some((p) => p.text.trim() === t)).sort((a, b) => b[1] - a[1])[0][0];
    const days = new Set([dayOf(g.items[0].t), ...otherKeys.filter((o) => o.key.startsWith(g.key)).map((o) => o.day)]);
    const projects = [...new Set(g.items.map((p) => p.project).filter(Boolean))];
    return {
      key: g.key,
      text,
      count: g.items.length,
      days: days.size,
      project: projects.length === 1 ? projects[0] : null,
      host: projects.length === 1 ? (g.items.find((p) => p.project === projects[0]).host || null) : null,
      examples: [...g.items].sort((a, b) => b.t - a.t).slice(0, EXAMPLES).map((p) => ({ t: p.t, text: p.text.trim() })),
    };
  }).sort((a, b) => b.count - a.count || b.days - a.days);
}

// ---------- allow rules ----------

// Starting a command that could do harm or run anything: never offered.
const DANGER = new Set(['rm', 'rmdir', 'mv', 'dd', 'sudo', 'su', 'doas', 'mkfs', 'shutdown', 'reboot', 'kill', 'pkill',
  'killall', 'chmod', 'chown', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'eval', 'exec', 'xargs', 'env', 'nohup', 'setsid']);
const GIT_DANGER = new Set(['push', 'reset', 'clean', 'rebase', 'restore', 'checkout', 'filter-branch', 'gc', 'prune']);
// Alone (no subcommand or script), these run whatever they are given.
const RUNNERS = new Set(['bash', 'sh', 'zsh', 'fish', 'pwsh', 'powershell', 'python', 'python3', 'node', 'deno', 'bun',
  'ruby', 'perl', 'php', 'npx', 'bunx', 'pnpx', 'cmd', 'wsl', 'docker', 'kubectl', 'git', 'npm', 'pnpm', 'yarn']);

// The words of a Bash rule's pattern: "Bash(npm test *)" -> ["npm", "test"].
function bashWords(rule) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return null;
  return m[1].replace(/:\*$/, '').replace(/\s\*$/, '').trim().split(/\s+/).filter(Boolean);
}

function isDangerous(rule) {
  const w = bashWords(rule);
  if (!w) return false; // other tools: Claude Code's own suggestion, kept
  if (!w.length || w.join(' ').includes('*')) return true;
  const [a, b] = w;
  if (DANGER.has(a)) return true;
  if (a === 'git' && b && GIT_DANGER.has(b)) return true;
  return w.length === 1 && RUNNERS.has(a);
}

// One simple command's prefix: its first word, and the second when that is a
// subcommand ("npm test", "git status"; not an option, a path or a value).
function prefixOf(cmd) {
  const words = cmd.trim().split(/\s+/).filter((x) => !/^\w+=/.test(x) || x.includes('/'));
  if (!words.length) return null;
  const [a, b] = words;
  if (b && (/^[a-z][\w:-]*$/i.test(b) || (RUNNERS.has(a) && /^[\w./-]+$/.test(b) && !b.startsWith('-')))) return `${a} ${b}`;
  return a;
}

// Rules for a Bash command: one per subcommand of a compound command.
function bashRules(command) {
  const parts = String(command || '').split(/&&|\|\||\|&|[;|&\n]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || /[`$(){}<>]/.test(command)) return []; // substitutions, redirections: not guessed
  return [...new Set(parts.map(prefixOf).filter(Boolean).map((p) => `Bash(${p} *)`))];
}

// The allow rules Claude Code suggested with a permission request
// (permission_suggestions: { type: "addRules", behavior: "allow", rules }).
// A rule there may be a string or { toolName, ruleContent }.
function suggestedRules(suggestions) {
  const out = [];
  for (const s of Array.isArray(suggestions) ? suggestions : []) {
    if (!s || s.type !== 'addRules' || s.behavior !== 'allow' || !Array.isArray(s.rules)) continue;
    for (const r of s.rules) {
      if (typeof r === 'string') out.push(r);
      else if (r && typeof r.toolName === 'string') out.push(r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName);
    }
  }
  // Written the way the docs do: "Bash(ls *)" for "Bash(ls:*)".
  return [...new Set(out.map((r) => r.replace(/^Bash\((.*):\*\)$/, 'Bash($1 *)')))];
}

// The rules a permission request stands for: Claude Code's own suggestion,
// else worked out from a Bash command.
function rulesFor(tool, input, suggestions) {
  const s = suggestedRules(suggestions);
  if (s.length) return s;
  return tool === 'Bash' && input ? bashRules(input.command) : [];
}

// Approved requests grouped by project and rule, dangerous ones left out.
// `allowed`: Map project -> Set of rules already in its settings.
// -> [{ project, host, distro, rule, count, example, added }] (most first)
function groupApprovals(entries, allowed = new Map()) {
  const granted = new Set(entries.filter((e) => e.k === 'grant').map((e) => e.id));
  const groups = new Map();
  for (const e of entries) {
    if (e.k !== 'perm' || !granted.has(e.id)) continue;
    for (const rule of e.rules || []) {
      if (isDangerous(rule)) continue;
      const key = `${e.project}\n${rule}`;
      const g = groups.get(key) || { project: e.project || null, host: e.host || null, distro: e.distro || null, rule, count: 0, example: null };
      g.count++;
      g.example = (e.input && e.input.command) || g.example;
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, added: Boolean(allowed.get(g.project) && allowed.get(g.project).has(g.rule)) }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

// Everything the tab shows for one day (and one project, or all).
function summarize(entries, { project = null, others = [], allowed = new Map() } = {}) {
  const projects = [...new Set(entries.map((e) => e.project).filter(Boolean))].sort();
  const mine = project ? entries.filter((e) => e.project === project || e.k === 'grant') : entries;
  const count = (k) => mine.filter((e) => e.k === k).length;
  return {
    projects,
    counts: { prompts: count('prompt'), permissions: count('perm'), interrupts: count('interrupt'), errors: count('error') },
    approvals: groupApprovals(mine, allowed),
    repeats: groupRepeats(mine.filter((e) => e.k === 'prompt'), project ? others.filter((e) => e.project === project) : others)
      .map((g) => ({ ...g, prompt: skillPrompt(g) })),
  };
}

// The text put in Claude's input for "스킬 만들기": one line (a newline
// would send it), no control characters.
function skillPrompt(group) {
  const clean = (s) => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const texts = [...new Set(group.examples.map((x) => clean(x.text)))].slice(0, 3).map((t) => `「${t.length > 80 ? `${t.slice(0, 80)}…` : t}」`);
  return clean(`skill-creator 스킬로, 내가 자주 한 아래 요청을 스킬로 만들어줘: ${texts.join(', ')} (${group.count}회${group.days > 1 ? `, ${group.days}일` : ''}). 예시가 더 필요하면 물어봐.`);
}

module.exports = {
  KEEP_DAYS, dayOf, keptDays, promptKey, groupRepeats, isDangerous, prefixOf, bashRules, suggestedRules, rulesFor,
  groupApprovals, summarize, skillPrompt,
};
