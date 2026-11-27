'use strict';

// Runs the automation rules (the 자동화 tab) on Claude Code hook events of a
// terminal's main session. Rules are data the page compiles and sends
// (set()); what one does is either
// - part of the hook's answer (reply(): text for Claude, block, ask), which
//   Claude Code reads for UserPromptSubmit, PreToolUse and PostToolUse
//   (https://code.claude.com/docs/en/hooks; verified on 2.1.331), or
// - work for the page (onEvent(): fill another terminal's input, mark the
//   sidebar), sent as a `rules:fire` message, or
// - a text kept in the 자동화 결과 tab (onEvent(): `result`, through
//   record()).
// Every run is also reported to the page (hit count, the ⚡ mark). Timer
// rules (event `timer`) are not run here: timers() lists them for
// src/automation.js. State is kept in memory for this app run.
const RuleLogic = require('./renderer/rule-logic');

const MAX_RULES = 200;
const MAX_TEXT = 8000; // Claude Code caps a hook's additionalContext at 10,000 characters
const MAX_TERMINALS = 500;
const RECENT = 30; // events kept for the tab's 시험
const RECENT_TEXT = 2000;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// One rule from the page, or null when it is not one.
function compile(r) {
  if (!r || typeof r !== 'object' || !RuleLogic.EVENTS[r.event]) return null;
  const a = r.action && typeof r.action === 'object' ? r.action : {};
  if (!RuleLogic.ACTIONS[a.kind]) return null;
  const cond = r.cond && typeof r.cond === 'object' ? r.cond : {};
  return {
    id: str(r.id, 40),
    name: str(r.name, 60),
    enabled: r.enabled === true,
    event: r.event,
    every: RuleLogic.everyHours(r.every),
    cond: { kind: ['text', 'regex'].includes(cond.kind) ? cond.kind : 'none', value: str(cond.value, 500) },
    terminals: Array.isArray(r.terminals) ? r.terminals.slice(0, MAX_TERMINALS).map((t) => str(String(t), 20)) : null,
    agent: str(r.agent, 200).trim() || null,
    action: {
      kind: a.kind, text: str(a.text, MAX_TEXT), target: a.target == null ? null : str(String(a.target), 20), send: a.send === true,
      preset: RuleLogic.PRESETS[a.preset] ? a.preset : '',
    },
    freq: RuleLogic.FREQS[r.freq] ? r.freq : 'every',
  };
}

function textMap(map) {
  const out = new Map();
  if (map && typeof map === 'object') {
    for (const [id, text] of Object.entries(map).slice(0, MAX_TERMINALS)) {
      if (typeof text === 'string' && text && id.length <= 20) out.set(id, text.slice(0, MAX_TEXT));
    }
  }
  return out;
}

class Rules {
  // emit(channel, payload) to the page; meta(terminalId, sessionId, cwd)
  // gives { branch, cwd } for the terminal's main session, null for any other;
  // record({ ruleId, ruleName, terminal, text }) keeps a `result` text.
  constructor({ emit = () => {}, meta = () => ({}), record = () => {}, now = Date.now } = {}) {
    this.emit = emit;
    this.record = record;
    this.meta = meta;
    this.now = now;
    this.rules = [];
    this.names = new Map(); // terminal id -> name shown in the sidebar
    this.pipeline = new Map(); // terminal id -> its pipeline nodes as text
    this.seen = new Map(); // `${rule}|${terminal}|${session}` -> last text given
    this.recent = [];
  }

  // The page's state: { rules, names, pipeline }, replacing the last one.
  set(state) {
    const s = state && typeof state === 'object' ? state : {};
    this.rules = (Array.isArray(s.rules) ? s.rules.slice(0, MAX_RULES) : []).map(compile).filter(Boolean);
    const names = new Map();
    if (s.names && typeof s.names === 'object') {
      for (const [id, n] of Object.entries(s.names).slice(0, MAX_TERMINALS)) if (typeof n === 'string') names.set(id, n.slice(0, 200));
    }
    this.names = names;
    this.pipeline = textMap(s.pipeline);
  }

  vars(id, ev) {
    const m = this.meta(id, String(ev.session_id || ''), typeof ev.cwd === 'string' ? ev.cwd : '');
    if (!m) return null; // not the terminal's main session
    return RuleLogic.vars(ev, { ...m, terminal: this.names.get(id) || '' });
  }

