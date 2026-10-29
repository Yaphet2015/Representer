import { useEffect, useLayoutEffect, useRef } from 'react';
import { DEFAULT_SKILLS, DEFAULT_SKILLS_EN, type Skill } from '@/lib/skills';
import type { Messages } from '@/lib/i18n';
import { BulletIcons, Fork, QuizIcon, Sparkle, Translate } from './Icons';

/** One quick action: the `/side` command or a Skill. The same list feeds the `/` menu and the + menu. */
export type SlashItem = { key: string; cmd: string; name: string; desc: string; icon: React.ReactNode; skill?: Skill };

const LINE: Record<string, (p: { className?: string }) => React.JSX.Element> = {
  'translate-en': Translate, 'key-points': BulletIcons.list, explain: BulletIcons.lightbulb, qa: QuizIcon,
};
const ICON_CLS = 'size-3.5 shrink-0 text-ink-2';

/** Short grey description: a fixed one for unedited built-in Skills, else the start of the prompt template. */
export function skillDesc(s: Skill, t: Pick<Messages, 'quickDesc'>): string {
  const pristine = [...DEFAULT_SKILLS, ...DEFAULT_SKILLS_EN].some((d) => d.id === s.id && d.template === s.template);
  if (pristine && t.quickDesc[s.id]) return t.quickDesc[s.id]!;
  const plain = s.template.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 12 ? plain.slice(0, 12) + '…' : plain;
}

/** Every quick action, in menu order: Skills (most recent first, as given), then /side. */
export function quickItems(skills: Skill[], t: Pick<Messages, 'quickDesc' | 'sideName' | 'sideDesc'>): SlashItem[] {
  return [
    ...skills.map((s) => { const I = LINE[s.id] ?? Sparkle; return { key: s.id, cmd: '/' + s.name, name: s.name, desc: skillDesc(s, t), icon: <I className={ICON_CLS} />, skill: s }; }),
    { key: 'side', cmd: '/side', name: t.sideName, desc: t.sideDesc, icon: <Fork className={ICON_CLS} /> },
  ];
}

/** Items for what is typed: the menu is open exactly while the input starts with "/" and something matches. */
export function slashItems(input: string, skills: Skill[], t: Pick<Messages, 'quickDesc' | 'sideName' | 'sideDesc'>): SlashItem[] {
  if (!input.startsWith('/')) return [];
  const q = input.slice(1).split(/\s/)[0]!.toLowerCase();
  if (/\s/.test(input) && !/^\/side\b/i.test(input)) return [];
  const all = quickItems(skills, t);
  const side = all.filter((i) => i.key === 'side');
  if (/^\/side\s/i.test(input)) return side;
  return all.filter((i) => i.cmd.slice(1).toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
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

/** Quick-actions menu (H5b): above the composer, same width, one 32px row per item — line icon, name, grey description. */
export function SlashMenu({ items, active, onPick, onHover, id }: { items: SlashItem[]; active: number; onPick: (i: SlashItem) => void; onHover: (i: number) => void; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitAbove(ref, items.length > 0);
  // keyboard navigation must never select an item that is scrolled out of sight
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, items]);
  if (!items.length) return null;
  return (
    <div ref={ref} id={id} role="listbox" data-slash-menu className="rp-menu absolute bottom-full left-3 right-3 z-20 mb-1.5 overflow-y-auto overscroll-contain p-1" style={{ maxHeight: MENU_MAX_PX, animation: 'pop-in 150ms cubic-bezier(0.23,1,0.32,1) both', transformOrigin: 'bottom left' }}>
      {items.map((it, i) => (
        <div key={it.key} role="option" aria-selected={i === active} data-item={it.key}
          onMouseDown={(e) => { e.preventDefault(); onPick(it); }} onMouseEnter={() => onHover(i)}
          className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink ${i === active ? 'bg-hover-2' : ''}`}>
          <span aria-hidden className="grid size-3.5 place-items-center">{it.icon}</span>
          <span className="truncate">{it.name}</span>
          <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[12px] text-ink-3">{it.desc}</span>
        </div>
      ))}
    </div>
  );
}
