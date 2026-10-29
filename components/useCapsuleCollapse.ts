import { useCallback, useEffect, useRef, useState } from 'react';
import { collapseForPage, EXPANDED, GLASS_TOP, stepCollapse, type CollapseState, type Tab } from '@/lib/capsule';

/** how long after a wheel / touch / key / scrollbar press the following scroll events count as the reader's own */
const USER_WINDOW_MS = 400;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Follows the active page's scroller (overview or chat messages) and says whether the floating capsule is collapsed
 * and whether content is passing under it (frosted layer). Rules in lib/capsule.ts; this only feeds it events.
 * Each page's scroll position is remembered, so switching back restores it and decides the capsule from there.
 */
export function useCapsuleCollapse(tab: Tab) {
  const [state, setState] = useState<CollapseState>(EXPANDED);
  const [glass, setGlass] = useState(false);
  const tabRef = useRef(tab); tabRef.current = tab;
  const saved = useRef<Partial<Record<Tab, number>>>({});
  const cleanup = useRef<() => void>(() => {});

  const scrollRef = useCallback((el: HTMLElement | null) => {
    cleanup.current(); cleanup.current = () => {};
    if (!el) return;
    const page = tabRef.current;
    const keep = saved.current[page];
    if (keep) el.scrollTop = keep;
    let last = el.scrollTop, userUntil = 0, frame = 0;
    const range = () => el.scrollHeight - el.clientHeight;
    setState(collapseForPage(last, range()));
    setGlass(last >= GLASS_TOP);
    const mark = () => { userUntil = performance.now() + USER_WINDOW_MS; };
    const onKey = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key) && !editable(e.target)) mark(); };
    // a press on the scroller itself (not on its content) is the scrollbar
    const onDown = (e: PointerEvent) => { if (e.target === el) mark(); };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = el.scrollTop;
        const sample = { top, prevTop: last, range: range(), user: performance.now() < userUntil };
        last = top;
        saved.current[page] = top;
        setState((s) => stepCollapse(s, sample));
        setGlass(top >= GLASS_TOP);
      });
    };
    el.addEventListener('wheel', mark, { passive: true });
    el.addEventListener('touchmove', mark, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('wheel', mark); el.removeEventListener('touchmove', mark);
      el.removeEventListener('keydown', onKey); el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => () => cleanup.current(), []);

  /** hovering or focusing the capsule always opens it; it folds again only after more reading down */
  const expand = useCallback(() => setState((s) => (s.collapsed ? { collapsed: false, acc: 0, dir: 0 } : s)), []);
  return { collapsed: state.collapsed, glass, scrollRef, expand };
}
