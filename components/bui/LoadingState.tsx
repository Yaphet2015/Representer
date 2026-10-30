/*
 * LoadingState — from Beautiful UI (https://www.beautifului.dev/r/loading-state.json, MIT).
 * Trimmed: kept the Drive/Dots/Orbit pixel-grid loaders + shimmer label + elapsed timer;
 * removed the "Surfer" variant (it streams a remote video, which we don't want inside an extension).
 */
import { useEffect, useState, type ReactNode } from 'react';

const chevron = Array.from({ length: 9 }, (_, i) => { const r = Math.floor(i / 3), c = i % 3; return (c + Math.abs(r - 1)) * 90; });
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => { const k = ORBIT_ORDER.indexOf(i); return k === -1 ? null : k * 110; });
const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export function LoaderGrid({ delays = chevron, dur = 650, round = false, tone = 'bg-ink' }: { delays?: (number | null)[]; dur?: number; round?: boolean; /** cell colour class */ tone?: string }) {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((delay, i) => (
        <span key={i} className={`size-[4px] ${tone} ${round ? 'rounded-full' : 'rounded-[1px]'}`}
          style={{ opacity: delay === null ? 0.07 : 0.15, animation: delay === null ? 'none' : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite` }} />
      ))}
    </span>
  );
}

/** `since` (ms epoch): count from there, so a status that is re-mounted keeps its time */
function useElapsed(since?: number) {
  const [start] = useState(() => since ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  const total = Math.max(0, Math.floor((now - (since ?? start)) / 100)) / 10;
  return total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/** `label` may be a node (e.g. the reasoning line), shown as is instead of the shimmering text; the timer keeps running either way */
export default function LoadingState({ label = 'Churning', variant = 'Drive', tone, since }: { label?: ReactNode; variant?: string; tone?: string; since?: number }) {
  const elapsed = useElapsed(since);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive!;
  return (
    <div role="status" className={`flex items-center gap-2.5 ${typeof label === 'string' ? 'w-fit' : 'min-w-0 flex-1'}`}>
      <LoaderGrid delays={delays} dur={dur} round={round} tone={tone} />
      {typeof label !== 'string' ? label : <span className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{ backgroundImage: 'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)', backgroundSize: '200% 100%', animation: 'shimmer-text 1.4s linear infinite' }}>
        {label}
      </span>}
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-3">{elapsed}</span>
    </div>
  );
}
