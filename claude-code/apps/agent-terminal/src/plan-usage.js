'use strict';

// Plan usage (the claude.ai "current session" limit) from the status line
// input: rate_limits.five_hour = { used_percentage 0..100, resets_at epoch
// seconds }, documented at https://code.claude.com/docs/en/statusline. It is
// there only on a claude.ai subscription, after the first answer of a
// session, and is dropped once resets_at passes. Account-wide, so the app
// keeps one value: the latest report from any terminal.

function planFromStatus(data) {
  const w = data && data.rate_limits && data.rate_limits.five_hour;
  if (!w || !Number.isFinite(w.used_percentage)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(w.used_percentage)));
  const resetsAt = Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null;
  return { pct, resetsAt };
}

class PlanUsage {
  constructor({ emit, now = Date.now }) {
    this.emit = emit;
    this.now = now;
    this.value = null;
  }

  // A status line report; emits when the shown value changes.
  report(data) {
    const p = planFromStatus(data);
    if (!p) return;
    const prev = this.value;
    this.value = { ...p, at: this.now() };
    if (!prev || prev.pct !== p.pct || prev.resetsAt !== p.resetsAt) this.emit('plan:usage', this.value);
  }

  get() {
    return this.value;
  }
}

module.exports = { planFromStatus, PlanUsage };
