# HTML shortcut audit — 2026-11-22 SGT

## Acceptance status supplied by parent

c66eec8 production, a new PDF document, one canvas Ctrl+E: native side panel read all 59 pages and remained visible. The diagnostic build did likewise. Retain that positive evidence. The earlier disappearance incident is not an established application-close bug; the action called “toolbar” lacked a toolbar trace and may have been Chrome's own panel toggle.

Correction at 2026-11-22 13:33 SGT: the parent inspected the execution record and found that the reported f63e4b3 diagnostic HTML failure used a page-level browser_press_key, not a native desktop keystroke. That test delivered a DOM key event; it did not exercise Chrome's extension-command dispatch. The trace contained content-key-command-owned but no command or content toggle/mount stages. This is not evidence that our listener swallowed a native Chrome command, nor evidence of an HTML routing regression. Page-level simulated key events are not acceptance tests for extension shortcuts.

The parent then repeated the f63e4b3 diagnostic HTML test using the real Computer desktop Ctrl+E. The parent's screenshot confirmed the in-page rounded overlay opened, with no native Chrome side panel. Diagnostic HTML native-key GUI acceptance therefore passed. The latest f63e4b3 **production** HTML and PDF native-key GUI checks are still being performed by the parent as of this correction; neither is recorded here as passed.

## Confirmed independent defect and executed reproduction

The content entry cached whether getShortcut was empty at startup and visibilitychange. Background getShortcut calls the real chrome.commands.getAll handler. There is no settings-change event in this code to update a visible document when shortcuts are edited.

Both local keydown and background TOGGLE call the **same** toggle() function and share its 200ms de-duplication. It is incorrect to say the local path had no de-duplication. But 200ms is only a time window, not ownership of a physical keypress. If cached NotSet is stale and both paths arrive more than 200ms apart, the first opens/mounts and the second emits bus.toggle, closing the overlay. The background MIME inspection, ping and possible content injection are asynchronous, so code does not guarantee their completion inside that window.

`tests/html-command-keyboard.test.ts` runs the real background.ts main, its real getShortcut handler, the real PDF/HTML router, real messages.rpc, real content main and real bus, bridged by mocked Chrome APIs. Rendering/mounting is a test double: a boolean follows mount plus the same toggle bus that App uses (App initializes open:true). It does not paint a browser DOM or prove actual Chrome key delivery.

Against c66eec8, five initial cases yielded three failures:
- cached NotSet -> assigned Ctrl+E, DOM fallback first, background command toggle after 500ms: overlay ends closed;
- same stale state, background command first and later DOM event: overlay ends closed;
- cached assigned Ctrl+E -> NotSet without visibilitychange: fallback never opens.

The two passing controls were a freshly assigned HTML shortcut (including loading-kind invalidation) and a genuinely unassigned local fallback toggled twice intentionally. Thus stale state is a confirmed independent defect and the f63e4b3 repair remains justified by these source-harness results. It was not established as the cause of the reported new-tab failure; that report is now corrected above as an invalid page-simulated shortcut test.

## Minimal ownership repair

Before a local fallback toggles, it now queries getShortcut again and only proceeds if the authoritative reply is successful and empty. The cached flag is only a synchronous preventDefault hint; it no longer authorizes local UI toggling. Both directions of shortcut reconfiguration work without a visibility event. An assigned default or different custom shortcut leaves UI ownership to chrome.commands. A failed lookup never guesses that the command is unassigned.

No timer/window extension, PDF routing modification, permission, network call or new fetch route was introduced. The extra lookup is an extension-internal message/API query on a candidate HTML Ctrl/Meta+E keydown. Background PDF open remains unchanged and is never preceded by this HTML lookup from a PDF-kind content context.

The timing controls cover command delay 0, 199, 200, 500 and 2000ms. A diagnostic integration case also verifies actual content-to-worker stage recording. Existing orphan-context and affirmative-PDF content tests remain passing.

