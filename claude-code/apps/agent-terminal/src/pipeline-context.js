'use strict';

// What the Claude in a terminal is told about the pipelines that terminal is
// part of. The renderer builds two texts per terminal (ViewLogic.
// pipelineContext): `auto`, for pipelines with "Claude에게 알리기" on and
// nodes not taken out, and `demand`, for every bound node. The hook server
// hands them to Claude (reply):
// - auto, with the user's prompt (UserPromptSubmit). Every reply costs that
//   session tokens and stays in its context, so a text goes once to each
//   Claude session: again only once it changed, to a new session (which never
//   saw it), or after a compaction (whose summary may have dropped it).
// - demand, when the app's /omni:pipeline skill runs: typed by the user
//   (UserPromptExpansion) or used by Claude (the Skill tool, PostToolUse).
// The skill comes from src/claude-plugin, loaded by the claude wrapper. Field
// names verified on Claude Code 2.1.331. Kept in memory for this app run.
const MAX_TEXT = 8000; // Claude Code caps a hook's additionalContext at 10,000 characters
const MAX_TERMINALS = 500;
const SKILL = 'omni:pipeline';
const NOT_BOUND = '[Omni Agent Terminal] 이 세션은 파이프라인 노드에 연결되어 있지 않습니다.';

function textMap(map) {
  const out = new Map();
  if (map && typeof map === 'object') {
    for (const [id, text] of Object.entries(map).slice(0, MAX_TERMINALS)) {
      if (typeof text === 'string' && text && id.length <= 20) out.set(id, text.slice(0, MAX_TEXT));
    }
  }
  return out;
}

class PipelineContext {
  constructor() {
    this.auto = new Map(); // terminal id -> text
    this.demand = new Map(); // terminal id -> text
    this.sent = new Map(); // terminal id -> { sid, text } last auto text Claude has
  }

  // The renderer's maps ({ auto, demand }: terminal id -> text), replacing the last ones.
  set(maps) {
    this.auto = textMap(maps && maps.auto);
    this.demand = textMap(maps && maps.demand);
  }

  // The text to add for hook event `ev` of terminal `id`, or null.
  reply(id, ev) {
    const sid = String(ev.session_id || '');
    switch (ev.hook_event_name) {
      case 'UserPromptSubmit':
        // A typed /omni:pipeline gets the full text from its expansion right after.
        if (typeof ev.prompt === 'string' && ev.prompt.trimStart().startsWith(`/${SKILL}`)) return null;
        return this.forPrompt(id, sid);
      case 'UserPromptExpansion':
        return ev.command_name === SKILL ? this.onDemand(id, sid) : null;
      case 'PostToolUse':
        return ev.tool_name === 'Skill' && ev.tool_input && ev.tool_input.skill === SKILL ? this.onDemand(id, sid) : null;
      default:
        return null;
    }
  }

  forPrompt(id, sid) {
    const text = this.auto.get(id);
    if (!text) return null;
    const last = this.sent.get(id);
    if (last && last.sid === sid && last.text === text) return null;
    this.sent.set(id, { sid, text });
    return text;
  }

  // Asked for: always answered. Claude then also has what auto would send.
  onDemand(id, sid) {
    const auto = this.auto.get(id);
    if (auto) this.sent.set(id, { sid, text: auto });
    return this.demand.get(id) || NOT_BOUND;
  }

  // Session `sid` in terminal `id` was compacted: its next prompt gets the auto text again.
  compacted(id, sid) {
    const last = this.sent.get(id);
    if (last && last.sid === sid) this.sent.delete(id);
  }
}

module.exports = { PipelineContext, MAX_TEXT, SKILL, NOT_BOUND };
