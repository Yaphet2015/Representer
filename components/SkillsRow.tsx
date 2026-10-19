import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import type { Skill } from '@/lib/skills';

/** Single-row, horizontally scrollable Skill pills: hidden scrollbar, wheel → horizontal, fade edges. */
export function SkillsRow({ skills, onRun, disabled }: { skills: Skill[]; onRun: (s: Skill) => void; disabled: boolean }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = ref.current; if (!el) return;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault(); el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(update); ro.observe(el);
    update();
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect(); };
  }, [skills.length]);
  if (!skills.length) return null;
  const mask = `linear-gradient(to right, ${edges.left ? 'transparent 0, #000 24px' : '#000 0'}, ${edges.right ? '#000 calc(100% - 24px), transparent 100%' : '#000 100%'})`;
  return (
    <div
      ref={ref} data-skills-row onScroll={update}
      className="rp-noscrollbar absolute inset-x-0 bottom-[calc(100%-8px)] z-10 flex gap-1.5 overflow-x-auto px-3 pb-4 pt-2" /* floats over the messages, no background. The scroller clips vertically, so the padding holds the chips' shadow; the extra bottom padding dips 8px into the composer area to keep the chips 8px above the input */
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {skills.map((s) => (
        <button
          key={s.id} type="button" disabled={disabled} title={t.runSkill(s.name)}
          onMouseDown={(e) => e.preventDefault() /* keep page selection + composer focus */}
          onClick={() => onRun(s)}
          className="inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-surface px-2.5 text-[12px] text-ink shadow-float transition-[background-color,transform,color] duration-150 hover:bg-accent-tint hover:text-accent-ink active:scale-[0.96] disabled:opacity-50"
        >
          {s.icon && <span aria-hidden>{s.icon}</span>}{s.name}
        </button>
      ))}
    </div>
  );
}
