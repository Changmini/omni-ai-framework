'use strict';

// The HTML preview pane, used beside the terminal (renderer.js) and in the
// detached window (preview-window.js): a head (path, update mark, earlier
// drawings, buttons) and the drawing in a sandboxed iframe from
// omni-preview:// (scripts run, but in an origin of their own: nothing of
// the app is reachable from it).
//
// createPreviewPane({ api, inWindow, onCollapse, onDetach, onAttach, refocus })
//   api: previewCheck(id), previewOpenExternal(id)
//   refocus(): give the keyboard back to where it was (the terminal) when a
//     reload took it without the user touching the pane.
// -> { el, setTarget(id), poll(), changed(payload), target() }

(function (root) {
  const RECENT_MS = 4000; // "방금 갱신됨" this long after a new drawing

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function button(label, title, cls = 'vbtn') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const clock = (ms) => new Date(ms).toTimeString().slice(0, 8);

  function createPreviewPane({ api, inWindow = false, onCollapse = () => {}, onDetach = () => {}, onAttach = () => {}, refocus = () => {} }) {
    const pane = el('section', 'preview-pane');
    pane.setAttribute('aria-label', '미리보기');
    const head = el('div', 'preview-head');
    const title = el('span', 'preview-title', '미리보기');
    const where = el('span', 'preview-path');
    const whereText = el('span');
    where.append(whereText);
    const mark = el('span', 'preview-mark');
    const nav = el('span', 'preview-nav');
    const older = button('◀', '이전 그림');
    const count = el('span', 'preview-count');
    const newer = button('▶', '다음 그림');
    nav.append(older, count, newer);
    const reload = button('⟳', '다시 읽기', 'icon-btn');
    const external = button('브라우저', '기본 브라우저로 열기');
    const detach = inWindow ? button('창 합치기', '메인 창으로 되돌리기') : button('새 창', '미리보기를 새 창으로');
    const collapse = inWindow ? null : button('⇥', '미리보기 접기', 'icon-btn');
    head.append(title, where, mark, nav, reload, external, detach, ...(collapse ? [collapse] : []));
    const frame = el('iframe', 'preview-frame');
    // Scripts only: no same origin (so not the app's), no popups, no
    // top-level navigation, no forms, no downloads.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = '미리보기';
    pane.append(head, frame);

    let id = null;
    let state = null; // last answer of previewCheck
    let index = 0; // 0: the current drawing; k: the k-th earlier one (history[k - 1])
    let shownVersion = null;
    let changedAt = 0;
    let lastTouch = 0; // the user clicked in the pane
    let loaded = null; // what the frame was last given: "<private path> <src>"
    let restoredAt = 0;
    let halted = false; // the page kept going elsewhere: left until a new version or ⟳
    let resting = false; // the page's animations rest (preview.js pageHelper)
    const scrolls = new Map(); // src without ?v= -> { x, y }

    pane.addEventListener('pointerdown', () => { lastTouch = Date.now(); }, true);

    const srcKey = () => (index === 0 ? 'index' : state.history[index - 1]);

    function srcFor() {
      if (!state || !state.url) return 'about:blank';
      if (index === 0) return `${state.url}index.html?v=${state.version}`;
      return `${state.url}.history/${encodeURIComponent(state.history[index - 1])}`;
    }

    function renderHead() {
      const hist = state && state.history ? state.history.length : 0;
      whereText.textContent = state && state.shown ? state.shown : '';
      where.title = whereText.textContent;
      nav.hidden = hist === 0;
      count.textContent = `${hist + 1 - index}/${hist + 1}`;
      older.disabled = index >= hist;
      newer.disabled = index === 0;
      if (state && state.error) {
        mark.textContent = state.error;
        mark.dataset.kind = 'error';
      } else if (halted) {
        mark.textContent = '그림이 다른 페이지로 가려 해 멈췄습니다 · ⟳';
        mark.dataset.kind = 'error';
      } else if (index > 0) {
        mark.textContent = `이전 그림 ${root.ViewLogic.historyLabel(state.history[index - 1], today())}${resting ? ' ⏸' : ''}`;
        mark.dataset.kind = 'old';
      } else if (resting) {
        mark.textContent = '⏸ 움직임 멈춤 · 마우스를 올리면 재생';
        mark.dataset.kind = '';
      } else if (state && !state.exists) {
        mark.textContent = '그림 없음';
        mark.dataset.kind = '';
      } else if (state && Date.now() - changedAt < RECENT_MS) {
        mark.textContent = '● 방금 갱신됨';
        mark.dataset.kind = 'new';
      } else {
        mark.textContent = state && state.at ? `${clock(state.at)} 갱신` : '';
        mark.dataset.kind = '';
      }
    }

    // The URL alone is not enough to know the frame shows it: a terminal
    // that moved to another project has the same URL (t<id>, version 1).
    function load() {
      const src = srcFor();
      const key = `${state && state.shown} ${src}`;
      if (loaded === key) return;
      loaded = key;
      resting = false;
      frame.setAttribute('src', src);
    }

    function blank() {
      loaded = null;
      resting = false;
      frame.setAttribute('src', 'about:blank');
    }

    // The page must not take the keyboard from the terminal: not when it
    // loads, nor later (a script calling focus()). Unless the user pressed
    // in the pane or the page just before.
    const untouched = () => Date.now() - lastTouch > 1500;
    frame.addEventListener('load', () => {
      if (document.activeElement === frame && untouched()) refocus();
    });
    window.addEventListener('blur', () => {
      // After the page's "touch" message (sent as the user pressed) arrives.
      setTimeout(() => {
        if (document.activeElement === frame && document.hasFocus() && untouched()) refocus();
      }, 150);
    });

    // The page's scroll position (numbers only), kept per drawing and sent
    // back after a reload.
    window.addEventListener('message', (e) => {
      if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return;
      const key = srcKey();
      if (e.data.omniPreview === 'rest') {
        resting = e.data.on === true;
        renderHead();
      } else if (e.data.omniPreview === 'touch') {
        lastTouch = Date.now();
      } else if (e.data.omniPreview === 'scroll') {
        const x = Number(e.data.x);
        const y = Number(e.data.y);
        if (Number.isFinite(x) && Number.isFinite(y)) scrolls.set(key, { x, y });
      } else if (e.data.omniPreview === 'ready') {
        const at = scrolls.get(key);
        if (at && frame.contentWindow) frame.contentWindow.postMessage({ omniPreview: 'restore', x: at.x, y: at.y }, '*');
      }
    });

    // The state of the target now; a new version shows (and is marked new).
    async function poll() {
      const want = id;
      if (!want) return null;
      let r;
      try { r = await api.previewCheck(want); } catch { r = { error: '읽을 수 없습니다' }; }
      if (want !== id) return null;
      // The terminal went to another project: its drawings from the start.
      const moved = Boolean(state && r.shown !== state.shown);
      if (moved) { index = 0; shownVersion = null; scrolls.clear(); }
      const fresh = state && !state.error && r.version !== shownVersion && shownVersion !== null;
      state = r;
      if (fresh || moved) halted = false;
      if (fresh) { changedAt = Date.now(); index = 0; }
      if (index > (r.history || []).length) index = 0;
      shownVersion = r.version;
      renderHead();
      load();
      return r;
    }

    function setTarget(next) {
      if (next === id) return;
      id = next;
      state = null;
      index = 0;
      shownVersion = null;
      scrolls.clear();
      halted = false;
      renderHead();
      blank();
      poll();
    }

    older.addEventListener('click', () => { if (state && index < state.history.length) { index++; halted = false; renderHead(); load(); } });
    newer.addEventListener('click', () => { if (index > 0) { index--; halted = false; renderHead(); load(); } });
    reload.addEventListener('click', () => {
      if (!state) return;
      halted = false;
      blank();
      requestAnimationFrame(load);
      poll();
    });
    external.addEventListener('click', () => { if (id) api.previewOpenExternal(id); });
    detach.addEventListener('click', () => (inWindow ? onAttach() : onDetach()));
    if (collapse) collapse.addEventListener('click', () => onCollapse());
    // The "방금 갱신됨" mark fades into the time.
    setInterval(() => { if (changedAt && Date.now() - changedAt < RECENT_MS + 1500) renderHead(); }, 1000);

    return {
      el: pane,
      setTarget,
      poll,
      target: () => id,
      // Shows the drawing again (after its page tried to go elsewhere and
      // was refused, leaving an error page).
      // A page that goes elsewhere again right away is not reloaded over
      // and over: it stays stopped until a new version or ⟳.
      restore() {
        if (root.ViewLogic.previewRestore(restoredAt, Date.now()) === 'halt') { halted = true; renderHead(); return; }
        restoredAt = Date.now();
        blank();
        requestAnimationFrame(load);
      },
      // Marks the drawing new ("방금 갱신됨"): it opened for a new drawing.
      flash() { changedAt = Date.now(); renderHead(); },
      shown: () => (state ? state.shown : null),
      // A change announced by the main process: for this preview when it is
      // the same terminal or the same private folder.
      changed(p) {
        if (!p || (p.id !== id && !(state && p.shown && p.shown === state.shown))) return false;
        poll();
        return true;
      },
    };
  }

  root.createPreviewPane = createPreviewPane;
}(typeof window !== 'undefined' ? window : globalThis));
