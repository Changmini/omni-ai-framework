'use strict';

const fs = require('node:fs');
const path = require('node:path');

const INIT_DIR = path.join(__dirname, 'shell-init');

// How to start the user's shell with the app's integration loaded
// (claude wrapper + current-folder reporting; see shell-init/).
function shellLaunch(platform = process.platform, env = process.env, initDir = INIT_DIR) {
  if (platform === 'win32') {
    const script = fs.readFileSync(path.join(initDir, 'omni.ps1'), 'utf8');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-EncodedCommand', encoded], env: {} };
  }
  const file = env.SHELL || '/bin/bash';
  const name = path.basename(file);
  if (name === 'bash') {
    return { file, args: ['--rcfile', path.join(initDir, 'omni.bash'), '-i'], env: {} };
  }
  if (name === 'zsh') {
    return { file, args: ['-l'], env: { ZDOTDIR: path.join(initDir, 'zsh') } };
  }
  return { file, args: ['-l'], env: {} }; // other shells: no integration
}

// Parses the folder a shell reports: OSC 7 (file://host/path) or the
// payload of OSC 9;9 ("C:\path"). Returns null when it is not a path.
function parseCwdReport(kind, data) {
  if (kind === 7) {
    const m = /^file:\/\/[^/]*(\/.*)$/.exec(data);
    if (!m) return null;
    let p = m[1];
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
    return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p; // /C:/x -> C:/x
  }
  if (kind === 9) {
    const m = /^9;"?(.*?)"?$/.exec(data);
    return m && m[1] ? m[1] : null;
  }
  return null;
}

module.exports = { shellLaunch, parseCwdReport, INIT_DIR };
