/**
 * Copy text to the clipboard from inside the overlay (a content script in a Shadow DOM).
 * The async API is tried first; it can be refused there (no focus, page permissions policy), so it falls back
 * to a selected, off-screen textarea and `document.execCommand('copy')`. Resolves true when something worked.
 */
export async function copyText(text: string, doc?: Document): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  return legacyCopy(text, doc ?? document);
}

export function legacyCopy(text: string, doc: Document = document): boolean {
  const host = doc.body ?? doc.documentElement;
  const active = doc.activeElement as HTMLElement | null;
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  host.appendChild(ta);
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    try { active?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
  }
}
