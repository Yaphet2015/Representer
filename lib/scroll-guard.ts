/**
 * Keep scrolling inside the panel from reaching the host page (scroll chaining). CSS overscroll-behavior covers the
 * scroll containers; this covers everything else (areas that don't scroll at all, e.g. the capsule or the composer).
 */
export type ScrollBox = {
  scrollTop: number; scrollHeight: number; clientHeight: number;
  scrollLeft: number; scrollWidth: number; clientWidth: number;
  /** which axes the element's overflow allows scrolling on */
  canX: boolean; canY: boolean;
};

/** Can this box scroll any further in the direction of (dx, dy)? 1px slack for fractional scroll positions. */
export function canScrollToward(b: ScrollBox, dx: number, dy: number): boolean {
  if (dy && b.canY) {
    if (dy > 0 && b.scrollTop + b.clientHeight < b.scrollHeight - 1) return true;
    if (dy < 0 && b.scrollTop > 0.5) return true;
  }
  if (dx && b.canX) {
    if (dx > 0 && b.scrollLeft + b.clientWidth < b.scrollWidth - 1) return true;
    if (dx < 0 && b.scrollLeft > 0.5) return true;
  }
  return false;
}

/** Block the event when no scrollable ancestor (target up to the panel root) can take it: it would otherwise scroll the page. */
export function shouldBlockScroll(chain: ScrollBox[], dx: number, dy: number): boolean {
  if (!dx && !dy) return false;
  return !chain.some((b) => canScrollToward(b, dx, dy));
}

const SCROLLS = /^(auto|scroll|overlay)$/;
function boxOf(el: Element): ScrollBox {
  const cs = getComputedStyle(el);
  const tag = el.tagName;
  const field = tag === 'TEXTAREA';
  return {
    scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    canY: field || SCROLLS.test(cs.overflowY), canX: field || SCROLLS.test(cs.overflowX),
  };
}

/** Scroll boxes from the event target up to (and including) the panel root. */
function chainOf(e: Event, root: Element): ScrollBox[] {
  const out: ScrollBox[] = [];
  for (const n of e.composedPath()) {
    if (!(n instanceof Element)) continue;
    out.push(boxOf(n));
    if (n === root) break;
  }
  return out;
}

/** Attach the wheel / touch guard to the panel root. Returns the cleanup. */
export function guardScroll(root: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return; // pinch-zoom
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    if (shouldBlockScroll(chainOf(e, root), dx, dy)) e.preventDefault();
  };
  let last: { x: number; y: number } | null = null;
  const onStart = (e: TouchEvent) => { const t = e.touches[0]; last = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null; };
  const onMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!last || !t || e.touches.length !== 1) return;
    const dx = last.x - t.clientX, dy = last.y - t.clientY; // finger up = content down
    last = { x: t.clientX, y: t.clientY };
    if (e.cancelable && shouldBlockScroll(chainOf(e, root), dx, dy)) e.preventDefault();
  };
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('touchstart', onStart, { passive: true });
  root.addEventListener('touchmove', onMove, { passive: false });
  return () => { root.removeEventListener('wheel', onWheel); root.removeEventListener('touchstart', onStart); root.removeEventListener('touchmove', onMove); };
}
