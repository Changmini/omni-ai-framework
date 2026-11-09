'use strict';

// Maps a Linux path seen inside WSL to a path Windows can open:
//   /mnt/c/Users/x -> C:\Users\x
//   /home/u/proj   -> \\wsl.localhost\<distro>\home\u\proj
// Returns null when there is nothing to map.
function wslToWindows(linuxPath, distro) {
  if (typeof linuxPath !== 'string' || !linuxPath.startsWith('/')) return null;
  const drive = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(linuxPath);
  if (drive) return `${drive[1].toUpperCase()}:${(drive[2] || '/').replace(/\//g, '\\')}`;
  if (!distro) return null;
  return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, '\\')}`;
}

// WSLENV entries that carry the app's variables into WSL; /p converts a
// Windows path to its /mnt/... form (see Microsoft's WSLENV documentation).
const WSLENV_VARS = ['OMNI_TERMINAL_ID', 'OMNI_HOOK_TOKEN', 'OMNI_CWD_URL', 'OMNI_CLAUDE_SETTINGS/p', 'OMNI_INIT_BASH/p'];

function withWslEnv(existing) {
  const have = new Set((existing || '').split(':').filter(Boolean));
  return [...have, ...WSLENV_VARS.filter((v) => !have.has(v))].join(':');
}

// How to run a Linux command where the reporting shell lives: inside WSL from
// the Windows app (wsl.exe [-d distro] -e cmd ...), directly elsewhere. -e
// runs it without the Linux shell, so arguments arrive as given (a ";" or a
// path with spaces stays one argument). A distro name that is not a plain
// name is left out (default distro) rather than passed on.
function wslCommand(cmd, args, distro, platform = process.platform) {
  if (platform !== 'win32') return [cmd, args];
  const d = distro && /^[\w.@:+-]+$/.test(distro) ? ['-d', distro] : [];
  return ['wsl.exe', [...d, '-e', cmd, ...args]];
}

// Text from wsl.exe itself (an unknown distro, WSL not running) is UTF-16LE;
// what the Linux command prints is UTF-8. Decodes either.
function decodeOutput(buf) {
  if (!Buffer.isBuffer(buf)) return String(buf || '');
  let nulOdd = 0;
  const n = Math.min(buf.length, 512);
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) nulOdd++;
  return n >= 4 && nulOdd > n / 4 ? buf.toString('utf16le').replace(/^\uFEFF/, '') : buf.toString('utf8');
}

module.exports = { wslToWindows, withWslEnv, wslCommand, decodeOutput, WSLENV_VARS };
