'use strict';

const { execFile } = require('node:child_process');

// Runs tmux where the reporting claude lives: inside WSL from the Windows app
// (wsl.exe [-d distro] -- tmux ...), directly on Linux and macOS.
// Resolves true when tmux exits with 0.
function runTmux(args, distro, platform = process.platform, exec = execFile) {
  const [file, argv] = platform === 'win32'
    ? ['wsl.exe', [...(distro && /^[\w.@:+-]+$/.test(distro) ? ['-d', distro] : []), '--', 'tmux', ...args]]
    : ['tmux', args];
  return new Promise((resolve) => {
    exec(file, argv, { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

module.exports = { runTmux };
