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

module.exports = { runTmux };
