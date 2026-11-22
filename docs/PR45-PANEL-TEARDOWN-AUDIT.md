# Panel teardown audit — 2026-11-22 SGT

Evidence from the parent: a clean 88fe911 production document gave no UI after Ctrl+E; toolbar later visibly opened the native PDF side panel (Reading page 39/59), while a later parent screenshot showed it absent. Both screenshots must be retained. This audit neither operated a browser nor attributes their difference to timing, desktop state, or an application close without evidence.

## Executed source harness

`tests/pdf-close-harness.test.ts` invokes the real `installPdfEntry`, its action/command/message listeners, and the real PDF_CONTEXT/grant logic. Only Chrome API delivery/results are mocked. Five scenarios also passed against the untouched committed 88fe911 router (`git show HEAD:lib/pdf-entry.ts`) before restoring the diagnostic edit; all ten scenarios pass with diagnostics both off and on. This proves application reactions to specified inputs, not that Chrome emitted those inputs in the observed PDF. There is no PDF parser or real Chrome renderer in this harness.

1. Positive executeScript application/pdf, successful open, initial no-receiver PDF_CONTEXT, then another no-receiver PDF_CONTEXT (the post-read validate shape): stays PDF, no disable or close. Advancing 31 minutes returns none but still does not close.
2. A later frame-0 HTML PDF_DOCUMENT announce overwrites known PDF and calls tab enabled:false. It does **not** forget the grant or call close(). A subsequent no-receiver PDF_CONTEXT still returns the existing PDF grant, although the tab panel has already been disabled. This close-by-disable sequence is reproducible in application logic.
3. After initial PDF_CONTEXT succeeds, making PDF_PING answer HTML causes the next PDF_CONTEXT to forget, tab-disable, close(tabId), global-disable, toggle the webpage overlay, and return web. PdfPanel.run calls validate again immediately after readPdf finishes, so a changed receiver at that point is a conditional application-close mechanism consistent with reading having been visible earlier. No claim is made that this receiver change occurred live.
4. Child-frame HTML announces are ignored. Frame-0 announces with an old/different documentId and even a different URL are currently accepted without checking those identities. That makes stale or mismatched top-document evidence a viable hypothesis, but no routing fix is made without live evidence.
5. Real URL navigation and tab removal independently forget and close. A same-document loading event alone only drops the kind cache; it does not close.

The suggested later Ctrl+E-to-overlay inference is not generally correct: cached HTML does not bypass reinspection. The harness confirms a later executeScript application/pdf still reopens the side panel after an HTML context handoff. Whether an overlay mounts depends on the fresh MIME and valid content context.

## MIME limits of this result

Both content startup and the inspection function read `document.contentType`. Content captures `kind` once at startup, then answers PDF_PING with that captured value. Blink `Document::contentType()` uses document/loader MIME, not an isolated-world-specific value: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/dom/document.cc . Merely saying “HTML outer wrapper” does not prove that the content script can read HTML while executeScript reads PDF from the *same* document at the same time. Different documents, stale delivery, frame/viewer targeting, or an actual document change still need evidence. The synthetic harness deliberately supplies conflicting inputs; it cannot prove that Chromium produces them.

## Complete application close/disable inventory

| Effect | Origin / diagnostic reason |
| --- | --- |
| global enabled:false | startup; context-handoff |
| tab enabled:false without forget | webpage-route after confirmed non-PDF routing; html-announce |
| forget -> tab disable + close(tabId) | tab-removed; navigation-public (new public URL); navigation-checked (non-public update, tabs.get confirms departure); navigation-tab-missing; context-handoff |

No window.close or other sidePanel close/disable APIs exist elsewhere in lib/components/entrypoints. PdfPanel context-none changes its own rendered content, not Chrome visibility. Parse success/failure/cancel changes reader state. Visual session close destroys PDF.js/backend resources and ports, not the Chrome side panel. Token changes remount PdfDocument, whose cleanup aborts parsing/streaming and closes the visual session, not the panel. Grant expiration has no timer and causes context-none when checked; it does not invoke forget.

## Diagnostic changes (no routing repair)

Every forget, tab-disable, tab-close and global-disable now records request/source reason. API settle/rejection stages are also recorded. Accepted announcements record prior knownKind, hasGrant, sameDocument (URL-equivalence boolean), and sameInspectedDocument (sender.documentId vs last inspected top documentId boolean, when both are known). The IDs themselves are never persisted. That diagnostic-only comparison map resets on cache invalidation and worker restart; absent comparison means unknown, not mismatch.

PDF_CONTEXT records request, no receiver / ping-pdf / ping-html / ping-other, pdf/web/none outcome, and an allowlisted none reason. These join existing command/MIME/open traces under rp-entry-check-v1. Panel load/visibility/pagehide remain under rp-entry-check-panel-v1. No worker onOpened/onClosed subscriptions, timer, port, URL/token/document-ID log, permission or routing change was added.

## Next evidence gate

Use one diagnostic ID and a genuinely new document after configuration is fixed. Preserve atomic before/after screenshots and any original child screenshot showing Reading. Close worker DevTools during the action. Read both existing session keys afterwards from Options DevTools Extension Storage, not by retrying the blocked entry-check page.

- announce-html with knownKind:pdf followed by disable-request reason:html-announce establishes that application path. sameInspectedDocument true/false/absent further distinguishes same-inspection identity/mismatch/unknown.
- context-ping-html or context-ping-other followed by forget/context-handoff and close-request establishes the context handoff path; it can happen at parse-end validation.
- forget navigation-* or tab-removed identifies the navigation/tab path.
- panel hidden/unload without any application close/disable event in an otherwise complete chronological worker trace points to Chrome/UI/window or desktop-state investigation. Do not add another routing workaround. The environment agent must then correlate active tab/window and its exact desktop with the preserved screenshots.

Negative trace evidence is not absolute proof: persistence can fail or be interrupted, pagehide async writes are best-effort, and the bounded arrays retain only 80 rows per key. If trace completeness cannot be established, report it rather than claiming all application paths excluded.
