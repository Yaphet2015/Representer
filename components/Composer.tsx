import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useT } from './i18n';
import { Plus } from './Icons';
import { SlashMenu, slashKeyAction, type SlashItem } from './SlashMenu';

const LINE_PX = 18; // 13px * 1.4 line-height, rounded
const MAX_LINES = 6;
const MIN_PX = 36;

interface Props {
  value: string; onChange(v: string): void; onSubmit(): void;
  disabled: boolean; canSend: boolean; status: string;
  /** non-empty → the slash menu is open */
  slashItems: SlashItem[]; onPickSlash(it: SlashItem): void;
  /** every quick action, for the + menu; picking one uses what is typed as its input */
  quickItems: SlashItem[]; onPickQuick(it: SlashItem): void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Which menu is showing: typing "/" wins over the + menu. */
export function openMenu(slash: SlashItem[], quick: SlashItem[], plusOpen: boolean): { mode: 'slash' | 'plus' | null; items: SlashItem[] } {
  if (slash.length) return { mode: 'slash', items: slash };
  if (plusOpen && quick.length) return { mode: 'plus', items: quick };
  return { mode: null, items: [] };
}

/**
 * Floating glass composer (G2) with the quick-actions + button (H5b) at its bottom-left: auto-growing input (1–6 lines,
 * then scroll), "/" and + menus sharing one list and one keyboard model (↑↓, Tab/Enter, Esc).
 */
export function Composer({ value, onChange, onSubmit, disabled, canSend, status, slashItems, onPickSlash, quickItems, onPickQuick, inputRef }: Props) {
  const t = useT();
  const [active, setActive] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const menu = openMenu(slashItems, disabled ? [] : quickItems, plusOpen);
  useEffect(() => setActive(0), [value, menu.mode]);
  useEffect(() => { if (disabled) setPlusOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = 'auto';
    const max = LINE_PX * MAX_LINES;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_PX), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const pick = (it: SlashItem) => {
    if (menu.mode === 'plus') { setPlusOpen(false); onPickQuick(it); } else onPickSlash(it);
  };
  const plusOn = menu.mode === 'plus';

  return (
    <div data-dock className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] px-3 pb-3">
      <div className="pointer-events-auto">
        <SlashMenu id="rp-quick-menu" items={menu.items} active={active} onPick={pick} onHover={setActive} />
      </div>
      <div
        role="presentation" data-composer
        onClick={() => inputRef.current?.focus()}
        className="rp-composer pointer-events-auto flex cursor-text flex-col gap-2 px-3 pb-2 pt-2.5"
      >
        <textarea
          ref={inputRef} rows={1} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setPlusOpen(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            const act = slashKeyAction(e, menu.items, active, value);
            if (act) {
              e.preventDefault();
              if (act.type === 'move') setActive(act.active);
              else if (act.type === 'close') { if (menu.mode === 'plus') setPlusOpen(false); else onChange(''); }
              else pick(act.item);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
          }}
          placeholder={disabled ? t.placeholderWait : t.placeholder}
          aria-label={t.inputLabel}
          aria-controls={menu.mode ? 'rp-quick-menu' : undefined}
          className="rp-scroll block min-h-[36px] w-full resize-none overflow-hidden bg-transparent text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center gap-2">
          <button
            type="button" data-plus aria-label={t.quickActions} title={t.quickActions} aria-haspopup="listbox" aria-expanded={plusOn}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault() /* keep the input focused, so the keyboard drives the menu */}
            onClick={(e) => { e.stopPropagation(); if (menu.mode === 'slash') { onChange(''); setPlusOpen(true); } else setPlusOpen((o) => !o); inputRef.current?.focus(); }}
            className={`grid size-7 shrink-0 place-items-center rounded-lg transition-[background-color,color] duration-150 disabled:opacity-50 ${plusOn ? 'bg-[color-mix(in_srgb,var(--accent)_14%,rgba(255,255,255,.6))] text-accent-ink' : 'text-ink-2 enabled:hover:bg-hover'}`}
          >
            <Plus className={`size-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${plusOn ? 'rotate-45' : ''}`} />
          </button>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{status}</span>
          <button
            type="button" data-send aria-label={t.send} title={t.send} disabled={!canSend} onClick={onSubmit}
            className="grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 enabled:active:scale-[0.96]"
            style={canSend
              ? { background: 'var(--accent)', color: '#fff', boxShadow: '0 2px 6px -1px color-mix(in srgb, var(--accent) 50%, transparent)' }
              : { background: 'var(--line-strong)', color: 'var(--ink-2)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
