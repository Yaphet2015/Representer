# HTML shortcut audit — 2026-11-22 SGT

## Acceptance status supplied by parent

c66eec8 production, a new PDF document, one canvas Ctrl+E: native side panel read all 59 pages and remained visible. The diagnostic build did likewise. Retain that positive evidence. The earlier disappearance incident is not an established application-close bug; the action called “toolbar” lacked a toolbar trace and may have been Chrome's own panel toggle.

On a new example.com document with no hash, a single canvas Ctrl+E left neither overlay nor side panel visible. This source audit does not claim that this particular fresh document had stale shortcut state or that Chrome delivers both DOM keydown and onCommand for an assigned key. Those facts need live evidence.

## Confirmed independent defect and executed reproduction

The content entry cached whether getShortcut was empty at startup and visibilitychange. Background getShortcut calls the real chrome.commands.getAll handler. There is no settings-change event in this code to update a visible document when shortcuts are edited.

Both local keydown and background TOGGLE call the **same** toggle() function and share its 200ms de-duplication. It is incorrect to say the local path had no de-duplication. But 200ms is only a time window, not ownership of a physical keypress. If cached NotSet is stale and both paths arrive more than 200ms apart, the first opens/mounts and the second emits bus.toggle, closing the overlay. The background MIME inspection, ping and possible content injection are asynchronous, so code does not guarantee their completion inside that window.

`tests/html-command-keyboard.test.ts` runs the real background.ts main, its real getShortcut handler, the real PDF/HTML router, real messages.rpc, real content main and real bus, bridged by mocked Chrome APIs. Rendering/mounting is a test double: a boolean follows mount plus the same toggle bus that App uses (App initializes open:true). It does not paint a browser DOM or prove actual Chrome key delivery.

Against c66eec8, five initial cases yielded three failures:
- cached NotSet -> assigned Ctrl+E, DOM fallback first, background command toggle after 500ms: overlay ends closed;
- same stale state, background command first and later DOM event: overlay ends closed;
- cached assigned Ctrl+E -> NotSet without visibilitychange: fallback never opens.

The two passing controls were a freshly assigned HTML shortcut (including loading-kind invalidation) and a genuinely unassigned local fallback toggled twice intentionally. Thus stale state is a confirmed defect, but the fresh-assigned control also shows why it cannot simply be asserted as the cause of the latest new-tab screenshot.

## Minimal ownership repair

Before a local fallback toggles, it now queries getShortcut again and only proceeds if the authoritative reply is successful and empty. The cached flag is only a synchronous preventDefault hint; it no longer authorizes local UI toggling. Both directions of shortcut reconfiguration work without a visibility event. An assigned default or different custom shortcut leaves UI ownership to chrome.commands. A failed lookup never guesses that the command is unassigned.

No timer/window extension, PDF routing modification, permission, network call or new fetch route was introduced. The extra lookup is an extension-internal message/API query on a candidate HTML Ctrl/Meta+E keydown. Background PDF open remains unchanged and is never preceded by this HTML lookup from a PDF-kind content context.

The timing controls cover command delay 0, 199, 200, 500 and 2000ms. A diagnostic integration case also verifies actual content-to-worker stage recording. Existing orphan-context and affirmative-PDF content tests remain passing.

## Diagnostic evidence for the still-unconfirmed fresh-document failure

Worker adds web-toggle-request/resolved around its existing HTML TOGGLE send. Content reports a closed allowlist of stage names to the existing worker message listener (frame 0 only), which writes them under rp-entry-check-v1. This avoids forbidden direct content access to storage.session. No new worker event subscription is added.

Content stages distinguish: command owns key vs real local fallback vs shortcut lookup failure; TOGGLE-message vs keydown toggle; 200ms suppression; create/mount request, mount completion, existing-UI toggle and mounting rejection. Mount completion means u.mount returned, not proof of React paint or visibility. Production excludes these diagnostic messages and records.

If the fresh HTML screenshot still fails, use the diagnostic package and preserve one atomic canvas action with the chronological key snapshot:
- no command: environment/shortcut delivery evidence is needed, not another PDF patch;
- command + mime-web + web-toggle-request but no content-toggle-message: investigate document-targeted message/content delivery;
- content-mount-request then content-mount-rejected: creation failed;
- content-mounted and no later toggle-existing yet invisible: investigate actual DOM/rendering/desktop state; don't call it double-toggle;
- two accepted toggle sources with toggle-existing: a real duplicate is established.

Do not claim the new package passed GUI HTML or PDF until parent screenshots verify it. c66eec8 PDF acceptance remains a fact for that frozen package.
