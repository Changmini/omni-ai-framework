'use strict';

const os = require('node:os');
const { StatusTracker } = require('./status');
const { emptyState, reduce, withTeam } = require('./agent-state');
const { wslToWindows } = require('./wsl');

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
    scanConfig = () => null,
    claudePaths = { dir: null, json: null },
  }) {
    this.spawn = spawn;
    this.emit = emit;
    this.shell = shell;
    this.extraEnv = extraEnv;
    this.now = now;
    this.readTeam = readTeam;
    this.readTasks = readTasks;
    this.gitBranch = gitBranch;
    this.scanConfig = scanConfig;
    this.claudePaths = claudePaths;
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
      claude: emptyState(), // the terminal's main claude session
      primarySid: null,
      others: new Map(), // session_id -> other claude sessions shown here (split-pane teammates in tmux)
      wsl: null, // { distro, home } while the shell runs inside WSL
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
      session.primarySid = null;
      session.others.clear();
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

  // A folder report from the shell integration (POST /cwd). Inside WSL it
  // also names the distro and home, so Linux paths can be read from Windows.
  reportShellCwd(id, { cwd, wslDistro, home } = {}) {
    const s = this.sessions.get(id);
    if (!s || typeof cwd !== 'string' || !cwd) return;
    s.wsl = wslDistro ? { distro: String(wslDistro), home: typeof home === 'string' ? home : null } : null;
    this.setCwd(id, cwd);
  }

  // Where this host can read a path the shell or Claude reported.
  hostPath(s, p) {
    return (s.wsl && wslToWindows(p, s.wsl.distro)) || p;
  }

  // The shell reported its folder (prompt integration) or Claude's hook did.
  setCwd(id, dir) {
    const s = this.sessions.get(id);
    if (!s || !dir) return;
    const branch = this.gitBranch(this.hostPath(s, dir));
    if (dir === s.cwd && branch === s.branch) return;
    s.cwd = dir;
    s.branch = branch;
    this.emit('session:meta', { id, cwd: s.cwd, branch: s.branch });
  }

  // Skills, plugins, hooks, subagents and MCP servers Claude would load in
  // this terminal's project. Inside WSL, read from the Linux home.
  claudeConfig(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    const w = s.wsl && s.wsl.home ? s.wsl : null;
    const home = w ? w.home.replace(/\/$/, '') : null;
    return this.scanConfig({
      claudeDir: w ? wslToWindows(`${home}/.claude`, w.distro) : this.claudePaths.dir,
      claudeJson: w ? wslToWindows(`${home}/.claude.json`, w.distro) : this.claudePaths.json,
      cwd: this.hostPath(s, s.cwd),
      mapPath: w ? (p) => wslToWindows(p, w.distro) || p : (p) => p,
    });
  }

  // A name the user gave the terminal; empty goes back to the folder name.
  // The sidebar order, so a page reload lists terminals the same way.
  // Unknown ids are ignored; terminals missing from `ids` keep their place at the end.
  reorder(ids) {
    if (!Array.isArray(ids)) return false;
    const next = new Map();
    for (const id of ids) if (this.sessions.has(id) && !next.has(id)) next.set(id, this.sessions.get(id));
    for (const [id, s] of this.sessions) if (!next.has(id)) next.set(id, s);
    this.sessions = next;
    return true;
  }

  rename(id, name) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const n = typeof name === 'string' ? name.trim().slice(0, 80) : '';
    s.name = n || null;
    this.emit('session:meta', { id, name: s.name });
    return true;
  }

  // One Claude Code hook event, already authenticated by the hook server.
  onHookEvent(id, ev, meta = {}) {
    const s = this.sessions.get(id);
    if (!s) return;
    const sid = ev.session_id || '';
    // Several claude sessions can report into one terminal through tmux: the
    // first that is not a teammate is the main one (LED, banner); the others,
    // e.g. split-pane teammates, which arrive as their own sessions carrying
    // agent_type but no agent_id (seen on 2.1.318), are listed beside it.
    const teammateSession = Boolean(ev.agent_type && !ev.agent_id);
    if (sid && sid !== s.primarySid && (s.primarySid || teammateSession)) {
      this.onOtherSession(s, sid, ev, meta, teammateSession);
      this.emitAgent(s);
      return;
    }
    if (sid && !s.primarySid) s.primarySid = sid;
    s.claude = reduce(s.claude, ev, this.now());
    if (ev.hook_event_name === 'SessionEnd') {
      s.team = null;
      s.tasks = null;
      s.primarySid = null;
    }
    // The main agent's turn ended with nothing left running: teammates are gone.
    if (ev.hook_event_name === 'Stop' && !ev.agent_id && Array.isArray(ev.background_tasks) && ev.background_tasks.length === 0) {
      for (const [k, o] of s.others) if (o.teammate) s.others.delete(k);
    }
    if (/^(Task|Teammate|Subagent)/.test(ev.hook_event_name || '')) this.refreshTeam(s);
    if (ev.cwd) this.setCwd(id, ev.cwd);
    if (ev.hook_event_name === 'Stop') this.setCwd(id, s.cwd); // branch may have changed
    this.emitAgent(s);
  }

  onOtherSession(s, sid, ev, meta, teammateSession) {
    if (ev.hook_event_name === 'SessionEnd') { s.others.delete(sid); return; }
    const prev = s.others.get(sid) || { state: emptyState(), name: null, teammate: false, pane: null };
    const title = /^@\S/.test(meta.title || '') ? meta.title.slice(1) : null; // "@planner"
    s.others.set(sid, {
      state: reduce(prev.state, ev, this.now()),
      pane: meta.pane || prev.pane,
      teammate: prev.teammate || teammateSession || ev.hook_event_name === 'TeammateIdle',
      name: (ev.hook_event_name === 'TeammateIdle' && ev.teammate_name) || prev.name || title || null,
      type: prev.type || ev.agent_type || null,
    });
  }

  refreshTeam(s) {
    const sid = s.claude.sessionId;
    // Claude inside WSL keeps its files under the Linux home.
    const base = s.wsl && s.wsl.home ? wslToWindows(`${s.wsl.home.replace(/\/$/, '')}/.claude`, s.wsl.distro) : undefined;
    s.team = s.claude.status ? this.readTeam(sid, base || undefined) : null;
    s.tasks = s.claude.status ? this.readTasks(sid, base || undefined) : null;
  }

  agentView(s) {
    const others = [...s.others].map(([sid, o]) => ({
      id: `session:${sid}`,
      name: o.name || (o.teammate ? o.type : null) || `claude ${o.pane || sid.slice(0, 8)}`,
      type: o.type,
      status: o.state.status || 'idle',
      tool: o.state.tool,
      teammate: o.teammate,
    }));
    // Teammates already listed as their own sessions are not repeated from the config.
    const names = new Set(others.map((o) => o.name));
    const team = s.team ? { ...s.team, members: s.team.members.filter((m) => !names.has(m.name)) } : null;
    const view = withTeam(s.claude, team);
    const hasTeammates = others.some((o) => o.teammate) || Boolean(team && team.members.some((m) => m.agentType !== 'team-lead'));
    return {
      status: view.status,
      tool: view.tool,
      message: view.message,
      // A lead alone is not shown as a team (the config exists from startup).
      team: hasTeammates ? (s.team ? s.team.name : `session-${(s.primarySid || '').slice(0, 8)}`) : null,
      agents: [...Object.entries(view.agents).map(([agentId, a]) => ({ id: agentId, ...a })), ...others],
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
