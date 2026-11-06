import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chromeHistorySource, listHistory, onHistoryChange, searchHistory, type HistoryEntry, type HistoryList, type HistorySource } from '@/lib/history';
import { useT } from '@/components/i18n';
import { Overview } from '@/components/Overview';
import { Button } from '@/components/bui/Button';
import { Card, Icon, Ic, Input, Tag } from '@/components/options/ui';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; list: HistoryList };

const fmtTime = (ms: number) => new Date(ms).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Settings → History: the overviews kept in local storage, read-only (lib/history.ts). */
export function HistoryCard({ source = chromeHistorySource, subscribe = onHistoryChange }: { source?: HistorySource; subscribe?: (fn: () => void) => () => void }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  // Back to list is a page transition: the list starts at the top of History, with focus on the row that was open.
  // Without this the scroll stays where the (much longer) detail ended and focus falls to <body>.
  const body = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const back = () => { returnTo.current = openUrl; setOpenUrl(null); };
  useLayoutEffect(() => {
    const url = returnTo.current; if (url === null || openUrl !== null || !body.current) return;
    returnTo.current = null;
    const rows = [...body.current.querySelectorAll<HTMLElement>('[data-history-item]')];
    const target = rows.find((r) => r.dataset.historyUrl === url) ?? body.current.querySelector<HTMLElement>('[data-history-search]');
    body.current.closest('[data-history]')?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  }, [openUrl]);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++seq.current; // storage can change again mid-read: only the newest read lands
    try { const list = await listHistory(source); if (id === seq.current) setLoad({ state: 'ready', list }); }
    catch (e) { console.warn('[representer] history load failed', e); if (id === seq.current) setLoad({ state: 'error' }); }
  }, [source]);
  useEffect(() => { void refresh(); return subscribe(() => { void refresh(); }); }, [refresh, subscribe]);

  const entries = load.state === 'ready' ? load.list.entries : [];
  const shown = useMemo(() => searchHistory(entries, query), [entries, query]);
  const open = openUrl ? entries.find((e) => e.url === openUrl) ?? null : null;

  return (
    <Card id="history" data-history title={t.historyTitle} desc={t.historyDesc}
      action={load.state === 'ready' && entries.length > 0 ? <span className="text-[12px] text-ink-3">{t.historyCount(entries.length)}</span> : undefined}>
      <div ref={body}>
      {load.state === 'loading' && <p className="text-[13px] text-ink-3">…</p>}
      {load.state === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-3 text-[13px] text-red">
          {t.historyLoadFailed}<Button variant="secondary" size="sm" onClick={() => { setLoad({ state: 'loading' }); void refresh(); }}>{t.retry}</Button>
        </div>
      )}
      {load.state === 'ready' && (open ? <HistoryDetail entry={open} onBack={back} /> : (
        entries.length === 0 ? <p data-history-empty className="text-[13px] leading-relaxed text-ink-2">{t.historyEmpty}</p> : (
          <div className="space-y-3">
            <Input type="search" data-history-search aria-label={t.historySearch} placeholder={t.historySearch} value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length === 0 ? <p data-history-nomatch className="py-2 text-[13px] text-ink-3">{t.historyNoMatch}</p> : (
              <ul data-history-list className="max-h-[420px] overflow-y-auto rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)] [&>li+li]:border-t [&>li+li]:border-line">
                {shown.map((e) => (
                  <li key={e.url}>
                    <button type="button" data-history-item data-history-url={e.url} onClick={() => setOpenUrl(e.url)}
                      className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ring)] focus-visible:outline-none">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{e.title || t.historyUntitled}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
                          <span className="min-w-0 truncate">{e.host || e.url}</span><span aria-hidden>·</span>
                          <span className="shrink-0 tabular-nums">{e.createdAt !== null ? fmtTime(e.createdAt) : t.historyUnknownTime}</span>
                        </span>
                      </span>
                      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-ink-3"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {load.list.skipped > 0 && <p className="text-[12px] text-ink-3">{t.historySkipped(load.list.skipped)}</p>}
          </div>
        )
      ))}
      </div>
    </Card>
  );
}

export function HistoryDetail({ entry, onBack }: { entry: HistoryEntry; onBack: () => void }) {
  const t = useT();
  return (
    <div data-history-detail className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Button variant="quiet" size="sm" data-history-back onClick={onBack}>
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5"><path d="M10 4l-4 4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>{t.historyBack}
        </Button>
        {entry.href
          ? <a data-history-open href={entry.href} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-[6px] text-[12.5px] font-medium text-accent hover:underline focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]">{t.historyOpenSource}<Icon d={Ic.ext} className="size-3" /></a>
          : <span className="text-[12px] text-ink-3">{t.historyNoLink}</span>}
      </div>
      <h3 className="break-words text-[15px] font-[650] leading-6 text-ink">{entry.title || t.historyUntitled}</h3>
      <p className="mt-0.5 break-all text-[12px] text-ink-3">{entry.url}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className="tabular-nums">{entry.createdAt !== null ? t.generatedAt(fmtTime(entry.createdAt)) : t.historyUnknownTime}</span>
        {!entry.fresh && entry.createdAt !== null && <Tag>{t.historyStale}</Tag>}
      </div>
      <p data-history-detached-note className="mt-2 text-[12px] leading-relaxed text-ink-3">{t.historyDetachedNote}</p>
      <div className="-mx-4 mt-3 border-t border-line pt-4">
        <Overview summary={entry.summary} pageTitle={entry.title || undefined} host={entry.host || entry.url} />
      </div>
    </div>
  );
}
