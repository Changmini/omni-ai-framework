'use strict';

// Pure status logic, no Electron or PTY imports, so it runs under `node --test`.
//
// Status values shown as LEDs in the sidebar:
//   working - the terminal printed something within ACTIVE_MS
//   idle    - alive, but quiet for ACTIVE_MS
//   error   - an ERROR_PATTERNS line appeared since the last user input
//   exited  - the shell process ended

const ACTIVE_MS = 1500;

// Lines that turn the LED red. They match common shell and Node errors only;
// they are not tied to any Claude Code output format.
const ERROR_PATTERNS = [
  /\bE[A-Z]{3,}\b.*\b(in use|refused|not found)\b/i, // EADDRINUSE ..., ECONNREFUSED ...
  /\bError: /,
  /is not recognized as (the name of a cmdlet|an internal or external command)/, // PowerShell / cmd
  /command not found/,
  /Permission denied/,
];

// CSI, OSC and two-byte escape sequences.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

function findError(text, patterns = ERROR_PATTERNS) {
  // Last match wins: a terminal echoes the typed command before its output,
  // so the most recent matching line is the real error.
  const lines = stripAnsi(text).split(/\r?\n|\r/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (patterns.some((re) => re.test(lines[i]))) return lines[i].trim();
  }
  return null;
}

class StatusTracker {
  constructor({ now = Date.now, activeMs = ACTIVE_MS, patterns = ERROR_PATTERNS } = {}) {
    this.now = now;
    this.activeMs = activeMs;
    this.patterns = patterns;
    this.lastOutputAt = 0;
    this.error = null; // last matching line, cleared by user input
    this.exited = false;
    this.tail = ''; // keeps a partial line across chunks
  }

  onOutput(chunk) {
    this.lastOutputAt = this.now();
    const text = this.tail + chunk;
    const cut = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
    const complete = cut >= 0 ? text.slice(0, cut + 1) : '';
    this.tail = (cut >= 0 ? text.slice(cut + 1) : text).slice(-4096);
    const hit = findError(complete, this.patterns);
    if (hit) this.error = hit;
  }

  onInput() {
    this.error = null;
  }

  onExit() {
    this.exited = true;
  }

  get status() {
    if (this.exited) return 'exited';
    if (this.error) return 'error';
    return this.now() - this.lastOutputAt < this.activeMs ? 'working' : 'idle';
  }
}

module.exports = { ACTIVE_MS, ERROR_PATTERNS, StatusTracker, findError, stripAnsi };
