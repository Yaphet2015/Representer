/**
 * Locating overview items in the live page (content script only). Kept out of Overview.tsx so a page that only
 * shows a stored overview (settings → history) doesn't bundle the page/frame extraction code this pulls in.
 */
import { jumpToFingerprint, getLastMergedPage } from '@/lib/frame-bridge';
import { TOP_FRAME_ID } from '@/lib/frames';
import { jumpTo, liveIndex, resolveItem, type Anchors, type Item } from '@/lib/locate';
import type { Locator } from './Overview';

export const liveLocator: Locator = {
  locatable(items, anchors) {
    const live = liveIndex(document);
    const sources = getLastMergedPage()?.sources ?? [];
    return new Set(items.filter(([, it]) => {
      const fp = it.anchor ? anchors?.[it.anchor] : undefined;
      if (fp?.sk && fp.sk !== 'top') return sources.some((s) => s.sk === fp.sk);
      if (fp?.f != null && fp.f !== TOP_FRAME_ID && !fp.sk) return sources.some((s) => s.frameId === fp.f); // legacy anchors without sk: transport id only
      return !!resolveItem(live, anchors, it);
    }).map(([k]) => k));
  },
  async go(item: Item, anchors?: Anchors) {
    const fp = item.anchor ? anchors?.[item.anchor] : undefined;
    if (fp && ((fp.sk && fp.sk !== 'top') || (fp.f != null && fp.f !== TOP_FRAME_ID))) return jumpToFingerprint(fp);
    const el = resolveItem(liveIndex(document), anchors, item);
    if (el) { jumpTo(el); return 'ok'; }
    return fp ? jumpToFingerprint(fp) : 'ok'; // nothing to look for: a silent no-op, as before
  },
  observe(onChange) {
    // our overlay is attached to <html>, outside <body>, so its own updates don't trigger this
    const mo = new MutationObserver(onChange);
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  },
};
