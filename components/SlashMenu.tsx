import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Skill } from '@/lib/skills';
import { useT } from './i18n';
import type { Messages } from '@/lib/i18n';
import { Fork } from './Icons';

export type SlashItem = { key: string; cmd: string; desc: string; icon?: React.ReactNode; skill?: Skill };

export function slashItems(input: string, skills: Skill[], t: Pick<Messages, 'slashSide'>): SlashItem[] {
  if (!input.startsWith('/')) return [];
  const q = input.slice(1).split(/\s/)[0]!.toLowerCase();
  if (/\s/.test(input) && !/^\/side\b/i.test(input)) return [];
  const all: SlashItem[] = [
    { key: 'side', cmd: '/side', desc: t.slashSide, icon: <Fork className="mx-auto h-3.5 w-3.5 text-ink-2" /> },
    ...skills.map((s) => ({ key: s.id, cmd: '/' + s.name, desc: 'Skill · ' + s.template.replace(/\s+/g, ' ').slice(0, 28) + '…', icon: s.icon, skill: s })),
  ];
  if (/^\/side\s/i.test(input)) return all.slice(0, 1);
  return all.filter((i) => i.cmd.slice(1).toLowerCase().includes(q));
}

export type SlashKeyAction = { type: 'move'; active: number } | { type: 'pick'; item: SlashItem } | { type: 'close' };

/** What a key press does while the menu is open (null: not a menu key, the composer handles it as usual). */
export function slashKeyAction(e: { key: string; shiftKey: boolean }, items: SlashItem[], active: number, value: string): SlashKeyAction | null {
  if (!items.length) return null;
  if (e.key === 'ArrowDown') return { type: 'move', active: (active + 1) % items.length };
  if (e.key === 'ArrowUp') return { type: 'move', active: (active - 1 + items.length) % items.length };
  if (e.key === 'Escape') return { type: 'close' };
  const item = items[active];
  const typedSide = /^\/side(\s|$)/i.test(value);
  if (item && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !(typedSide && item.key === 'side')))) return { type: 'pick', item };
  return null;
}

/** Preferred menu height; the real limit is the room between the chat's top edge and the composer. */
export const MENU_MAX_PX = 224;
const MENU_GAP_PX = 6; // matches mb-1.5
const MENU_EDGE_PX = 6; // breathing room to the top edge of the chat area
const MENU_MIN_PX = 48;

/** Largest height that keeps the menu inside the area above its anchor (never clipped by the panel, never over the header). */
export function menuMaxHeight(anchorTop: number, areaTop: number): number {
  return Math.round(Math.min(MENU_MAX_PX, Math.max(MENU_MIN_PX, anchorTop - areaTop - MENU_GAP_PX - MENU_EDGE_PX)));
}

/**
 * The menu opens upward from the composer's wrapper. Its height follows the panel: it is re-measured whenever the
 * wrapper or the chat area changes size (window resize, composer growing to more lines).
 */
function useFitAbove(ref: React.RefObject<HTMLDivElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current; const anchor = el?.offsetParent as HTMLElement | null; const area = anchor?.parentElement;
    if (!el || !anchor || !area) return;
    const fit = () => { el.style.maxHeight = `${menuMaxHeight(anchor.getBoundingClientRect().top, area.getBoundingClientRect().top)}px`; };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit); ro.observe(anchor); ro.observe(area);
    return () => ro.disconnect();
  }, [ref, open]);
}

export function SlashMenu({ items, active, onPick, onHover }: { items: SlashItem[]; active: number; onPick: (i: SlashItem) => void; onHover: (i: number) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useFitAbove(ref, items.length > 0);
  // keyboard navigation must never select an item that is scrolled out of sight
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, items]);
  if (!items.length) return null;
  return (
    <div ref={ref} role="listbox" data-slash-menu className="absolute bottom-full left-3 right-3 z-20 mb-1.5 overflow-y-auto overscroll-contain rounded-card bg-surface p-1 shadow-card" style={{ maxHeight: MENU_MAX_PX, animation: 'pop-in 150ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom left' }}>
      <div className="px-2 pb-1 pt-0.5 text-[11px] text-ink-3">{t.slashHeader}</div>
      {items.map((it, i) => (
        <div key={it.key} role="option" aria-selected={i === active}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }} onMouseEnter={() => onHover(i)}
          className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 ${i === active ? 'bg-accent-tint' : ''}`}>
          <span className="w-4 text-center text-[13px]" aria-hidden>{it.icon ?? '⚡'}</span>
          <span className={`text-[13px] font-medium ${i === active ? 'text-accent-ink' : 'text-ink'}`}>{it.cmd}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{it.desc}</span>
        </div>
      ))}
    </div>
  );
}
