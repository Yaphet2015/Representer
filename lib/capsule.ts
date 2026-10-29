/**
 * Floating capsule (Overview / Chat switch at the top of the panel): when it collapses to icons on scroll,
 * and when Esc closes the panel. Pure, so the rules can be tested without a DOM.
 */

/** scrollTop at or below this always expands the capsule */
export const EXPAND_TOP = 8;
/** collapsing needs the reader at least this far down */
export const COLLAPSE_TOP = 48;
/** cumulative user scroll (px) in one direction before the capsule changes */
export const COLLAPSE_AFTER_DOWN = 24;
export const EXPAND_AFTER_UP = 16;
/** pages that barely scroll never collapse */
export const MIN_SCROLL_RANGE = 80;
/** the frosted layer under the capsule shows as soon as content passes beneath it */
export const GLASS_TOP = 4;

export type CollapseState = { collapsed: boolean; /** px scrolled in the current direction */ acc: number; dir: -1 | 0 | 1 };
export const EXPANDED: CollapseState = { collapsed: false, acc: 0, dir: 0 };

export type ScrollSample = {
  top: number;
  prevTop: number;
  /** scrollHeight - clientHeight */
  range: number;
  /** caused by the reader (wheel, touch, keys, scrollbar), not by code such as the chat following a streamed reply */
  user: boolean;
};

/** One scroll event. Only the reader's own scrolling collapses or expands; programmatic scrolls just reset the count. */
export function stepCollapse(s: CollapseState, e: ScrollSample): CollapseState {
  if (e.range < MIN_SCROLL_RANGE || e.top <= EXPAND_TOP) return EXPANDED;
  if (!e.user) return { ...s, acc: 0, dir: 0 };
  const delta = e.top - e.prevTop;
  if (!delta) return s;
  const dir = delta > 0 ? 1 : -1;
  const acc = (dir === s.dir ? s.acc : 0) + Math.abs(delta);
  if (dir > 0 && !s.collapsed && acc >= COLLAPSE_AFTER_DOWN && e.top >= COLLAPSE_TOP) return { collapsed: true, acc: 0, dir };
  if (dir < 0 && s.collapsed && acc >= EXPAND_AFTER_UP) return { collapsed: false, acc: 0, dir };
  return { collapsed: s.collapsed, acc, dir };
}

/** Switching to a page decides from where that page is scrolled to. */
export function collapseForPage(top: number, range: number): CollapseState {
  return range >= MIN_SCROLL_RANGE && top >= COLLAPSE_TOP ? { collapsed: true, acc: 0, dir: 0 } : EXPANDED;
}

/**
 * Esc pressed inside the panel closes it, unless something inside already handled it (the slash menu
 * calls preventDefault) or the key belongs to an IME composition.
 */
export function escClosesPanel(e: { key: string; defaultPrevented: boolean; isComposing?: boolean; keyCode?: number }): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode !== 229;
}

export type Tab = 'overview' | 'chat';
export const TABS: Tab[] = ['overview', 'chat'];
/** ←/→ move (wrapping) and Home/End jump to the ends. Null when the key does nothing. */
export function nextTab(value: Tab, key: string): Tab | null {
  const at = TABS.indexOf(value);
  if (key === 'Home') return TABS[0]!;
  if (key === 'End') return TABS[TABS.length - 1]!;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  return TABS[(at + (key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]!;
}
