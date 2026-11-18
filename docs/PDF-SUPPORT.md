# PDF support: first vertical slice

## Decisions

| Decision | Source / reason |
|---|---|
| Browser side panel, original PDF untouched | User rejected a separate tab. Native PDF side-panel + local-worker extraction was verified in Chrome on the user's 59-page Lilly file (probe only). No default-reader replacement or navigation interception. |
| Existing settings canvas, 13px text, accent button, Overview renderer | Existing Representer design system is the direct-build reference. No new branding or imagery. Read → explicit model summary → chat, with local source-page text. |
| Side panel only for a toolbar-selected unknown/PDF document | Normal content scripts announce HTML and keep the overlay. If the service worker forgot that announcement, open synchronously in the toolbar gesture, ping the document, then hand HTML back to its overlay without fetching it. Chrome before 141 may need a manual sidebar close. |
| Separate source context for Overview | No PDF paragraph is a DOM fingerprint. Block IDs map deterministically to PDF page numbers; repeated sentences cannot choose another page by fuzzy matching. No native-viewer highlight/jump claim. |
| Explicit Read / Summarize / Send | No automatic download or model call. The read path cannot access model configuration or write local summary caches. Existing summary/chat background protocols own any deliberate model call and normal cache writes. |
| Dedicated `pdf:v1:` summary/session cache key | Never reuse a webpage DOM cache for a PDF at the same URL. No raw PDF byte persistence. |
| Session authorization, not a free URL fetch RPC | Only a real action's current tab URL is selected. Exact active-tab/canonical-URL/token checks before/after parsing and before model actions. Session storage survives worker suspension; navigation/reload/tab removal revokes. Thirty-minute expiry. No background fetch service. |
| Reject redirects, omit cookies, block known local URLs | Do not turn the extension into a credentialed or arbitrary cross-origin fetch proxy. This is not DNS resolution; public hosts resolving internally remain a limitation. |
| All page text or explicit failure | 64 MiB, 300 pages, 350k characters including markers, 90 seconds; no first-three-page production shortcut. Image-only and password protection fail explicitly. Mixed empty pages are listed. |
| Lazy local PDF.js legacy bundle | No parser in content/options. Worker, standard fonts and CMaps stay local. No PDF scripting/action API is invoked. Tables/reading order/graphics are lossy and disclosed. |

## Verification boundary

The **probe** demonstrated native PDF → side panel → 4,434,082-byte HTTP PDF → local worker → three-page preview.
That is not browser acceptance of this production implementation. Unit tests now exercise a small real three-page PDF (unique English/Chinese markers, repeated sentences and two columns), a password-protected PDF, a blank file, bounded streaming, full-document chunking, navigation/user-action grants (including worker suspension), and sidebar interaction/source-page selection without a model or local-storage writes.

Production Chrome acceptance still needs: normal webpage routing, PDF toolbar opening/no new tab, Read with all-page counts/source pages/cancellation, theme and narrow sidebar, explicit summary/chat with the user's approval or a sanctioned test model, and navigation/reload expiry. No browser was driven by shell, and the large original PDF was not fetched again during development.
