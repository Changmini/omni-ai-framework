'use strict';

const { execFile } = require('node:child_process');
const { wslCommand } = require('./wsl');

// Runs tmux where the reporting claude lives: inside WSL from the Windows app
// (wsl.exe [-d distro] -e tmux ...), directly on Linux and macOS. -e runs tmux
// without the Linux shell: through a shell (wsl.exe --) the ";" between tmux
// commands would end the shell command instead.
// Resolves true when tmux exits with 0.
function runTmux(args, distro, platform = process.platform, exec = execFile) {
  const [file, argv] = wslCommand('tmux', args, distro, platform);
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

// The tmux server at `socket`: { pid, panes: Set of pane ids (%N) }, or
// { gone: true } when nothing listens there, or null when tmux could not be
// asked or could not tell (not installed, wsl.exe failed, timeout, no
// permission), so a failed check never drops anything.
function listPanes(socket, distro, platform = process.platform, exec = execFile) {
  const [file, argv] = wslCommand('tmux', ['-S', socket, 'list-panes', '-a', '-F', '#{pid} #{pane_id}'], distro, platform);
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) {
        const rows = String(stdout || '').split(/\r?\n/).map((l) => /^(\d+) (%\d+)$/.exec(l.trim())).filter(Boolean);
        resolve({ pid: rows.length ? rows[0][1] : null, panes: new Set(rows.map((m) => m[2])) });
        return;
      }
      // tmux 3.4: "error connecting to <socket> (No such file or directory)"
      // for a missing socket, "no server running on <socket>" for one nobody
      // listens on. Other errors (Permission denied) say nothing about it.
      const msg = String(stderr || '');
      resolve(/no server running on|error connecting to .*\((No such file or directory|Connection refused)\)/.test(msg) ? { gone: true } : null);
    });
  });
}

module.exports = { runTmux, listPanes };
