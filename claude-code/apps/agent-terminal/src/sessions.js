'use strict';

const os = require('node:os');
const path = require('node:path');
const { StatusTracker } = require('./status');
const { emptyState, reduce, withTeam } = require('./agent-state');
const { wslToWindows, windowsToWsl } = require('./wsl');
const { activityEntry, oneLine, ACTIVITY_MAX } = require('./activity');
const gitView = require('./git-view');

const TEAM_POLL_EVERY = 4; // status polls between team/task file checks
const TEAM_IDLE_REREAD_MS = 10000; // re-read team/task files at least this often while claude runs
const USAGE_MIN_MS = 3000; // transcript reads per session, at most this often
const EARLY_MS = 10000; // how long a result that came before its call waits for it
const PANE_CHECK_EVERY = 10; // status polls between checks that tmux panes still exist

const uriPath = (p) => encodeURI(p).replace(/[?#]/g, encodeURIComponent);

// How a claude session listed beside the main one is named (sidebar and log).
const otherName = (o, sid) => o.name || (o.teammate ? o.type : null) || `claude ${o.pane || sid.slice(0, 8)}`;

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
    runTmux = () => Promise.resolve(false),
    listPanes = () => Promise.resolve(null),
    readUsage = () => Promise.resolve(null),
    platform = process.platform,
    gitRunner = gitView.runGit,
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
    this.runTmux = runTmux;
    this.listPanes = listPanes;
    this.readUsage = readUsage;
    this.platform = platform;
    this.gitRunner = gitRunner;
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
      teammateSids: new Set(), // sessions known to be split-pane teammates
      tmuxSocket: null, // from claude-hook.sh, to select a pane on click
      usage: new Map(), // session_id -> { tokens, window, pct, model, readAt, pending }
      primaryPane: null,
      primarySocket: null, // tmux server of primaryPane
      paneCheck: false, // a pane check is running
      teamReadAt: 0,
      wsl: null, // { distro, home } while the shell runs inside WSL
      team: null,
      tasks: null,
      lastAgent: null,
      activity: [], // inspector log, oldest first
      activitySeq: 0,
      early: new Map(), // tool_use_id -> result that arrived before its call (tmux hook)
      git: null, // last git status: { root, files, orig, paths }
      gitSeq: 0,
      gitFolders: new Map(), // "root\ndir/" -> files listed in that new folder
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
      session.team = null;
      session.tasks = null;
      session.usage.clear();
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
  // Only the Windows app needs that: an app running inside WSL itself (WSLg)
  // reads the same paths directly.
  reportShellCwd(id, { cwd, wslDistro, home } = {}) {
    const s = this.sessions.get(id);
    if (!s || typeof cwd !== 'string' || !cwd) return;
    s.wsl = wslDistro && this.platform === 'win32'
      ? { distro: String(wslDistro), home: typeof home === 'string' ? home : null } : null;
    this.setCwd(id, cwd, true);
  }

  // Where this host can read a path the shell or Claude reported.
  hostPath(s, p) {
    return (s.wsl && wslToWindows(p, s.wsl.distro)) || p;
  }

  // The shell reported its folder (prompt integration) or Claude's hook did.
  // The git branch is looked up only when the folder changed or `recheck` is
  // set (shell prompt, end of a Claude turn): hook events arrive many times a
  // turn, and for WSL every lookup is synchronous I/O over \\wsl.localhost
  // on the main process.
  setCwd(id, dir, recheck = false) {
    const s = this.sessions.get(id);
    if (!s || !dir) return;
    if (!recheck && dir === s.cwd) return;
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
    const config = this.scanConfig({
      claudeDir: w ? wslToWindows(`${home}/.claude`, w.distro) : this.claudePaths.dir,
      claudeJson: w ? wslToWindows(`${home}/.claude.json`, w.distro) : this.claudePaths.json,
      cwd: this.hostPath(s, s.cwd),
      mapPath: w ? (p) => wslToWindows(p, w.distro) || p : (p) => p,
    });
    // The files behind the listed items (SKILL.md, agent and command files,
    // settings, plugin README): the viewer may read these. Paths are already
    // as this host reads them.
    // The folders of skills, agents, commands and plugins too: a file there
    // may be linked from the one shown (a skill's reference.md), not the
    // folders of settings files (a home or project folder).
    s.configFiles = new Set();
    s.configDirs = new Set();
    if (config) {
      for (const key of ['skills', 'plugins', 'hooks', 'agents', 'mcp']) {
        for (const item of config[key] || []) {
          if (typeof item.file !== 'string' || !item.file) continue;
          s.configFiles.add(item.file);
          if (key === 'skills' || key === 'agents' || key === 'plugins') s.configDirs.add(path.dirname(item.file));
        }
      }
    }
    return config;
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
    if (meta.socket) s.tmuxSocket = meta.socket;
    if (sid && ev.transcript_path && !ev.agent_id) this.scheduleUsage(s, sid, ev.transcript_path, ev.hook_event_name);
    // Several claude sessions can report into one terminal through tmux. The
    // first one is the main session (LED, banner); later ones are listed
    // beside it. A split-pane teammate is its own session, recognised by a
    // TeammateIdle without agent_id (seen on 2.1.318). agent_type alone is not
    // enough: `claude --agent <name>` sets it on a main session too.
    if (sid && ev.hook_event_name === 'TeammateIdle' && !ev.agent_id) {
      s.teammateSids.add(sid);
      if (sid === s.primarySid) this.demotePrimary(s, meta);
    }
    if (sid && (s.teammateSids.has(sid) || (s.primarySid && sid !== s.primarySid))) {
      this.onOtherSession(s, sid, ev, meta, s.teammateSids.has(sid) || Boolean(ev.agent_type && !ev.agent_id));
      const o = s.others.get(sid);
      this.recordActivity(s, ev, o ? otherName(o, sid) : `claude ${sid.slice(0, 8)}`);
      this.emitAgent(s);
      return;
    }
    if (sid && !s.primarySid) {
      s.primarySid = sid;
      s.others.delete(sid); // was listed beside the previous main session
    }
    if (meta.pane) s.primaryPane = meta.pane;
    this.recordActivity(s, ev, ev.agent_id ? ev.agent_type || 'subagent' : null);
    if (meta.pane) s.primarySocket = meta.socket || s.tmuxSocket;
    s.claude = reduce(s.claude, ev, this.now());
    if (ev.hook_event_name === 'SessionEnd') this.endPrimary(s);
    // The main agent's turn ended with nothing left running: teammates are gone.
    if (ev.hook_event_name === 'Stop' && !ev.agent_id && Array.isArray(ev.background_tasks) && ev.background_tasks.length === 0) {
      for (const [k, o] of s.others) if (o.teammate) s.others.delete(k);
    }
    if (/^(Task|Teammate|Subagent)/.test(ev.hook_event_name || '')) this.refreshTeam(s);
    if (ev.cwd) this.setCwd(id, ev.cwd);
    if (ev.hook_event_name === 'Stop') this.setCwd(id, s.cwd, true); // branch may have changed
    this.emitAgent(s);
  }

  // One line of the inspector's log. A result or failure goes on the line of
  // its call (newest first: ids repeat only across sessions, and the latest
  // call is the one that just ran). claude-hook.sh (tmux) sends without
  // waiting, so a fast tool's result can arrive before its call: it is kept
  // for EARLY_MS and put on the call's line when that arrives; a failure that
  // came first has its own line, which the call then fills in.
  recordActivity(s, ev, who) {
    const entry = activityEntry(ev, this.now(), who);
    if (!entry) return;
    const now = this.now();
    for (const [k, v] of s.early) if (now - v.at > EARLY_MS) s.early.delete(k);
    const i = entry.useId ? s.activity.findLastIndex((a) => a.useId === entry.useId) : -1;
    if (entry.kind === 'fail' || entry.kind === 'result') {
      if (i !== -1) {
        const prev = s.activity[i];
        this.updateActivity(s, i, entry.kind === 'fail'
          ? { ...prev, kind: 'fail', error: entry.text, detail: { ...prev.detail, error: entry.detail.error } }
          : { ...prev, result: entry.result });
        return;
      }
      if (entry.kind === 'result') {
        if (entry.useId && s.early.size < 100) s.early.set(entry.useId, { result: entry.result, at: now });
        return;
      }
    } else if (entry.kind === 'tool' && i !== -1 && s.activity[i].kind === 'fail') {
      // The call of a failure logged before it: fill in what it was.
      // It reads like a failure in the usual order: the call, then the error.
      const prev = s.activity[i];
      this.updateActivity(s, i, {
        ...prev, text: entry.text, file: prev.file || entry.file,
        error: prev.error || oneLine(prev.detail && prev.detail.error) || undefined,
        detail: { ...entry.detail, error: prev.detail && prev.detail.error },
      });
      return;
    }
    if (entry.kind === 'tool' && entry.useId && s.early.has(entry.useId)) {
      entry.result = s.early.get(entry.useId).result;
      s.early.delete(entry.useId);
    }
    const e = { ...entry, n: ++s.activitySeq };
    s.activity.push(e);
    if (s.activity.length > ACTIVITY_MAX) s.activity.splice(0, s.activity.length - ACTIVITY_MAX);
    this.emit('session:activity', { id: s.id, entry: e });
  }

  updateActivity(s, i, entry) {
    s.activity[i] = entry;
    this.emit('session:activity', { id: s.id, entry });
  }

  activity(id) {
    const s = this.sessions.get(id);
    return { max: ACTIVITY_MAX, entries: s ? s.activity.slice() : [] };
  }

  // A file the page may open for this terminal: one from its activity log.
  // Returns the path as Claude named it (absolute) and as this host reads it
  // (\\wsl.localhost for a Linux path from the Windows app), or null.
  // Also a file of the last git status listing (git tab), by its full path.
  // Also a file behind an item of the last Claude config listing, by the
  // path given there (already readable on this host).
  fileTarget(id, file) {
    const s = this.sessions.get(id);
    if (!s || typeof file !== 'string' || !file) return null;
    if (s.configFiles && s.configFiles.has(file)) return { path: file, host: file };
    if (s.configDirs && s.configDirs.size && path.isAbsolute(file)) {
      // ".." cannot leave the folder: compared after resolving.
      const full = path.resolve(file);
      for (const dir of s.configDirs) {
        if (full.startsWith(path.resolve(dir) + path.sep)) return { path: full, host: full };
      }
    }
    const fromGit = s.git && s.git.paths.has(file);
    if (!fromGit && !s.activity.some((a) => a.file === file)) return null;
    const abs = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(file) ? file : `${s.cwd.replace(/[\\/]$/, '')}/${file}`;
    return { path: abs, host: this.hostPath(s, abs) };
  }

  // A vscode:// link for a file fileTarget allows (the page cannot make the
  // app open arbitrary paths). Inside WSL it opens through VS Code's WSL
  // remote. URL forms from
  // https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls
  // Built from fileTarget's path: a Linux path (activity, git) or this host's
  // path (config files, which inside WSL are \\wsl.localhost paths: mapped
  // back to the Linux path for the WSL remote).
  editorUrl(id, file) {
    const s = this.sessions.get(id);
    const t = s && this.fileTarget(id, file);
    if (!t) return null;
    if (s.wsl) {
      const linux = t.path.startsWith('/') ? t.path : windowsToWsl(t.path);
      if (linux) return `vscode://vscode-remote/wsl+${encodeURIComponent(s.wsl.distro)}${uriPath(linux)}`;
    }
    const p = t.host.replace(/\\/g, '/');
    return `vscode://file${p.startsWith('/') ? '' : '/'}${uriPath(p)}`;
  }

  // ---------- git tab (read-only) ----------
  gitTarget(s, cwd = s.cwd) {
    return { cwd, distro: s.wsl ? s.wsl.distro : null, platform: this.platform };
  }

  // Status, branch and recent commits of the repository at the terminal's
  // folder. Remembers the listed files, which the viewer may then read; only
  // the latest of overlapping reads is kept. `root` comes back without a
  // trailing slash, the form the page joins file paths to.
  // `fresh`: find the root again (rev-parse) instead of reusing the one
  // found for this folder last time; the page asks for it except on the
  // quick refreshes while Claude works (a new nested repository then shows
  // at the next fresh read: tab shown, end of a turn, window focus, ⟳).
  async gitStatus(id, fresh = true) {
    const s = this.sessions.get(id);
    if (!s) return { error: '터미널이 없습니다' };
    const seq = ++s.gitSeq;
    const cwd = s.cwd;
    const known = !fresh && s.gitRootOf && s.gitRootOf.cwd === cwd ? s.gitRootOf.root : null;
    const r = await gitView.gitStatus(this.gitTarget(s, cwd), this.gitRunner, known);
    if (seq !== s.gitSeq) return { ...r, stale: true }; // a newer read is under way
    s.gitRootOf = typeof r.root === 'string' ? { cwd, root: r.root } : null;
    if (typeof r.root === 'string') {
      const root = r.root;
      s.git = {
        root,
        files: new Set(r.files.map((f) => f.path)),
        orig: new Map(r.files.filter((f) => f.orig).map((f) => [f.path, { orig: f.orig, copy: f.index === 'C' }])),
        paths: new Set(r.files.map((f) => `${root}/${f.path}`)),
      };
      // New folders listed before stay readable while still listed, so the
      // page can show their files right away after a refresh.
      for (const [key, files] of s.gitFolders) {
        const [froot, dir] = key.split('\n');
        if (froot !== root || !s.git.files.has(dir)) { s.gitFolders.delete(key); continue; }
        for (const f of files) { s.git.files.add(f); s.git.paths.add(`${root}/${f}`); }
      }
    } else {
      s.git = null;
    }
    return r;
  }

  // The files of a new folder from the listing; they may then be opened.
  async gitUntracked(id, dir) {
    const s = this.sessions.get(id);
    if (!s || !s.git || !s.git.files.has(dir) || !dir.endsWith('/')) return { error: '목록에 없는 폴더입니다 (다시 읽어 주세요)' };
    const git = s.git;
    const r = await gitView.gitUntrackedIn(this.gitTarget(s, gitView.rootDir(git.root)), dir, this.gitRunner);
    if (r.files) {
      for (const f of r.files) { git.files.add(f); git.paths.add(`${git.root}/${f}`); }
      s.gitFolders.set(`${git.root}\n${dir}`, r.files);
    }
    return r;
  }

  async gitDiff(id, path) {
    const s = this.sessions.get(id);
    if (!s || !s.git || !s.git.files.has(path)) return { error: '목록에 없는 파일입니다 (다시 읽어 주세요)' };
    const o = s.git.orig.get(path);
    return gitView.gitFileDiff(this.gitTarget(s, gitView.rootDir(s.git.root)), path, this.gitRunner, o ? o.orig : null, Boolean(o && o.copy));
  }

  async gitShow(id, rev) {
    const s = this.sessions.get(id);
    if (!s || !s.git) return { error: '저장소를 먼저 읽어 주세요' };
    return gitView.gitShow(this.gitTarget(s, gitView.rootDir(s.git.root)), rev, this.gitRunner);
  }

  // Context usage from the session's transcript: read asynchronously, at most
  // every USAGE_MIN_MS per session, then the sidebar is updated. The end of a
  // turn (Stop) and SessionStart (e.g. after /compact) always read; when a
  // read is already running then, one more follows it.
  scheduleUsage(s, sid, transcript, eventName) {
    const prev = s.usage.get(sid) || { readAt: -Infinity, pending: false }; // never read yet
    const forced = eventName === 'Stop' || eventName === 'SessionStart';
    if (prev.pending) {
      if (forced) s.usage.set(sid, { ...prev, again: transcript });
      return;
    }
    if (!forced && this.now() - prev.readAt < USAGE_MIN_MS) return;
    s.usage.set(sid, { ...prev, pending: true, again: null, readAt: this.now() });
    Promise.resolve()
      .then(() => this.readUsage(this.hostPath(s, transcript)))
      .catch(() => null)
      .then((u) => {
        const cur = s.usage.get(sid);
        // Terminal closed, or the session ended while reading.
        if (!this.sessions.has(s.id) || !cur) return;
        // A session once seen past 200k keeps its 1M window (e.g. after /compact).
        const next = u && cur.window > u.window
          ? { ...u, window: cur.window, pct: Math.min(100, Math.round((u.tokens / cur.window) * 100)) } : u;
        s.usage.set(sid, { ...cur, ...(next || {}), pending: false, again: null });
        this.emitAgent(s);
        if (cur.again) this.scheduleUsage(s, sid, cur.again, 'Stop');
      });
  }

  contextOf(s, sid) {
    const u = sid && s.usage.get(sid);
    return u && u.tokens ? { tokens: u.tokens, window: u.window, pct: u.pct, model: u.model || null } : null;
  }

  // The main claude session is gone (SessionEnd, or its tmux pane closed).
  endPrimary(s) {
    if (s.claude.status || s.claude.sessionId) s.claude = { ...emptyState(), cwd: s.claude.cwd, updatedAt: this.now() };
    if (s.primarySid) s.usage.delete(s.primarySid);
    s.team = null;
    s.tasks = null;
    s.primarySid = null;
    s.primaryPane = null;
    s.primarySocket = null;
  }

  // Sessions whose tmux pane no longer exists are gone, even when their
  // SessionEnd never arrived (the pane was closed or killed: its hook could
  // not reach the app, or claude was killed with it). Only entries not heard
  // from since the panes were listed are dropped.
  async checkPanes(s) {
    const sockets = new Set([...s.others.values()].filter((o) => o.pane && o.socket).map((o) => o.socket));
    if (s.primaryPane && s.primarySocket) sockets.add(s.primarySocket);
    if (!sockets.size || s.paneCheck) return;
    s.paneCheck = true;
    const distro = s.wsl ? s.wsl.distro : null;
    try {
      for (const socket of sockets) {
        if (!/^\/[\w./@:+-]+$/.test(socket)) continue;
        const asked = this.now();
        const panes = await Promise.resolve(this.listPanes(socket, distro)).catch(() => null);
        if (!panes || !this.sessions.has(s.id)) continue;
        let changed = false;
        for (const [sid, o] of s.others) {
          if (o.socket === socket && o.pane && !panes.has(o.pane) && (o.state.updatedAt || 0) < asked) {
            s.others.delete(sid);
            s.usage.delete(sid);
            s.teammateSids.delete(sid);
            changed = true;
          }
        }
        if (s.primarySocket === socket && s.primaryPane && !panes.has(s.primaryPane) && (s.claude.updatedAt || 0) < asked) {
          this.endPrimary(s);
          changed = true;
        }
        if (changed) this.emitAgent(s);
      }
    } finally {
      s.paneCheck = false;
    }
  }

  // The main session turned out to be a teammate (e.g. the app was opened
  // while a split-pane team was already running): list it beside instead.
  demotePrimary(s, meta) {
    s.others.set(s.primarySid, {
      state: s.claude, pane: meta.pane || null, socket: meta.socket || s.tmuxSocket || null, teammate: true, name: null, type: s.claude.agentType || null,
    });
    s.claude = emptyState();
    s.primarySid = null;
    s.primaryPane = null;
    s.primarySocket = null;
    s.team = null;
    s.tasks = null;
  }

  onOtherSession(s, sid, ev, meta, teammateSession) {
    if (ev.hook_event_name === 'SessionEnd') { s.others.delete(sid); s.usage.delete(sid); return; }
    const prev = s.others.get(sid) || { state: emptyState(), name: null, teammate: false, pane: null, socket: null };
    const title = /^@\S/.test(meta.title || '') ? meta.title.slice(1) : null; // "@planner"
    s.others.set(sid, {
      state: reduce(prev.state, ev, this.now()),
      pane: meta.pane || prev.pane,
      socket: (meta.pane && meta.socket) || prev.socket,
      teammate: prev.teammate || teammateSession || ev.hook_event_name === 'TeammateIdle',
      name: (ev.hook_event_name === 'TeammateIdle' && ev.teammate_name) || prev.name || title || null,
      type: prev.type || ev.agent_type || null,
    });
  }

  refreshTeam(s) {
    s.teamReadAt = this.now();
    const sid = s.claude.sessionId;
    // Claude inside WSL keeps its files under the Linux home.
    const base = s.wsl && s.wsl.home ? wslToWindows(`${s.wsl.home.replace(/\/$/, '')}/.claude`, s.wsl.distro) : undefined;
    s.team = s.claude.status ? this.readTeam(sid, base || undefined) : null;
    s.tasks = s.claude.status ? this.readTasks(sid, base || undefined) : null;
  }

  agentView(s) {
    const others = [...s.others].map(([sid, o]) => ({
      id: `session:${sid}`,
      name: otherName(o, sid),
      type: o.type,
      status: o.state.status || 'idle',
      tool: o.state.tool,
      teammate: o.teammate,
      focusable: Boolean(o.pane && s.tmuxSocket),
      context: this.contextOf(s, sid),
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
      focusable: Boolean(view.status && s.primaryPane && s.tmuxSocket),
      context: view.status ? this.contextOf(s, s.primarySid) : null,
    };
  }

  emitAgent(s) {
    const view = this.agentView(s);
    const key = JSON.stringify(view);
    if (key === s.lastAgent) return;
    s.lastAgent = key;
    this.emit('session:agent', { id: s.id, claude: view });
  }

  // Selects the tmux pane of the main session ('main') or of a session listed
  // beside it ('session:<id>'), in the tmux server that reported it.
  async focusPane(id, target) {
    const s = this.sessions.get(id);
    if (!s || !s.tmuxSocket) return false;
    let pane = null;
    if (target === 'main') pane = s.primaryPane;
    else if (typeof target === 'string' && target.startsWith('session:')) pane = s.others.get(target.slice(8))?.pane;
    if (!pane || !/^%\d+$/.test(pane) || !/^\/[\w./@:+-]+$/.test(s.tmuxSocket)) return false;
    const args = ['-S', s.tmuxSocket, 'select-window', '-t', pane, ';', 'select-pane', '-t', pane];
    return this.runTmux(args, s.wsl ? s.wsl.distro : null);
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
    const readFiles = this.tick % TEAM_POLL_EVERY === 0;
    const checkPanes = this.tick % PANE_CHECK_EVERY === 0;
    this.tick++;
    for (const s of this.sessions.values()) {
      const status = s.tracker.status;
      const key = `${status}|${s.tracker.error || ''}`;
      if (key !== s.lastStatus) {
        s.lastStatus = key;
        this.emit('session:status', { id: s.id, status, error: s.tracker.error });
      }
      // Team and task files change with Claude's activity: re-read them only
      // after new events, or now and then while it runs.
      const stale = s.claude.updatedAt > s.teamReadAt || this.now() - s.teamReadAt > TEAM_IDLE_REREAD_MS;
      if (readFiles && s.claude.status && stale) {
        this.refreshTeam(s);
        this.emitAgent(s);
      }
      if (checkPanes) this.checkPanes(s);
    }
  }
}

module.exports = { SessionManager };
