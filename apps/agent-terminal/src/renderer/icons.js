'use strict';

// Line icons for the 자동화 and 자동화 결과 tabs, drawn like the shortcut
// icons: a 16px grid, 1.4px strokes in the text colour, shown in a 24px
// framed tile (.ic-tile) or beside a button's word (.ic). One colour only:
// colour is kept for states. Loaded by index.html (window.Icons).
(function (root) {
  const P = {
    // events
    prompt: '<path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11H7.5L4.5 13.5V11H3A1.5 1.5 0 0 1 1.5 9.5v-5A1.5 1.5 0 0 1 3 3z"/>',
    pre: '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3"/>',
    post: '<circle cx="8" cy="8" r="6.2"/><path d="M5.3 8.2l1.8 1.8 3.6-3.8"/>',
    wait: '<circle cx="8" cy="8" r="6.2"/><path d="M6.5 5.5v5M9.5 5.5v5"/>',
    stop: '<path d="M4 14.5V2"/><path d="M4 2.5h8l-2 3 2 3H4"/>',
    compact: '<path d="M2.5 6.5h4v-4M13.5 9.5h-4v4M6.5 6.5L2 2M9.5 9.5L14 14"/>',
    timer: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.4 1.6"/>',
    // actions
    context: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M6 7.5h4M6 10.5h4"/>',
    pipeline: '<circle cx="3.5" cy="8" r="2"/><circle cx="12.5" cy="3.5" r="2"/><circle cx="12.5" cy="12.5" r="2"/><path d="M5.3 7.1l5.4-2.7M5.3 8.9l5.4 2.7"/>',
    block: '<circle cx="8" cy="8" r="6.2"/><path d="M3.6 12.4l8.8-8.8"/>',
    ask: '<circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.3M8 11.4v.1"/>',
    fill: '<path d="M1.5 8h7.5M6.5 5.5L9 8l-2.5 2.5"/><rect x="10.5" y="2.5" width="4" height="11" rx="1.5"/>',
    highlight: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>',
    result: '<path d="M3 2.5h10l1.5 7V13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V9.5z"/><path d="M1.5 9.5H5l1 2h4l1-2h3.5"/>',
    agent: '<rect x="2.5" y="4.5" width="11" height="9" rx="2.5"/><path d="M8 4.5V2M6 9v.1M10 9v.1"/>',
    // scopes and template groups
    all: '<rect x="4.5" y="1.5" width="10" height="8" rx="1.5"/><path d="M11.5 12.5v.5a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V7.5A1.5 1.5 0 0 1 3 6h.5"/>',
    group: '<path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/>',
    guard: '<path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8V3.5z"/>',
    // buttons
    plus: '<path d="M8 3v10M3 8h10"/>',
    chevron: '<path d="M4 6l4 4 4-4"/>',
    test: '<path d="M6 1.5h4M6.5 1.5v4.2L2.8 12.4A1.4 1.4 0 0 0 4 14.5h8a1.4 1.4 0 0 0 1.2-2.1L9.5 5.7V1.5M4.6 10h6.8"/>',
    trash: '<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  };
  P.terminal = P.pre;
  P.tell = P.prompt;
  P.board = P.pipeline;
  P.handoff = P.fill;
  const FILLED = { play: '<path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7A.6.6 0 0 0 5 3.2z"/>' };

  // The icon as SVG markup (fixed strings from this file only).
  function svg(name, size = 14) {
    if (FILLED[name]) return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${FILLED[name]}</svg>`;
    const body = P[name] || P.highlight;
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  // A framed 24px tile, like a shortcut's icon.
  function tile(name, title = '') {
    const s = document.createElement('span');
    s.className = 'ic-tile';
    s.innerHTML = svg(name);
    if (title) s.title = title;
    return s;
  }

  // A button's leading (or trailing) icon, then its word.
  function label(btn, name, text, after = false) {
    const i = document.createElement('span');
    i.className = 'ic';
    i.innerHTML = svg(name, 13);
    btn.replaceChildren(...(after ? [text, i] : [i, text]));
    return btn;
  }

  root.Icons = { svg, tile, label, has: (n) => Boolean(P[n] || FILLED[n]) };
}(typeof self !== 'undefined' ? self : this));
