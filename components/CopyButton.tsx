import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';
import { useT } from './i18n';
import { Button } from './bui/Button';
import { Check, Copy } from './Icons';

const FEEDBACK_MS = 1500;
const TIP = {
  top: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
  bottom: 'top-full left-0 mt-1',
  left: 'right-full top-1/2 mr-1 -translate-y-1/2',
} as const;

/**
 * Small icon button that copies Markdown. Shows a check (and a "Copied" bubble) for 1.5s afterwards.
 * `reveal`: hidden until the parent `.group` is hovered or focused (always visible on touch screens and when focused).
 */
export function CopyButton({ getText, label, reveal = false, tip = 'top', className = '' }: { getText: () => string; label: string; reveal?: boolean; /** where the "Copied" bubble goes (pick a side with room: the list clips at its edges) */ tip?: 'top' | 'bottom' | 'left'; className?: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    const ok = await copyText(getText());
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), FEEDBACK_MS);
  };
  const text = state === 'copied' ? t.copied : state === 'failed' ? t.copyFailed : label;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <Button
        type="button" variant="quiet" size="icon-sm" onClick={onClick}
        title={text} aria-label={text} data-copy={state}
        className={`text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${state === 'copied' ? 'text-green hover:text-green' : ''} ${reveal ? 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100' : ''} ${state !== 'idle' ? '!opacity-100' : ''}`}
      >
        {state === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      {/* live region: announces the result to screen readers; the bubble is the visible tooltip */}
      <span role="status" aria-live="polite" className="sr-only">{state === 'idle' ? '' : text}</span>
      {state !== 'idle' && (
        <span aria-hidden className={`pointer-events-none absolute z-10 whitespace-nowrap ${TIP[tip]} rounded-chip bg-ink px-2 py-1 text-[11px] leading-none text-surface shadow-float`}>{text}</span>
      )}
    </span>
  );
}
