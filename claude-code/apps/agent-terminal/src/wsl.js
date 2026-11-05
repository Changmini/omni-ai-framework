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

module.exports = { wslToWindows, withWslEnv, WSLENV_VARS };
