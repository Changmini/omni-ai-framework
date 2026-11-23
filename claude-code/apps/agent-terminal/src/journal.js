'use strict';

// The "돌아보기" records: what was asked and approved in app terminals, one
// file per day (<dir>/YYYY-MM-DD.jsonl, a JSON object per line), in the
// app's own data folder on this computer (never in a project). Kept
// KEEP_DAYS days; the tab can delete a day or everything, and turn
// recording off (<dir>/config.json).
//
// Records (k):
//   prompt    { text, sid, project, host, distro }
//   perm      { id, tool, input: { command }, rules, sid, project, host, distro }
//   grant     { id }  - the permission request was approved (its tool ran)
//   interrupt { sid, project }
//   error     { sid, project }

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const logic = require('./journal-logic');

const TEXT_MAX = 2000;
const PENDING_MAX = 200;
const PENDING_MS = 60 * 60 * 1000; // a permission dialog left open that long no longer counts
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

class Journal {
  constructor({ dir, now = Date.now }) {
    this.dir = dir;
    this.now = now;
    this.pending = new Map(); // "sid|tool|input" -> { id, t }
    this.prunedDay = null;
    this.enabled = true;
    try { this.enabled = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).enabled !== false; } catch { /* default on */ }
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    this.pending.clear();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, 'config.json'), JSON.stringify({ enabled: this.enabled }));
    } catch { /* stays as set for this run */ }
    return this.enabled;
  }

  record(entry) {
    if (!this.enabled) return;
    const t = this.now();
    const day = logic.dayOf(t);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, `${day}.jsonl`), `${JSON.stringify({ t, ...entry })}\n`);
    } catch { /* a record lost: nothing else depends on it */ }
    if (this.prunedDay !== day) { this.prunedDay = day; this.prune(); }
  }

  // A hook event of an app terminal. `ctx`: { sid, project, host, distro,
  // primary } (primary: the terminal's main Claude, whose prompts are the
  // user's own).
  onHook(ev, ctx) {
    if (!this.enabled || !ev) return;
    const where = { sid: ctx.sid || null, project: ctx.project || null, host: ctx.host || null, distro: ctx.distro || null };
    const key = () => `${ev.session_id || ''}|${ev.tool_name || ''}|${JSON.stringify(ev.tool_input || {})}`;
    switch (ev.hook_event_name) {
      case 'UserPromptSubmit':
        if (ctx.primary && !ev.agent_id && typeof ev.prompt === 'string' && ev.prompt.trim()) {
          this.record({ k: 'prompt', text: ev.prompt.slice(0, TEXT_MAX), ...where });
        }
        break;
      case 'PermissionRequest': {
        const id = crypto.randomBytes(6).toString('hex');
        const input = ev.tool_input && typeof ev.tool_input.command === 'string' ? { command: ev.tool_input.command.slice(0, TEXT_MAX) } : {};
        this.record({ k: 'perm', id, tool: ev.tool_name || null, input, rules: logic.rulesFor(ev.tool_name, ev.tool_input, ev.permission_suggestions), ...where });
        this.pending.set(key(), { id, t: this.now() });
        if (this.pending.size > PENDING_MAX) this.pending.delete(this.pending.keys().next().value);
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const p = this.pending.get(key());
        if (!p) break;
        this.pending.delete(key());
        if (this.now() - p.t <= PENDING_MS) this.record({ k: 'grant', id: p.id });
        break;
      }
      case 'StopFailure':
        if (ctx.primary && !ev.agent_id) this.record({ k: 'error', ...where });
        break;
      default:
        break;
    }
  }

  onInterrupt(ctx) {
    this.record({ k: 'interrupt', sid: ctx.sid || null, project: ctx.project || null });
  }

  // Days with records, newest first.
  days() {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    return names.map((n) => DAY_FILE.exec(n)).filter(Boolean).map((m) => m[1]).sort().reverse();
  }

  read(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return [];
    let text = '';
    try { text = fs.readFileSync(path.join(this.dir, `${day}.jsonl`), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* a line cut short */ }
    }
    return out;
  }

  // The prompts of the kept days other than `day` (for "on how many days").
  otherPrompts(day) {
    return this.days().filter((d) => d !== day).flatMap((d) => this.read(d).filter((e) => e.k === 'prompt'));
  }

  // One day's records, or all (day null), deleted.
  clear(day = null) {
    const days = day ? [day].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))) : this.days();
    for (const d of days) {
      try { fs.unlinkSync(path.join(this.dir, `${d}.jsonl`)); } catch { /* already gone */ }
    }
    if (!day) this.pending.clear();
    return this.days();
  }

  // Days older than KEEP_DAYS deleted.
  prune() {
    const keep = new Set(logic.keptDays(this.now()));
    for (const d of this.days()) {
      if (!keep.has(d)) {
        try { fs.unlinkSync(path.join(this.dir, `${d}.jsonl`)); } catch { /* already gone */ }
      }
    }
  }
}

module.exports = { Journal };
