'use strict';

const os = require('node:os');
const { StatusTracker } = require('./status');
const { emptyState, reduce, withTeam } = require('./agent-state');

const TEAM_POLL_EVERY = 4; // status polls between team/task file reads

// Owns one PTY per terminal plus what Claude reports from inside it.
// `spawn` is node-pty's spawn (injected for tests); `emit(channel, payload)`
// forwards events to the renderer. File readers are injected for tests too.
class SessionManager {
  constructor({
    spawn,
    emit,
    shell,
    extraEnv = {},
    now = Date.now,
    pollMs = 500,
    readTeam = () => null,
    readTasks = () => null,
    gitBranch = () => null,
  }) {
    this.spawn = spawn;
    this.emit = emit;
    this.shell = shell;
    this.extraEnv = extraEnv;
    this.now = now;
    this.readTeam = readTeam;
    this.readTasks = readTasks;
    this.gitBranch = gitBranch;
    this.sessions = new Map();
    this.nextId = 1;
    this.tick = 0;
    this.timer = pollMs > 0 ? setInterval(() => this.pollStatus(), pollMs) : null;
    if (this.timer && this.timer.unref) this.timer.unref();
  }

  create({ name, cwd, command = '', cols = 100, rows = 30 } = {}) {
    const id = String(this.nextId++);
    const dir = cwd && cwd.trim() ? cwd.trim() : os.homedir();
    const pty = this.spawn(this.shell.file, this.shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: dir,
      env: {
        ...process.env,
        ...this.shell.env,
        ...this.extraEnv,
        OMNI_TERMINAL_ID: id,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
    const session = {
      id,
      name: name && name.trim() ? name.trim() : null, // null: named after the folder
      cwd: dir,
      branch: this.gitBranch(dir),
      command: command.trim(),
      pty,
      tracker: new StatusTracker({ now: this.now }),
      lastStatus: null,
      claude: emptyState(),
      team: null,
      tasks: null,
      lastAgent: null,
    };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.tracker.onOutput(data);
      this.emit('session:data', { id, data });
    });
    pty.onExit(({ exitCode }) => {
      session.tracker.onExit();
      session.claude = emptyState();
      this.emit('session:exit', { id, exitCode });
      this.pollStatus();
      this.emitAgent(session);
    });

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

  sendLine(id, text) {
    if (!this.write(id, text)) return false;
    return this.write(id, '\r');
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.tracker.exited) return;
    if (cols > 0 && rows > 0) s.pty.resize(cols, rows);
  }

  // The shell reported its folder (prompt integration) or Claude's hook did.
  setCwd(id, dir) {
    const s = this.sessions.get(id);
    if (!s || !dir) return;
    const branch = this.gitBranch(dir);
    if (dir === s.cwd && branch === s.branch) return;
    s.cwd = dir;
    s.branch = branch;
    this.emit('session:meta', { id, cwd: s.cwd, branch: s.branch });
  }

  // One Claude Code hook event, already authenticated by the hook server.
  onHookEvent(id, ev) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.claude = reduce(s.claude, ev, this.now());
    if (ev.hook_event_name === 'SessionEnd') { s.team = null; s.tasks = null; }
    if (/^(Task|Teammate|Subagent)/.test(ev.hook_event_name || '')) this.refreshTeam(s);
    if (ev.cwd) this.setCwd(id, ev.cwd);
    if (ev.hook_event_name === 'Stop') this.setCwd(id, s.cwd); // branch may have changed
    this.emitAgent(s);
  }

  refreshTeam(s) {
    const sid = s.claude.sessionId;
    s.team = s.claude.status ? this.readTeam(sid) : null;
    s.tasks = s.claude.status ? this.readTasks(sid) : null;
  }

  agentView(s) {
    const view = withTeam(s.claude, s.team);
    return {
      status: view.status,
      tool: view.tool,
      message: view.message,
      // A lead alone is not shown as a team (the config exists from startup).
      team: s.team && s.team.members.some((m) => m.agentType !== 'team-lead') ? s.team.name : null,
      agents: Object.entries(view.agents).map(([agentId, a]) => ({ id: agentId, ...a })),
      tasks: s.tasks,
    };
  }

  emitAgent(s) {
    const view = this.agentView(s);
    const key = JSON.stringify(view);
    if (key === s.lastAgent) return;
    s.lastAgent = key;
    this.emit('session:agent', { id: s.id, claude: view });
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
      branch: s.branch,
      command: s.command,
      status: s.tracker.status,
      error: s.tracker.error,
      claude: this.agentView(s),
    };
  }

  pollStatus() {
    const readFiles = this.tick++ % TEAM_POLL_EVERY === 0;
    for (const s of this.sessions.values()) {
      const status = s.tracker.status;
      const key = `${status}|${s.tracker.error || ''}`;
      if (key !== s.lastStatus) {
        s.lastStatus = key;
        this.emit('session:status', { id: s.id, status, error: s.tracker.error });
      }
      if (readFiles && s.claude.status) {
        this.refreshTeam(s);
        this.emitAgent(s);
      }
    }
  }
}

module.exports = { SessionManager };
