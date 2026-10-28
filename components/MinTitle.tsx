import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Page title on the minimized bar; it gives way (hides) when less than `MIN_TITLE_WIDTH` px are left for it. */
export const MIN_TITLE_WIDTH = 48;
export function MinTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setFits(el.clientWidth >= MIN_TITLE_WIDTH);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <span ref={ref} aria-hidden={!fits} className={`min-w-0 flex-1 truncate text-[12px] text-ink-2 ${fits ? '' : 'invisible'}`}>{children}</span>;
}
