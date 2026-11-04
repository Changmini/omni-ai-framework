'use strict';

const os = require('node:os');
const { StatusTracker } = require('./status');

function defaultShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: env.SHELL || '/bin/bash', args: ['-l'] };
}

// Owns one PTY per agent. `spawn` is node-pty's spawn (injected for tests);
// `emit(channel, payload)` forwards events to the renderer.
class SessionManager {
  constructor({ spawn, emit, shell = defaultShell(), now = Date.now, pollMs = 500 }) {
    this.spawn = spawn;
    this.emit = emit;
    this.shell = shell;
    this.now = now;
    this.sessions = new Map();
    this.nextId = 1;
    this.timer = pollMs > 0 ? setInterval(() => this.pollStatus(), pollMs) : null;
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  create({ name, cwd, command = 'claude', cols = 100, rows = 30 } = {}) {
    const id = String(this.nextId++);
    const dir = cwd && cwd.trim() ? cwd.trim() : os.homedir();
    const pty = this.spawn(this.shell.file, this.shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: dir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    const tracker = new StatusTracker({ now: this.now });
    const session = {
      id,
      name: name && name.trim() ? name.trim() : `agent-${id}`,
      cwd: dir,
      command: command.trim(),
      pty,
      tracker,
      lastStatus: null,
    };
    this.sessions.set(id, session);

    pty.onData((data) => {
      tracker.onOutput(data);
      this.emit('session:data', { id, data });
    });
    pty.onExit(({ exitCode }) => {
      tracker.onExit();
      this.emit('session:exit', { id, exitCode });
      this.pollStatus();
    });

    // Typed into the shell rather than spawned directly, so the shell stays
    // open after the agent exits and its output remains readable.
    if (session.command) pty.write(`${session.command}\r`);
    return this.describe(session);
  }

  // Raw keystrokes from xterm.js.
  write(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.tracker.exited) return false;
    if (/[\r\n]/.test(data)) s.tracker.onInput();
    s.pty.write(data);
    return true;
  }

  // A prompt from the sidebar: text first, Enter as a separate write so a
  // full-screen program receives it as a submit rather than part of a paste.
  sendLine(id, text) {
    if (!this.write(id, text)) return false;
    return this.write(id, '\r');
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.tracker.exited) return;
    if (cols > 0 && rows > 0) s.pty.resize(cols, rows);
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (!s.tracker.exited) s.pty.kill();
    this.sessions.delete(id);
    this.emit('session:removed', { id });
    return true;
  }

  killAll() {
    for (const id of [...this.sessions.keys()]) this.kill(id);
    if (this.timer) clearInterval(this.timer);
  }

  list() {
    return [...this.sessions.values()].map((s) => this.describe(s));
  }

  describe(s) {
    return {
      id: s.id,
      name: s.name,
      cwd: s.cwd,
      command: s.command,
      status: s.tracker.status,
      error: s.tracker.error,
    };
  }

  pollStatus() {
    for (const s of this.sessions.values()) {
      const status = s.tracker.status;
      const key = `${status}|${s.tracker.error || ''}`;
      if (key !== s.lastStatus) {
        s.lastStatus = key;
        this.emit('session:status', { id: s.id, status, error: s.tracker.error });
      }
    }
  }
}

module.exports = { SessionManager, defaultShell };
