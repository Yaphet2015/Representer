import type { SessionsState } from '@/lib/sessions';
import { useLang, useT } from './i18n';
import { MAIN_ID, sessionLabel } from '@/lib/sessions';
import { Fork } from './Icons';

export function SessionChips({ state, onSwitch, onClose, onFork, disabled }: {
  state: SessionsState; onSwitch: (id: string) => void; onClose: (id: string) => void; onFork: () => void; disabled: boolean;
}) {
  const t = useT(); const lang = useLang();
  return (
    <div data-session-chips className="flex shrink-0 items-center gap-1 border-b border-zinc-100 py-1.5 pl-3 pr-2">
      {/* only the chips scroll; the fork button stays pinned at the far right */}
      <div data-chips-scroller className="rp-noscrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {state.sessions.map((s) => {
        const active = s.id === state.active;
        return (
          <span key={s.id} className={`group inline-flex h-6 shrink-0 items-center rounded-chip text-[12px] transition-colors duration-100 ${active ? 'bg-accent-tint text-accent-ink' : 'text-ink-2 hover:bg-hover'}`}>
            <button type="button" onClick={() => onSwitch(s.id)} className={`flex h-full items-center gap-1 ${s.id === MAIN_ID ? 'px-2' : 'pl-2 pr-1'}`} title={s.id === MAIN_ID ? t.mainSessionTitle : t.forkedFrom(sessionLabel(state.sessions.find((x) => x.id === s.parent) ?? { id: MAIN_ID, name: '' }, lang))}>
              {s.id !== MAIN_ID && <Fork className="h-3 w-3 opacity-70" />}{sessionLabel(s, lang)}
              <span className="text-[10px] tabular-nums opacity-60">{Math.floor(s.messages.filter((m) => m.content).length / 2) || ''}</span>
            </button>
            {s.id !== MAIN_ID && (
              <button type="button" aria-label={t.closeSession(sessionLabel(s, lang))} title={t.closeSession(sessionLabel(s, lang))} onClick={() => onClose(s.id)}
                className="mr-0.5 flex size-4 items-center justify-center rounded-[4px] text-[12px] leading-none opacity-60 hover:bg-black/5 hover:opacity-100">×</button>
            )}
          </span>
        );
      })}
      </div>
      <button type="button" data-fork onClick={onFork} disabled={disabled} title={t.newSideTitle} aria-label={t.newSideTitle}
        className="grid size-6 shrink-0 place-items-center rounded-[7px] text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-accent-ring disabled:pointer-events-none disabled:opacity-40">
        <Fork className="size-3.5" />
      </button>
    </div>
  );
}
