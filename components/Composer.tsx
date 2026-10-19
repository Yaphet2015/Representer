import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useT } from './i18n';
import { SlashMenu, type SlashItem } from './SlashMenu';

const LINE_PX = 18; // 13px * 1.4 line-height, rounded
const MAX_LINES = 6;
const MIN_PX = 36; // keeps the box ~12px taller than the old two-line placeholder layout

interface Props {
  value: string; onChange(v: string): void; onSubmit(): void;
  disabled: boolean; canSend: boolean; status: string;
  /** non-empty → the slash menu is open */
  slashItems: SlashItem[]; onPickSlash(it: SlashItem): void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** Auto-growing composer (1–6 lines, then scroll) with slash-menu keyboard handling. */
export function Composer({ value, onChange, onSubmit, disabled, canSend, status, slashItems, onPickSlash, inputRef }: Props) {
  const t = useT();
  const [slashActive, setSlashActive] = useState(0);
  const showSlash = slashItems.length > 0;
  useEffect(() => setSlashActive(0), [value]);
  useLayoutEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = 'auto';
    const max = LINE_PX * MAX_LINES;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_PX), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  return (
    <>
      {showSlash && <SlashMenu items={slashItems} active={slashActive} onPick={onPickSlash} onHover={setSlashActive} />}
      {/* composer — adapted from Beautiful UI ChatComposer (https://www.beautifului.dev/r/chat-composer.json, MIT) */}
      <div className="px-3 pb-3">
        <div
          role="presentation"
          onClick={() => inputRef.current?.focus()}
          className="flex cursor-text flex-col gap-2 rounded-control border border-line bg-field px-2.5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.035)]"
        >
          <textarea
            ref={inputRef} rows={1} value={value} disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (showSlash) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSlashActive((a) => (a + 1) % slashItems.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSlashActive((a) => (a - 1 + slashItems.length) % slashItems.length); return; }
                if (e.key === 'Escape') { e.preventDefault(); onChange(''); return; }
                const it = slashItems[slashActive];
                const typedSide = /^\/side(\s|$)/i.test(value);
                if (it && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !(typedSide && it.key === 'side')))) { e.preventDefault(); onPickSlash(it); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
            }}
            placeholder={disabled ? t.placeholderWait : t.placeholder}
            aria-label={t.inputLabel}
            className="rp-scroll block min-h-[36px] w-full resize-none overflow-hidden bg-transparent text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3">{status}</span>
            <button
              type="button" aria-label={t.send} title={t.send} disabled={!canSend} onClick={onSubmit}
              className="flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
              style={{ background: canSend ? 'var(--accent)' : 'var(--line-strong)', color: canSend ? '#fff' : 'var(--ink-2)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