  // Whether `rule` gives `text` again in this session: every time, once per
  // session, or when the text differs from what it gave last.
  due(rule, id, ev, text) {
    if (rule.freq === 'every') return true;
    const key = `${rule.id}|${id}|${ev.session_id || ''}`;
    if (this.seen.has(key) && (rule.freq === 'once' || this.seen.get(key) === text)) return false;
    this.seen.set(key, text);
    return true;
  }

  fire(rule, id, extra = {}) {
    this.emit('rules:fire', { ruleId: rule.id, source: id, kind: rule.action.kind, ...extra });
  }

  // The hookSpecificOutput fields for hook event `ev` of terminal `id`
  // (UserPromptSubmit, PreToolUse, PostToolUse of the main session), or null.
  // Texts for Claude are joined; a block wins over an ask. A subagent's tool
  // call (agent_id, same session_id) gets the blocks and asks only: a
  // command it runs is the session's command, while text for Claude is
  // meant for the session the user talks to.
  reply(id, ev) {
    const v = this.vars(id, ev);
    if (!v) return null;
    const context = [];
    const reasons = [];
    let decision = null;
    for (const rule of this.rules) {
      if (!RuleLogic.ACTIONS[rule.action.kind].reply || !RuleLogic.fires(rule, ev, id)) continue;
      const kind = rule.action.kind;
      if (ev.agent_id && kind !== 'block' && kind !== 'ask') continue;
      const text = kind === 'pipeline' ? this.pipeline.get(id) || '' : RuleLogic.fillText(rule.action.text, v).trim();
      if (kind === 'block' || kind === 'ask') {
        decision = decision === 'deny' || kind === 'block' ? 'deny' : 'ask';
        reasons.push(text || (kind === 'block' ? '자동화 규칙이 이 실행을 막았습니다.' : '자동화 규칙이 실행 전 확인을 요청했습니다.'));
      } else {
        if (!text || !this.due(rule, id, ev, text)) continue;
        context.push(text);
      }
      this.fire(rule, id);
    }
    if (!context.length && !decision) return null;
    const out = {};
    if (context.length) out.additionalContext = context.join('\n\n').slice(0, MAX_TEXT);
    if (decision) {
      out.permissionDecision = decision;
      out.permissionDecisionReason = reasons.join('\n').slice(0, MAX_TEXT);
    }
    return out;
  }

  // Every hook event of terminal `id`: runs the rules whose work is the
  // page's, keeps it for 시험, and forgets after a compaction what Claude
  // was given in that session (its summary may have dropped it).
  onEvent(id, ev) {
    if (!ev || ev.agent_id) return;
    const v = this.vars(id, ev);
    if (!v) return;
    const sid = String(ev.session_id || '');
    if (ev.hook_event_name === 'PostCompact') {
      for (const key of [...this.seen.keys()]) if (key.endsWith(`|${id}|${sid}`)) this.seen.delete(key);
    }
    if (RuleLogic.EVENT_OF_HOOK[ev.hook_event_name]) {
      const keep = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x).slice(0, RECENT_TEXT)]));
      this.recent.push({ at: this.now(), terminal: id, hook: ev.hook_event_name, subject: RuleLogic.subject(ev).slice(0, RECENT_TEXT), vars: keep });
      if (this.recent.length > RECENT) this.recent.shift();
    }
    for (const rule of this.rules) {
      if (RuleLogic.ACTIONS[rule.action.kind].reply || !RuleLogic.fires(rule, ev, id)) continue;
      if (rule.action.kind === 'result') {
        const text = RuleLogic.fillText(rule.action.text, v).trim();
        if (!text || !this.due(rule, id, ev, text)) continue;
        this.record({ ruleId: rule.id, ruleName: rule.name, terminal: this.names.get(id) || '', cwd: v.cwd, text });
        this.fire(rule, id);
      } else if (rule.action.kind === 'fill') {
        const text = RuleLogic.fillText(rule.action.text, v).trim();
        if (!rule.action.target || !text || !this.due(rule, id, ev, text)) continue;
        this.fire(rule, id, { target: rule.action.target, text, send: rule.action.send });
      } else if (this.due(rule, id, ev, '')) {
        this.fire(rule, id);
      }
    }
  }

  recentEvents() {
    return this.recent.slice();
  }

  // The enabled timer rules (src/automation.js runs them).
  timers() {
    return this.rules.filter((r) => r.enabled && r.event === 'timer' && r.action.kind === 'agent');
  }

  rule(id) {
    return this.rules.find((r) => r.id === id) || null;
  }
}

module.exports = { Rules, compile, MAX_TEXT };
