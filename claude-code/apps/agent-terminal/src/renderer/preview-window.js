'use strict';

// The detached preview window: the same pane as beside the terminal,
// following the terminal the main window shows. "창 합치기" (or closing the
// window) brings the preview back into the main window.
(function () {
  const api = window.previewApi;
  const pane = window.createPreviewPane({ api, inWindow: true, onAttach: () => api.previewAttach() });
  document.body.append(pane.el);
  api.previewTarget().then((id) => pane.setTarget(id || null)).catch(() => {});
  api.onPreviewTarget((id) => pane.setTarget(id || null));
  api.onPreviewChanged((p) => pane.changed(p));
  api.onPreviewBlocked(() => pane.restore());
  // A look every second while the window can be seen (a change made
  // outside Claude, or missed).
  setInterval(() => { if (document.visibilityState === 'visible') pane.poll(); }, 1000);
}());
