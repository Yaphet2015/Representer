import { useEffect, useState, type ReactNode } from 'react';
import { activeSection } from '@/lib/active-section';

/**
 * Nav highlight for the settings page: always the section at the reading line (lib/active-section), recomputed on
 * scroll, resize and content resize. `go(id)` scrolls the section to the top. That lands it on the reading line
 * because <SectionTail> keeps at least a viewport of page below the last section's top; without that room the
 * browser stops (or later clamps) the scroll short of the target, and the geometry correctly says an earlier
 * section is at the top, which is how History used to lose its highlight to Skills, Shortcuts or Custom instructions.
 */
export function useActiveSection(ids: readonly string[]): [string, (id: string) => void] {
  const [active, setActive] = useState<string>(ids[0]!);
  useEffect(() => {
    let frame = 0;
    const compute = () => {
      frame = 0;
      const boxes = ids.flatMap((id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return r ? [{ id, top: r.top, bottom: r.bottom }] : []; });
      const id = activeSection(boxes, { height: window.innerHeight, scrollY: window.scrollY });
      if (id) setActive(id);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(compute); };
    const ro = new ResizeObserver(schedule);
    const main = document.querySelector('main'); if (main) ro.observe(main);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); ro.disconnect();
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    };
  }, [ids]);
  const go = (id: string) => { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  return [active, go];
}

/** Wraps the last section: at least one viewport tall, so any section can be scrolled to the top and stay there. */
export function SectionTail({ children }: { children: ReactNode }) { return <div data-section-tail className="min-h-screen">{children}</div>; }
