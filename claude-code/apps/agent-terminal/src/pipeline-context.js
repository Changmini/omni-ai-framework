'use strict';

// What the Claude in a terminal is told about the pipelines that terminal is
// part of: the renderer builds the text per terminal (ViewLogic.
// pipelineContext) for pipelines with "Claude에게 알리기" on, and the hook
// server hands it to Claude with the user's prompt (UserPromptSubmit reply).
// Every reply costs that session tokens and stays in its context, so a text
// goes once to each Claude session: again only once it changed, or to a new
// session (which never saw it). Kept in memory for this app run.
const MAX_TEXT = 8000; // Claude Code caps a hook's additionalContext at 10,000 characters
const MAX_TERMINALS = 500;

class PipelineContext {
  constructor() {
    this.texts = new Map(); // terminal id -> text
    this.sent = new Map(); // terminal id -> { sid, text } last given to Claude
  }

  // The renderer's whole map (terminal id -> text), replacing the last one.
  set(map) {
    const next = new Map();
    if (map && typeof map === 'object') {
      for (const [id, text] of Object.entries(map).slice(0, MAX_TERMINALS)) {
        if (typeof text === 'string' && text && id.length <= 20) next.set(id, text.slice(0, MAX_TEXT));
      }
    }
    this.texts = next;
  }

  // The text to add to this prompt of session `sid` in terminal `id`, or null.
  forPrompt(id, sid) {
    const text = this.texts.get(id);
    if (!text) return null;
    const last = this.sent.get(id);
    if (last && last.sid === sid && last.text === text) return null;
    this.sent.set(id, { sid, text });
    return text;
  }
}

module.exports = { PipelineContext, MAX_TEXT };
