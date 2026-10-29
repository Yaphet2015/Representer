/* Floating capsule: the panel's Overview / Chat switch, floating over the top of the content (no header bar).
   Built from Beautiful UI tokens. Collapses to its two icons while reading down; see lib/capsule.ts for when. */
import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { nextTab, TABS, type Tab } from '@/lib/capsule';
import { useT } from './i18n';
import { ChatBubble, Close, Sparkle } from './Icons';
import { LoaderGrid } from './bui/LoadingState';

export function Capsule({ value, onChange, collapsed = false, summarizing = false, frost = false }: { value: Tab; onChange: (t: Tab) => void; collapsed?: boolean; /** content is scrolling underneath: a small frosted patch behind the capsule only */ frost?: boolean; /** the overview is being written: flowing border + pixel icon */ summarizing?: boolean }) {
  const t = useT();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = nextTab(value, e.key);
    if (!to) return;
    e.preventDefault();
    onChange(to);
    refs.current[to]?.focus();
  };
  const label = { overview: t.tabOverview, chat: t.tabChat };
  return (
    <div role="tablist" aria-label={t.tabsLabel} onKeyDown={onKeyDown} data-capsule data-collapsed={collapsed || undefined} data-summarizing={summarizing || undefined}
      className="relative flex h-8 gap-0.5 rounded-[11px] bg-surface p-0.5 shadow-float">
      <FrostPatch on={frost} />
      {summarizing && <span aria-hidden data-flow className="rp-flow"><i /></span>}
      {TABS.map((id) => {
        const selected = id === value;
        return (
          <button key={id} ref={(el) => { refs.current[id] = el; }} type="button" role="tab" data-tab={id}
            aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => onChange(id)}
            title={collapsed ? label[id] : undefined} aria-label={collapsed ? label[id] : undefined}
            className={cn(
              'relative inline-flex h-7 select-none items-center justify-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[9px] text-[14px] font-semibold leading-none',
              'transition-[width,padding,background-color,color,transform] duration-200 ease-out-strong active:scale-[.97] motion-reduce:transition-none',
              // a ring, not an outline: the panel stylesheet strips outlines (assets/tailwind.css)
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
              collapsed ? 'w-7 px-0' : 'px-2.5',
              selected ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent-ink' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
            )}>
            {id === 'overview'
              ? (summarizing ? <LoaderGrid tone="bg-accent" /> : <Sparkle className="size-3.5 shrink-0" />)
              : <ChatBubble className="size-3.5 shrink-0" />}
            {/* fades out, then leaves the layout so the cell can shrink to the icon */}
            <span data-label className={cn('transition-opacity duration-[120ms] motion-reduce:transition-none', collapsed ? 'hidden opacity-0' : 'opacity-100')}>{label[id]}</span>
            {id === 'overview' && summarizing && <span className="sr-only">{t.summarizing}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The round close button floating at the top right; Esc inside the panel does the same. Not part of the tab list. */
export function CloseButton({ onClose, frost = false }: { onClose: () => void; frost?: boolean }) {
  const t = useT();
  return (
    <span className="relative block">
    <FrostPatch on={frost} />
    <button type="button" data-close onClick={onClose} aria-label={t.close} title={t.closeEsc}
      className="grid size-8 place-items-center rounded-[11px] bg-surface text-ink-2 shadow-float transition-colors duration-150 hover:bg-hover hover:text-ink active:scale-[.97] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1">
      <Close className="size-4" />
    </button>
    </span>
  );
}

/**
 * Local frosted glass behind one floating control (not a full-width strip): 6px outside the control, same corner
 * shape, edges feathered by a mask so it melts into the content scrolling underneath.
 */
export function FrostPatch({ on }: { on: boolean }) {
  return <span aria-hidden data-frost={on || undefined} className={cn('rp-frost-patch pointer-events-none absolute -inset-1.5 -z-10 rounded-[17px] transition-opacity duration-200 motion-reduce:transition-none', on ? 'opacity-100' : 'opacity-0')} />;
}
