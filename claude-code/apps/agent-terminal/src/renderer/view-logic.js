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
  // `findOpen`: the viewer's find bar shows; `inFind`: the key came from
  // its box. One Esc does one thing: the card, then the find bar, then the
  // viewer.
  function escapeAction({ cardOpen, viewerOpen, inField, findOpen = false, inFind = false }) {
    if (cardOpen) return { hideCard: true, closeFind: false, closeViewer: false, consume: !inField || inFind };
    if (viewerOpen && findOpen && (inFind || !inField)) return { hideCard: false, closeFind: true, closeViewer: false, consume: true };
    if (viewerOpen && !inField) return { hideCard: false, closeFind: false, closeViewer: true, consume: true };
    return { hideCard: false, closeFind: false, closeViewer: false, consume: false };
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

  // The file tab's search: the paths (relative, "/"-separated) that contain
  // every space-separated term, ignoring case. Paths whose file name holds
  // all terms come first, then by length. `marks`: [start, end) ranges of
  // the terms in the file name, for highlighting.
  function searchFiles(files, query, limit) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const path of files) {
      const lower = path.toLowerCase();
      if (!terms.every((t) => lower.includes(t))) continue;
      const cut = path.lastIndexOf('/') + 1;
      const name = lower.slice(cut);
      const inName = terms.every((t) => name.includes(t));
      out.push({ path, cut, inName, starts: name.startsWith(terms[0]) });
    }
    out.sort((a, b) => (a.inName !== b.inName ? (a.inName ? -1 : 1)
      : a.starts !== b.starts ? (a.starts ? -1 : 1)
        : a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
    return out.slice(0, limit || 200).map(({ path, cut }) => {
      const name = path.slice(cut).toLowerCase();
      const marks = [];
      for (const t of terms) {
        const at = name.indexOf(t);
        if (at !== -1) marks.push([at, at + t.length]);
      }
      marks.sort((x, y) => x[0] - y[0]);
      const merged = [];
      for (const m of marks) {
        const last = merged[merged.length - 1];
        if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
        else merged.push(m.slice());
      }
      return { path, dir: path.slice(0, cut), name: path.slice(cut), marks: merged };
    });
  }

  // A shortcut line that opens a shell inside WSL (`wsl`, `wsl.exe` or its
  // full path, with only -d/-u/--cd/~ options): the next line waits for
  // that shell (shellReady).
  function entersWsl(line) {
    return /^\s*(&\s*)?("[^"]*[\\/]|[^"\s]*[\\/])?wsl(\.exe)?"?((\s+(-d|--distribution|-u|--user|--cd)(\s+|=)\S+)|(\s+~))*\s*$/i
      .test(String(line || ''));
  }

  // The text before the cursor looks like a shell prompt ("user@host:~$ ",
  // "PS C:\\> ", "# ", fish's "> "), not a message such as a WSL warning.
  function promptLike(text) {
    return /[$#>%❯»]\s*$/.test(String(text || '').replace(/\s+$/, ' '));
  }

  // Whether a shortcut's next line may be typed: the shell reported in
  // after the line was sent (`reportAt`: its prompt's folder report), or,
  // for a shell that cannot report (no app integration; inside WSL a tmux
  // started by ~/.bashrc, or NAT networking), it printed something at least
  // `lateMs` after the line (not just the echo of the line itself) and has
  // been quiet since: `quietMs` when what the cursor follows looks like a
  // prompt (`prompt`), else `slowMs` (wsl.exe may print a warning of its own
  // and then go on starting for seconds). A shell starting silently (WSL
  // booting) gets neither: typed early, the line would be lost.
  function shellReady({ reportAt = 0, lastDataAt = 0, sentAt, now, prompt = false, lateMs = 500, quietMs = 800, slowMs = 4000 }) {
    if (reportAt > sentAt) return true;
    if (!(lastDataAt > sentAt + lateMs)) return false;
    return now - lastDataAt >= (prompt ? quietMs : slowMs);
  }

  // Find in the file viewer: [start, end) of every `query` in `text`, at
  // most `max`. Ignoring case unless the query has a capital letter (as
  // the content search).
  function findAll(text, query, max = 5000) {
    const q = String(query || '');
    const out = [];
    if (!q || max <= 0) return out;
    const ignoreCase = q === q.toLowerCase();
    const s = String(text);
    const hay = ignoreCase ? s.toLowerCase() : s;
    if (hay.length !== s.length) return out; // lower case changed the length: positions would be off
    for (let at = hay.indexOf(q); at !== -1 && out.length < max; at = hay.indexOf(q, at + q.length)) out.push([at, at + q.length]);
    return out;
  }

  // The content search: [start, end) ranges of `query` in a found line, for
  // highlighting (as the main process matched it: ignoring case or not).
  function textRanges(text, query, ignoreCase) {
    const hay = ignoreCase ? String(text).toLowerCase() : String(text);
    const needle = ignoreCase ? String(query).toLowerCase() : String(query);
    const out = [];
    if (!needle || hay.length !== String(text).length) return out; // lower case changed the length: no marks
    for (let at = hay.indexOf(needle); at !== -1 && out.length < 50; at = hay.indexOf(needle, at + needle.length)) out.push([at, at + needle.length]);
    return out;
  }

  // A found line as the results show it in a narrow panel: without its
  // indent, and starting a little before the first match when that is far
  // in ("…" where cut), with the match ranges moved along.
  function hitView(text, query, ignoreCase, lead = 12) {
    const s = String(text);
    const ranges = textRanges(s, query, ignoreCase);
    const indent = s.length - s.trimStart().length;
    let from = indent;
    let prefix = '';
    if (ranges.length && ranges[0][0] - indent > lead + 4) { from = ranges[0][0] - lead; prefix = '…'; }
    const shift = prefix.length - from;
    return { text: prefix + s.slice(from), ranges: ranges.filter(([a]) => a >= from).map(([a, b]) => [a + shift, b + shift]) };
  }

  // How the file tab marks a changed path, from `git status` (the X and Y
  // letters of --porcelain=v1): 'C' conflict, 'U' untracked, 'A' added,
  // 'R' renamed, 'M' modified, or null (deleted: not on disk, not shown).
  function statusMark(index, work) {
    const xy = `${index}${work}`;
    if (/U/.test(xy) || xy === 'AA' || xy === 'DD') return 'C';
    if (xy === '??') return 'U';
    if (work === 'D' || (index === 'D' && work === ' ')) return null;
    if (index === 'A') return 'A';
    if (index === 'R' || index === 'C') return 'R';
    if (/[MT]/.test(xy)) return 'M';
    return null;
  }

  // Marks for the tree: each changed path's mark, and for every folder above
  // a change the strongest mark below it. A new folder listed as "dir/" by
  // git marks itself and everything in it ('U').
  function treeMarks(entries) {
    const rank = { C: 4, M: 3, R: 2, A: 2, U: 1 };
    const files = new Map();
    const dirs = new Map();
    const newDirs = new Set();
    for (const [p, m] of entries) {
      if (!m) continue;
      const path = p.replace(/\/$/, '');
      if (p.endsWith('/')) { newDirs.add(path); dirs.set(path, m); } else files.set(path, m);
      let cut = path.lastIndexOf('/');
      while (cut > 0) {
        const up = path.slice(0, cut);
        if (!dirs.has(up) || rank[m] > rank[dirs.get(up)]) dirs.set(up, m);
        cut = up.lastIndexOf('/');
      }
    }
    // Inside a new folder: one of the folders above `path` is one.
    const inNew = (path) => {
      if (!newDirs.size) return false;
      for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
        if (newDirs.has(path.slice(0, cut))) return true;
      }
      return false;
    };
    return {
      file(path) {
        if (files.has(path)) return files.get(path);
        return inNew(path) ? 'U' : null;
      },
      // Only a mark git gave this path itself (not one from a new folder
      // above it, which may hold files git ignores).
      own(path) {
        return files.get(path) || null;
      },
      // A submodule is a folder git reports like a file ("vendor/lib").
      dir(path) {
        if (dirs.has(path)) return dirs.get(path);
        if (files.has(path)) return files.get(path);
        return inNew(path) ? 'U' : null;
      },
    };
  }

  // ---------- HTML preview ----------

  // What a new drawing does to the preview: shown already -> reload it;
  // closed by the app's default -> open it; closed by the user -> only a
  // badge on its button; shown in its own window -> that window updates.
  function previewOnChange({ open, userClosed, detached }) {
    if (detached) return 'none';
    if (open) return 'reload';
    return userClosed ? 'badge' : 'open';
  }

  // Beside the terminal when both fit, else as a tab of the side panel.
  const PREVIEW_MIN = 320;
  const TERMINAL_MIN = 360;
  function previewPlacement(centerWidth) {
    return centerWidth >= TERMINAL_MIN + PREVIEW_MIN + 6 ? 'split' : 'tab';
  }

  // The preview's width for a chosen share of the centre, kept between
  // PREVIEW_MIN and what leaves the terminal TERMINAL_MIN.
  function previewWidth(ratio, centerWidth) {
    const r = Number.isFinite(ratio) && ratio > 0 && ratio < 1 ? ratio : 0.5;
    const max = Math.max(PREVIEW_MIN, centerWidth - TERMINAL_MIN - 6);
    return Math.round(Math.min(max, Math.max(PREVIEW_MIN, centerWidth * r)));
  }

  // A drawing's page tried to go elsewhere and was refused: shown again,
  // unless it was just shown again for the same (it would go on and on).
  const PREVIEW_RESTORE_GAP = 5000;
  function previewRestore(restoredAt, now) {
    return now - restoredAt < PREVIEW_RESTORE_GAP ? 'halt' : 'restore';
  }

  // "2026-11-16_18-02-31.html" -> "18:02:31", with the date when not `today`
  // ("2026-11-16").
  function historyLabel(name, today) {
    const m = /^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)/.exec(String(name || ''));
    if (!m) return '';
    const time = `${m[2]}:${m[3]}:${m[4]}`;
    return m[1] === today ? time : `${m[1].slice(5)} ${time}`;
  }

  // ---------- pipelines ----------
  // A pipeline is a graph the user draws: nodes (each optionally bound to a
  // terminal session) and arrows. It implies no order of work.

  const MEMO_MAX = 300;

  // What the Claude in the session bound to node `nodeId` is told about
  // pipeline `p`: the node, its memo and the nodes one arrow away, each with
  // its session. `sessionOf(nodeId)` -> null (no terminal bound), { claude:
  // null } (no Claude in it) or { claude: { id, name } }. Text for Claude,
  // in the user's language; '' for a node not in `p`. A node taken out for a
  // while (`off`) gets nothing, and its neighbours see only its name.
  function pipelineContext(p, nodeId, sessionOf) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const me = byId.get(nodeId);
    if (!me || me.off) return '';
    const memo = (n) => {
      const t = String(n.memo || '').trim().replace(/\s+/g, ' ');
      return t.length > MEMO_MAX ? `${t.slice(0, MEMO_MAX)}…` : t;
    };
    const session = (id) => {
      const s = sessionOf(id);
      if (!s) return '세션 없음';
      if (!s.claude) return 'Claude 없음';
      return s.claude.name ? `세션 「${s.claude.name}」(id ${s.claude.id})` : `세션 id ${s.claude.id}`;
    };
    const near = (from, to) => [...new Set(p.edges.filter((e) => e[from] === nodeId && e[to] !== nodeId && byId.has(e[to])).map((e) => e[to]))];
    const line = (label, id) => {
      const n = byId.get(id);
      if (n.off) return `- ${label}: 「${n.name}」 — 잠시 빠짐`;
      const m = memo(n);
      return `- ${label}: 「${n.name}」 — ${session(id)}${m ? ` — 메모: ${m}` : ''}`;
    };
    const before = near('to', 'from');
    const after = near('from', 'to');
    return [
      `[Omni Agent Terminal] 사용자가 그린 파이프라인 「${p.name}」에서 이 세션은 「${me.name}」 노드입니다. 세션 구성을 알려 주는 참고 정보이며 작업 지시가 아닙니다.`,
      ...(memo(me) ? [`- 이 노드 메모: ${memo(me)}`] : []),
      ...before.map((id) => line('이전 노드', id)),
      ...after.map((id) => line('다음 노드', id)),
      ...(before.length || after.length ? [] : ['- 화살표로 이어진 노드 없음']),
    ].join('\n');
  }

  // The nodes in arrow order (for the one-line strip): sources first; a loop
  // is broken at the earliest remaining node.
  function pipelineOrder(p) {
    const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
    for (const e of p.edges) if (indeg.has(e.to) && indeg.has(e.from) && e.from !== e.to) indeg.set(e.to, indeg.get(e.to) + 1);
    const left = p.nodes.map((n) => n.id);
    const out = [];
    while (left.length) {
      let i = left.findIndex((id) => indeg.get(id) === 0);
      if (i < 0) i = 0; // a loop: take the earliest node
      const [id] = left.splice(i, 1);
      out.push(id);
      for (const e of p.edges) if (e.from === id && left.includes(e.to)) indeg.set(e.to, indeg.get(e.to) - 1);
    }
    return out;
  }

  // ---------- terminal groups ----------
  // Every terminal is in one group (`groupOf`: terminal id -> group id);
  // `order` is all terminal ids in sidebar order, groups one after another.

  // The terminals Ctrl+1..9 and Ctrl+Tab move between: those of the shown
  // terminal's group, in sidebar order (all of them when it has no group).
  function groupNav(order, groupOf, activeId) {
    const g = groupOf[activeId];
    return g ? order.filter((id) => groupOf[id] === g) : order.slice();
  }

  // The group a new terminal goes to: the shown terminal's, else the first
  // group; null when there is none yet (a default group is made).
  function newTerminalGroup(groups, groupOf, activeId) {
    const g = groupOf[activeId];
    if (g && groups.some((x) => x.id === g)) return g;
    return groups.length ? groups[0].id : null;
  }

  // Where the terminals of a removed group go by default: the group above,
  // else the one below; null when it is the only group.
  function ungroupTarget(groups, id) {
    const i = groups.findIndex((x) => x.id === id);
    if (i < 0 || groups.length < 2) return null;
    return (groups[i - 1] || groups[i + 1]).id;
  }

  // What a collapsed group shows: one dot per terminal (its state) and how
  // many wait for the user.
  function groupSummary(statuses) {
    return { dots: statuses.slice(), waiting: statuses.filter((s) => s === 'waiting').length };
  }

  // Why a prompt shortcut must not be sent to a terminal (`info`: its
  // claude state and status), or null. No Claude: a shell would run the
  // words as a command; a Claude just started has no status yet, only its
  // session (from the status line). Waiting: the keys would answer the open
  // dialog, and Enter picks its highlighted choice (e.g. approves a tool call).
  function promptBlock(info) {
    const c = info && info.claude;
    const status = c && c.status;
    if (!(status || (c && c.session)) || info.status === 'exited') return 'no-claude';
    if (status === 'waiting') return 'waiting';
    return null;
  }

  // What a prompt shortcut types before its Enter: one message. Control
  // characters other than line breaks are dropped (they would act as keys).
  // Several lines are pasted when the program has bracketed paste on (a
  // line break inside a paste does not send), else joined into one line.
  function promptInput(text, bracketedPaste) {
    const t = String(text || '').replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '').replace(/\s+$/, '');
    if (!t.includes('\n')) return t;
    if (bracketedPaste) return `\x1b[200~${t.replace(/\n/g, '\r')}\x1b[201~`;
    return t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  }

  return {
    diffKinds, diffStat, escapeAction, serial, frontMatter, markdownBlocks, inlineSpans, relativeInside, searchFiles, findAll, textRanges, hitView, entersWsl, promptLike, shellReady, statusMark, treeMarks,
    previewOnChange, previewPlacement, previewWidth, previewRestore, historyLabel, promptBlock, promptInput, groupNav, newTerminalGroup, ungroupTarget, groupSummary,
    pipelineContext, pipelineOrder, PREVIEW_MIN, TERMINAL_MIN,
  };
}));
