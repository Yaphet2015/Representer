/* SegmentedControl — local component built from Beautiful UI tokens (ink / hover / line / accent), after the Button conventions.
   A filled, full-width tab strip: the selected cell is solid ink and slides between cells. */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

export type SegmentItem<T extends string> = {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  /** shown after the label (e.g. a "still generating" dot) */
  badge?: ReactNode;
};

/** ←/→ move (wrapping) and Home/End jump to the ends; disabled cells are skipped. Null when the key does nothing. */
export function nextSegment<T extends string>(items: SegmentItem<T>[], value: T, key: string): T | null {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return null;
  const enabled = items.filter((i) => !i.disabled);
  if (!enabled.length) return null;
  const at = enabled.findIndex((i) => i.id === value);
  const to = key === 'Home' ? 0 : key === 'End' ? enabled.length - 1 : (at + (key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
  return enabled[to]?.id ?? null;
}

export function SegmentedControl<T extends string>({ items, value, onChange, label, compact = false, className }: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** accessible name of the tab list */
  label: string;
  /** fixed-size cells instead of filling the row (minimized bar) */
  compact?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = nextSegment(items, value, e.key);
    if (target === null) return;
    e.preventDefault();
    onChange(target);
    refs.current[target]?.focus();
  };

  return (
    <div
      role="tablist" aria-label={label} onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}
      className={cn('flex h-9 min-w-0 gap-[2px] rounded-card bg-hover p-[3px] shadow-[inset_0_0_0_1px_var(--line)]', compact ? 'flex-none' : 'max-w-[300px] flex-1', className)}
    >
      {items.map((it) => {
        const selected = it.id === value;
        return (
          <button
            key={it.id} ref={(el) => { refs.current[it.id] = el; }}
            type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} disabled={it.disabled}
            onClick={() => onChange(it.id)}
            data-tab={it.id}
            className={cn(
              'relative inline-flex h-[30px] min-w-0 select-none items-center justify-center whitespace-nowrap rounded-control text-[14px] font-semibold leading-none',
              'transition-[transform,background-color,color] duration-150 ease-out-strong active:scale-[0.97]',
              // a ring, not an outline: the panel stylesheet strips outlines (assets/tailwind.css)
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-hover',
              'disabled:pointer-events-none disabled:opacity-50',
              compact ? '' : 'flex-1',
              selected ? 'text-surface' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
            )}
          >
            {selected && (
              <motion.span
                layoutId="rp-tab-pill" data-tab-pill aria-hidden
                className="absolute inset-0 rounded-control bg-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18)]"
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              />
            )}
            {/* padding sits on the label, not the cell, so cells stay equal width (flex-1 would add the padding to each share) */}
            <span className={cn('relative inline-flex items-center', compact ? 'px-[14px]' : it.badge ? 'px-2' : 'px-3')}>{it.label}{it.badge}</span>
          </button>
        );
      })}
    </div>
  );
}
