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

  // YAML front matter between a first line "---" and the next "---", as
  // [key, value] pairs: plain "key: value", block values ("key: >-" or "|"
  // then indented lines) and lists ("key:" then "- item" lines). Returns
  // null when the block holds no "key:" line (then the "---" is a rule, not
  // front matter) and the index of the first line after it.
  function frontMatter(lines) {
    if (lines[0] !== '---') return null;
    const end = lines.indexOf('---', 1);
    if (end < 0) return null;
    const pairs = [];
    for (let i = 1; i < end; i++) {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      let value = m[2].trim();
      const block = /^[>|][+-]?$/.test(value) ? value[0] : value === '' ? 'list' : null;
      if (block) {
        const more = [];
        while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === '')) more.push(lines[++i].trim());
        value = block === '|' ? more.join('\n').trim()
          : block === '>' ? more.filter(Boolean).join(' ')
          : more.filter(Boolean).map((x) => x.replace(/^-\s*/, '')).join(', ');
      }
      pairs.push([m[1], value.replace(/^["']|["']$/g, '')]);
    }
    return pairs.length ? { pairs, next: end + 1 } : null;
  }

  // A small Markdown reader for the viewer (skills, agents, commands,
  // READMEs): blocks and inline spans as data, which the page turns into
  // DOM nodes with textContent only (no HTML from the file is ever used).
  function markdownBlocks(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const fm = frontMatter(lines);
    if (fm) { out.push({ type: 'front', pairs: fm.pairs }); i = fm.next; }
    let para = [];
    const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        out.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
        i++;
        continue;
      }
      const head = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      if (head) { flush(); out.push({ type: 'h', level: head[1].length, text: head[2] }); i++; continue; }
      // "Title" underlined with === or --- (setext heading)
      if (para.length && /^\s*(=+|-+)\s*$/.test(l)) {
        out.push({ type: 'h', level: l.trim()[0] === '=' ? 1 : 2, text: para.join(' ') });
        para = [];
        i++;
        continue;
      }
      // a block indented by four spaces or a tab (not inside a paragraph)
      if (!para.length && /^( {4}|\t)/.test(l)) {
        const body = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || (!lines[i].trim() && /^( {4}|\t)/.test(lines[i + 1] || '')))) {
          body.push(lines[i].replace(/^( {4}|\t)/, ''));
          i++;
        }
        out.push({ type: 'code', lang: '', text: body.join('\n') });
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push({ type: 'hr' }); i++; continue; }
      if (/^\s*>/.test(l)) {
        flush();
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push({ type: 'quote', text: body.join(' ') });
        continue;
      }
      const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
      if (item) {
        flush();
        const ordered = /\d/.test(item[2]);
        const items = [];
        while (i < lines.length) {
          const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (m) {
            const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
            if (depth === 0 && /\d/.test(m[2]) !== ordered) break; // a list of the other kind starts
            items.push({ depth, text: m[3] });
            i++;
            continue;
          }
          // a wrapped line continues the item before it
          if (lines[i].trim() && /^\s+\S/.test(lines[i]) && items.length) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
          break;
        }
        out.push({ type: 'list', ordered, items });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l)) {
        flush();
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
          if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells); // skip the |---| line
          i++;
        }
        out.push({ type: 'table', rows });
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      para.push(l.trim());
      i++;
    }
    flush();
    return out;
  }

  // Inline spans: `code`, **bold**, *em* / _em_, [text](url), plain text.
  function inlineSpans(text) {
    const out = [];
    const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let m;
    const s = String(text || '');
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ t: 'code', s: m[1] });
      else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'b', s: m[2] !== undefined ? m[2] : m[3] });
      else if (m[4] !== undefined || m[5] !== undefined) out.push({ t: 'i', s: m[4] !== undefined ? m[4] : m[5] });
      else out.push({ t: 'link', s: m[6], href: m[7] });
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
    return out;
  }

  // A relative link's path inside the folder of the file shown
  // ('a/../b.md' -> 'b.md'), or null when it leaves that folder (or is not
  // a path): the main process opens only files under a listed item's folder.
  function relativeInside(href) {
    let raw;
    try { raw = decodeURIComponent(String(href || '').replace(/[#?].*$/, '')); } catch (e) { return null; }
    const out = [];
    for (const part of raw.split(/[\\/]+/)) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (!out.length) return null;
        out.pop();
      } else out.push(part);
    }
    return out.length ? out.join('/') : null;
  }

  return { diffKinds, diffStat, escapeAction, serial, frontMatter, markdownBlocks, inlineSpans, relativeInside };
}));
