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

// The pane ids (%N) of the tmux server at `socket`: a Set, empty when that
// server is gone, null when tmux could not be asked (not installed, wsl.exe
// failed, timeout), so a failed check never drops anything.
function listPanes(socket, distro, platform = process.platform, exec = execFile) {
  const [file, argv] = wslCommand('tmux', ['-S', socket, 'list-panes', '-a', '-F', '#{pane_id}'], distro, platform);
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) {
        resolve(new Set(String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^%\d+$/.test(l))));
      } else {
        // tmux 3.x: "no server running on <socket>" / "error connecting to <socket> (...)"
        resolve(/no server running on|error connecting to/.test(String(stderr || '')) ? new Set() : null);
      }
    });
  });
}

module.exports = { runTmux, listPanes };