## Diagnostic evidence and valid native-key acceptance

Worker adds web-toggle-request/resolved around its existing HTML TOGGLE send. Content reports a closed allowlist of stage names to the existing worker message listener (frame 0 only), which writes them under rp-entry-check-v1. This avoids forbidden direct content access to storage.session. No new worker event subscription is added.

Content stages distinguish: command owns key vs real local fallback vs shortcut lookup failure; TOGGLE-message vs keydown toggle; 200ms suppression; create/mount request, mount completion, existing-UI toggle and mounting rejection. Mount completion means u.mount returned, not proof of React paint or visibility. Production excludes these diagnostic messages and records.

For any future native-key failure, use the diagnostic package and preserve one atomic **Computer desktop** canvas Ctrl+E action, before/after screenshots and the chronological key snapshot. Do not substitute page-level key simulation:
- no command: environment/shortcut delivery evidence is needed, not another PDF patch;
- command + mime-web + web-toggle-request but no content-toggle-message: investigate document-targeted message/content delivery;
- content-mount-request then content-mount-rejected: creation failed;
- content-mounted and no later toggle-existing yet invisible: investigate actual DOM/rendering/desktop state; don't call it double-toggle;
- two accepted toggle sources with toggle-existing: a real duplicate is established.

Acceptance at 13:33 SGT: f63e4b3 diagnostic HTML passed with a native Computer keystroke and parent screenshot; f63e4b3 production HTML/PDF native GUI acceptance remains pending. c66eec8 PDF acceptance remains a fact for that frozen package. This correction changes documentation only: no production-code repair, package rebuild, merge or release follows from the invalid page-simulated failure report. The original frozen f63e4b3 production package and its SHA256 remain valid.


## Final f63e4b3 production acceptance — parent screenshots

The parent confirmed both production cases on 2026-11-22 using native **Computer desktop** Ctrl+E, not browser/page-simulated keyboard input. Only production extension ID `lkbgacdopekcdgkpikjhkdebloghjmdg` was enabled; diagnostics and all other versions were off. The custom command was Ctrl+E / In Chrome; the built-in action shortcut was NotSet. Neither case included a toolbar comparison action.

- **13:36 SGT — HTML passed:** a genuinely new `https://example.com` document, click in the body, one Ctrl+E, wait five seconds. The parent screenshot confirmed only the right-hand rounded webpage overlay, with no native Chrome side panel. Evidence: `/tmp/computer-use/d22aa74b-8fdf-45ff-aaac-7f131c1e52a1.6f9c6504-9417-4b67-bfdf-d74f68bc3144.webp`.
- **13:38 SGT — PDF passed:** a new tab at the original Lilly URL, one canvas Ctrl+E, wait ten seconds. The parent screenshot confirmed only the native Chrome side panel with the Representer header, no webpage overlay; the panel remained open and read **59 pages / 4,443,082 bytes / 66,609 characters**. Evidence: `/tmp/computer-use/d22aa74b-8fdf-45ff-aaac-7f131c1e52a1.092f9f1b-aafc-4cb5-ae53-5a32930b34a4.webp`.

These results supersede the earlier pending **f63e4b3 production HTML/PDF** status; the earlier entries remain as the chronology. No model API key was configured, and the summary reported `Summary failed: No API key`, so model summarization is **not** accepted by this run. This is Linux Ctrl+E acceptance, not macOS Cmd+E or Yaphet's own-device acceptance.

This update is documentation only: no code change, rebuild, merge or release. The frozen f63e4b3 production package remains unchanged:

- `/workspace/artifacts/pr45/f63e4b3d7b2687c3e83e978bfcaa016e0a15fe6f/production/representer-pr45-f63e4b3-production.zip`
- SHA256: `cb17d4c463770c962c29f55bd2ad9d28ee44d58dfc59fed39ea50887ded745d0`.
