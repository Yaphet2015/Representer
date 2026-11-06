import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { chromeHistorySource, listHistory, onHistoryChange, searchHistory, type HistoryEntry, type HistoryList, type HistorySource } from '@/lib/history';
import { useT } from '@/components/i18n';
import { Overview } from '@/components/Overview';
import { Button } from '@/components/bui/Button';
import { Card, Icon, Ic, Input, Tag } from '@/components/options/ui';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; list: HistoryList };

const fmtTime = (ms: number) => new Date(ms).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Settings → History: the overviews kept in local storage, read-only (lib/history.ts). Master-detail: the list on
 * the left (on top when narrow), the selected overview beside it. The selection is derived, never stale: the row
 * picked if it is still in the (searched) list, else the newest shown one, else nothing.
 */
export function HistoryCard({ source = chromeHistorySource, subscribe = onHistoryChange }: { source?: HistorySource; subscribe?: (fn: () => void) => () => void }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++seq.current; // storage can change again mid-read: only the newest read lands
    try { const list = await listHistory(source); if (id === seq.current) setLoad({ state: 'ready', list }); }
    catch (e) { console.warn('[representer] history load failed', e); if (id === seq.current) setLoad({ state: 'error' }); }
  }, [source]);
  useEffect(() => { void refresh(); return subscribe(() => { void refresh(); }); }, [refresh, subscribe]);

  const entries = load.state === 'ready' ? load.list.entries : [];
  const shown = useMemo(() => searchHistory(entries, query), [entries, query]);
  const selected = shown.find((e) => e.url === picked) ?? shown[0] ?? null;

  return (
    <Card id="history" data-history title={t.historyTitle} desc={t.historyDesc}
      action={load.state === 'ready' && entries.length > 0 ? <span className="text-[12px] text-ink-3">{t.historyCount(entries.length)}</span> : undefined}>
      {load.state === 'loading' && <p className="text-[13px] text-ink-3">…</p>}
      {load.state === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-3 text-[13px] text-red">
          {t.historyLoadFailed}<Button variant="secondary" size="sm" onClick={() => { setLoad({ state: 'loading' }); void refresh(); }}>{t.retry}</Button>
        </div>
      )}
      {load.state === 'ready' && (entries.length === 0 ? <p data-history-empty className="text-[13px] leading-relaxed text-ink-2">{t.historyEmpty}</p> : (
        <div data-history-panes className="grid gap-4 min-[1180px]:h-[min(760px,calc(100vh-120px))] min-[1180px]:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <Input type="search" data-history-search aria-label={t.historySearch} placeholder={t.historySearch} value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length === 0 ? <p data-history-nomatch className="py-2 text-[13px] text-ink-3">{t.historyNoMatch}</p> : (
              <ul data-history-list aria-label={t.historyTitle} className="max-h-[280px] min-h-0 overflow-y-auto overscroll-contain rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)] min-[1180px]:max-h-none min-[1180px]:flex-1 [&>li+li]:border-t [&>li+li]:border-line">
                {shown.map((e) => {
                  const on = e.url === selected?.url;
                  return (
                    <li key={e.url}>
                      <button type="button" data-history-item aria-pressed={on} onClick={() => setPicked(e.url)}
                        className={cn('flex w-full min-w-0 flex-col px-3 py-2.5 text-left transition-colors focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ring)] focus-visible:outline-none', on ? 'bg-accent-tint' : 'hover:bg-hover')}>
                        <span className={cn('block w-full truncate text-[13.5px] font-medium', on ? 'text-accent-ink' : 'text-ink')}>{e.title || t.historyUntitled}</span>
                        <span className="mt-0.5 flex w-full min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
                          <span className="min-w-0 truncate">{e.host || e.url}</span><span aria-hidden>·</span>
                          <span className="shrink-0 tabular-nums">{e.createdAt !== null ? fmtTime(e.createdAt) : t.historyUnknownTime}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {load.list.skipped > 0 && <p className="text-[12px] text-ink-3">{t.historySkipped(load.list.skipped)}</p>}
          </div>
          <div data-history-pane tabIndex={0} aria-label={selected ? selected.title || t.historyUntitled : t.historyNoMatch}
            className="min-h-0 min-w-0 rounded-[10px] px-4 py-4 shadow-[inset_0_0_0_1px_var(--line)] focus-visible:shadow-[inset_0_0_0_2px_var(--accent-ring)] focus-visible:outline-none min-[1180px]:overflow-y-auto min-[1180px]:overscroll-contain">
            {selected ? <HistoryDetail key={selected.url} entry={selected} /> : <p data-history-pane-empty className="text-[13px] text-ink-3">{t.historyNoMatch}</p>}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function HistoryDetail({ entry }: { entry: HistoryEntry }) {
  const t = useT();
  return (
    <div data-history-detail className="min-w-0">
      <h3 className="break-words text-[15px] font-[650] leading-6 text-ink">{entry.title || t.historyUntitled}</h3>
      <p className="mt-0.5 break-all text-[12px] text-ink-3">{entry.url}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
        <span className="tabular-nums">{entry.createdAt !== null ? t.generatedAt(fmtTime(entry.createdAt)) : t.historyUnknownTime}</span>
        {!entry.fresh && entry.createdAt !== null && <Tag>{t.historyStale}</Tag>}
        {entry.href
          ? <a data-history-open href={entry.href} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-[6px] text-[12.5px] font-medium text-accent hover:underline focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]">{t.historyOpenSource}<Icon d={Ic.ext} className="size-3" /></a>
          : <span>{t.historyNoLink}</span>}
      </div>
      <p data-history-detached-note className="mt-2 text-[12px] leading-relaxed text-ink-3">{t.historyDetachedNote}</p>
      <div className="-mx-4 mt-3 border-t border-line pt-4">
        <Overview summary={entry.summary} pageTitle={entry.title || undefined} host={entry.host || entry.url} />
      </div>
    </div>
  );
}
