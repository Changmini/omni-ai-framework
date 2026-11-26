'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Current git branch of `dir` by reading .git/HEAD (no git process).
// Returns the branch name, a short commit id when detached, or null.
function gitBranch(dir) {
  let cur = dir;
  for (let i = 0; i < 64 && cur; i++) {
    const dotGit = path.join(cur, '.git');
    let gitDir = null;
    try {
      const st = fs.statSync(dotGit);
      if (st.isDirectory()) gitDir = dotGit;
      else {
        const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8')); // worktree / submodule
        if (m) gitDir = path.resolve(cur, m[1].trim());
      }
    } catch { /* not here */ }
    if (gitDir) {
      try {
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : head.slice(0, 7);
      } catch { return null; }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

module.exports = { gitBranch };
