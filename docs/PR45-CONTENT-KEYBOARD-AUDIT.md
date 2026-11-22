# Content keyboard audit — 2026-11-22 SGT

The reported screenshot shows a webpage overlay on a native PDF, not simply an invisible side panel. A screenshot alone does not identify which extension ID rendered it. No browser was started or inspected for this audit.

## Confirmed code defects, not proof of screenshot attribution

At 3572063 `content/index.tsx` installs its own Ctrl/Meta+E DOM listener. It bypasses the background MIME router when its last `getShortcut` reply has an empty shortcut. That flag is refreshed on startup and document visibility, not on every keypress. It is per extension ID and may be stale.

The listener used `ctx.signal` without reading `ctx.isInvalid`. WXT 0.21.4 only discovers a disabled/reloaded extension lazily when `isInvalid` reads `runtime.id` (or a newer same-ID script announces itself). Its `addEventListener` helper likewise only attaches the abort signal. An orphaned listener could therefore consume the key and toggle an already-mounted overlay via the local bus without making an extension API call. The existing post-creation validity check does not guard the existing-UI branch. WXT script-start event names contain the extension ID, so installing a different ID does not invalidate the older script through that event. `claimContentInitialization` is also scoped to the isolated content world, not a cross-extension singleton. WECG documents the general orphaned-script problem: https://github.com/w3c/webextensions/issues/138 .

The content entry announces `document.contentType === 'application/pdf'` as PDF, but neither its local keyboard fallback nor its TOGGLE receiver previously prohibited the HTML overlay for that kind. The frame bridge has no keyboard listener; it handles extraction/locate and its message/pagehide listeners have disposal callbacks. Background PDF_DOCUMENT accepts only frame 0; the MIME announcement does not itself stop the content entry from mounting the webpage UI.

Minimal repair: check invalidation before consuming a DOM shortcut; guard all overlay toggles against invalid context and affirmative PDF MIME; do not refresh shortcut state from an invalid context. No new message routes, timers, ports, permissions, background gesture changes, URL heuristics or PDF assumptions were introduced. Already-injected old code cannot be repaired retroactively by loading this package.

Six tests exercise the real content entry: valid HTML fallback, assigned-command HTML non-interference, orphaned keydown, affirmative PDF keydown/TOGGLE, orphaned TOGGLE, and an already-mounted overlay's orphaned keydown. Against 3572063 the first five gave three failures and two passes; after the repair all six pass. This demonstrates defects in code, not the identity or MIME observed by the screenshot's renderer.

## Frozen package comparison

3572063 production and entry-check `content-scripts/content.js` are byte-identical: SHA256 `2ca2375fced704dd86b0ba5f8e3730348bbb8cf5ee4fc3224e05be14584549f0`. No MIME compilation difference can explain their content-script behavior. The diagnostic adds worker/panel traces and the snapshot page; chunk names/import graphs differ accordingly. This does not prove the browser had loaded only these bytes in the already-open PDF tab.

## Safe next observation (parent controls browser)

1. Before changing anything, preserve the current failure screenshot and extension/shortcut configuration evidence. Do not attribute an overlay to an ID just from its visual appearance.
2. For a clean frozen-baseline test, leave only the intended 3572063 production ID enabled and confirm its custom toggle-overlay Ctrl+E is In Chrome, built-in shortcut empty, and every other Representer ID disabled. Disable alone does not clean existing documents.
3. Open the exact original Lilly URL in a genuinely new tab (not duplicate/back/restore), or perform an ordinary reload of the current PDF after the extension configuration is final. Either replaces the document and loses PDF/UI state; a new tab preserves the old evidence tab. Wait for the PDF to finish. Do not append a query or hash: server handling and document equivalence are not established.
4. Screenshot native PDF with neither UI present; press Ctrl+E exactly once; screenshot immediately. Keep worker DevTools closed and do not switch extension packages during that document's test. A clean-document failure rules out old-document orphan listeners as a necessary cause, but still requires identifying which enabled extension owns the overlay.
5. If only the old document fails, that supports residual-document involvement, not proof that no product bug exists. If fresh 3572063 fails too, investigate current shortcut delivery and the live content world's MIME/owner; do not rename it “panel didn't open.” Repeat the same clean-document protocol separately for the patched package. Loading the patch into the old document is not a valid cleanup test.

The startup mock also now supplies tabs.get for the diagnostic open-tab-state observation. The earlier 3572063 test summary should not have been treated as a clean full-suite exit: this audit exposed an unhandled rejection hidden by the prior output pipeline. Current tests are run with exit status preserved.
