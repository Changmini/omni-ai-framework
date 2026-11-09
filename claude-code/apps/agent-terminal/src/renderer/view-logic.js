'use strict';

// Decisions of the page that do not need the DOM, so `npm test` covers them:
// diff line kinds, what Esc does, and running one git read at a time.
// Loaded by index.html before renderer.js (window.ViewLogic) and by tests
// (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViewLogic = api;
}(typeof self !== 'undefined' ? self : this, () => {
  // The kind of each line of a diff: 'meta' (file headers), 'hunk', 'add',
  // 'del' or 'ctx'. "--- a/x" and "+++ b/x" are headers only between a
  // "diff ..." line and the first hunk of that file; elsewhere a line that
  // starts with "---" is a removed "-- ..." line (an SQL or Lua comment).
  // Combined diffs of merge commits ("diff --cc", "@@@") have one column per
  // parent before the text.
  const FILE_HEAD = /^(diff --git |diff --cc |diff --combined )/;
  const HEAD_LINE = /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|dissimilarity index|rename (from|to) |copy (from|to) |old mode|new mode|Binary files|mode )/;

  function diffKinds(lines) {
    let head = false;
    let cols = 1;
    return lines.map((l) => {
      if (FILE_HEAD.test(l)) {
        head = true;
        cols = l.startsWith('diff --git ') ? 1 : 2;
        return 'meta';
      }
      if (l.startsWith('commit ') && !head) return 'meta';
      if (head && HEAD_LINE.test(l)) return 'meta';
      if (l.startsWith('@@')) {
        head = false;
        const at = /^(@+)/.exec(l)[1].length;
        cols = Math.max(1, at - 1);
        return 'hunk';
      }
      head = false;
      const mark = l.slice(0, cols);
      if (mark.includes('+')) return 'add';
      if (mark.includes('-')) return 'del';
      return 'ctx';
    });
  }

  function diffStat(lines) {
    let add = 0;
    let del = 0;
    for (const k of diffKinds(lines)) {
      if (k === 'add') add++;
      else if (k === 'del') del++;
    }
    return { add, del };
  }

  // What Esc does, given whether the hover card and the viewer are open and
  // whether the key was typed into a text field or a terminal. In a field it
  // still closes the card but goes on to the field (Esc interrupts Claude in
  // a terminal, cancels a rename, closes the search box).
  function escapeAction({ cardOpen, viewerOpen, inField }) {
    if (cardOpen) return { hideCard: true, closeViewer: false, consume: !inField };
    if (viewerOpen && !inField) return { hideCard: false, closeViewer: true, consume: true };
    return { hideCard: false, closeViewer: false, consume: false };
  }

  // Runs `task` (async) one at a time: a call while it runs asks for one more
  // run after it, however many calls came meanwhile. A failing run is
  // reported to `onError` and does not cancel that next run.
  function serial(task, onError = (e) => { if (typeof console !== 'undefined') console.error(e); }) {
    let busy = false;
    let again = false;
    return async function run() {
      if (busy) { again = true; return; }
      busy = true;
      try {
        await task();
      } catch (e) {
        onError(e);
      } finally {
        busy = false;
      }
      if (again) { again = false; await run(); }
    };
  }

  return { diffKinds, diffStat, escapeAction, serial };
}));
