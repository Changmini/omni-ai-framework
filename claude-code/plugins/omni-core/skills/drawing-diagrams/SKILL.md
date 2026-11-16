---
name: drawing-diagrams
description: Draws diagrams, charts and other visuals as one self-contained HTML page in the project's private/index.html, which Omni Agent Terminal shows beside the terminal as soon as it is written. Use when the user asks to draw, diagram, chart, visualize or "show as a picture" something (구성도, 흐름도, 다이어그램, 차트, 그림, 시각화), or when a picture would explain an answer better than text.
---

# Drawing diagrams

Draw into `private/index.html` at the project root (the git repository root; without git, the current folder). Omni Agent Terminal reloads it beside the terminal while the user keeps talking to you; in any other setup the user can open the file in a browser.

## Steps

1. Read what the picture is about (code, config, the conversation) so labels and numbers are real, not invented. Say so in the page when a value is an estimate.
2. Write the whole page to `private/index.html` with the Write tool, replacing what was there. The app keeps earlier drawings in `private/.history/` by itself; do not write there.
3. Reply in one or two sentences: what the page shows and what to look at. Do not paste the HTML.
4. For "change X", "더 자세히", "이전 것처럼": edit the same file (Edit for small changes, Write for a new layout).

## The page

- One file: HTML with inline `<style>` and `<script>`. No other local files, no build step.
- Prefer inline SVG for diagrams (boxes, arrows, flows, sequences) and `<canvas>` or SVG for charts: they work offline. A library from a CDN is fine when it saves real work (for example mermaid, d3, chart.js from `https://cdnjs.cloudflare.com/` or `https://cdn.jsdelivr.net/npm/`, with a pinned version); show a short note in the page if it fails to load.
- Dark theme: page background `#0f1117`, cards `#171a23`, borders `#2a2f3d`, text `#e2e5ec`, muted `#8a91a3`, accent `#d97757`. Set the background on `html, body` and `min-height: 100vh`.
- It must read well from about 360px wide up to a full screen: SVGs with `viewBox` and `width: 100%`, grids like `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`, no fixed widths wider than 360px, no horizontal scrolling.
- Text in the user's language. A title and a one-line subtitle saying what the picture answers.
- Animation only where it shows something (a flow along a path); never loop heavy work.
- The page runs sandboxed: no forms, no links that navigate, no `window.open`, no storage, no requests other than loading a library. Never put secrets, tokens or personal data in it.

## Minimal page

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>결제 흐름</title>
<style>
  html, body { margin: 0; min-height: 100vh; background: #0f1117; color: #e2e5ec; font: 14px/1.5 system-ui, sans-serif; }
  main { padding: 24px; }
  .sub { color: #8a91a3; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .card { background: #171a23; border: 1px solid #2a2f3d; border-radius: 12px; padding: 16px; }
  svg { width: 100%; height: auto; }
  svg text { fill: #e2e5ec; font: 13px system-ui, sans-serif; }
</style>
</head>
<body>
<main>
  <h1>결제 흐름</h1>
  <p class="sub">주문 생성부터 승인까지의 호출 순서</p>
  <div class="grid">
    <section class="card"><!-- <svg viewBox="0 0 600 300"> ... </svg> --></section>
  </div>
</main>
</body>
</html>
```

## Check before replying

- [ ] The file is `private/index.html` at the project root, complete (not a fragment).
- [ ] Labels and numbers come from the code or the user, or are marked as estimates.
- [ ] It fits a narrow column: no horizontal scroll, text not overlapping.
- [ ] Nothing secret or personal in the page.

If `private/` is not in `.gitignore`, mention once that adding it keeps drawings out of commits; do not change `.gitignore` unless the user asks.
