import { AnimatePresence, motion } from 'framer-motion';
import { useLang, useT } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPage } from '@/lib/extract';
import { normalizeUrl } from '@/lib/url';
import type { Summary } from '@/lib/types';
import type { Anchors } from '@/lib/locate';
import { bus } from './bus';
import { Chat } from './Chat';
import { Check, Close, Fork, Minus, Refresh, Restore } from './Icons';
import { Overview } from './Overview';
import { ErrorView, NoOverview } from './EmptyStates';
import { Segmented, type Tab } from './Segmented';
import { MinTitle } from './MinTitle';
import { Skeleton } from './Skeleton';
import { rpc } from '@/lib/messages';
import { useResizableWidth } from './useResizableWidth';
import { Button } from './bui/Button';
import LoadingState from './bui/LoadingState';
import { Shimmer } from './bui/Shimmer';

export function App() {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [min, setMin] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [url, setUrl] = useState(() => normalizeUrl(location.href));
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ createdAt?: number } | null>(null);
  const [anchors, setAnchors] = useState<Anchors | undefined>(undefined);
  const [chatKey, setChatKey] = useState(0);
  const [sideCount, setSideCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  /** the automatic summary was cancelled and there is no overview to show */
  const [cancelled, setCancelled] = useState(false);
  /** bumped by every run and cancel, so a run that was cancelled or replaced never touches the UI */
  const runId = useRef(0);
  const chatBusy = useRef(false);
  const pageRef = useRef<{ url: string; page: ReturnType<typeof extractPage> } | null>(null);
  /** the page's text for chat when there is no summary; extracted once per page */
  const getPage = useCallback(() => {
    const u = normalizeUrl(location.href);
    if (pageRef.current?.url !== u) pageRef.current = { url: u, page: extractPage() };
    return pageRef.current.page;
  }, []);
  /** text a clicked term puts into the chat input (not sent) */
  const [draft, setDraft] = useState<{ text: string; id: number } | null>(null);
  const { width, resizing, handleProps } = useResizableWidth();
  const lang = useLang();
  // Tell translators (and screen readers) the panel's language, separate from the host page's.
  const rootRef = useCallback((el: HTMLElement | null) => {
    const host = (el?.getRootNode() as ShadowRoot | undefined)?.host as HTMLElement | undefined;
    if (host) host.setAttribute('lang', lang);
    el?.setAttribute('lang', lang);
  }, [lang]);

  const run = useCallback(async (force: boolean) => {
    const id = ++runId.current;
    const stale = () => id !== runId.current;
    const u = normalizeUrl(location.href);
    const t0 = Date.now();
    setCacheInfo(null);
    setUrl(u); setLoading(true); setError(''); setFlash(''); setCancelled(false);
    if (force) { setSummary(null); setTab('overview'); setMin(false); }
    try {
      if (!force) {
        const c = await rpc('getCached', { url: u });
        if (stale()) return;
        if (c.ok && c.cached) { setCacheInfo({ createdAt: c.cached.createdAt }); setSummary(c.cached.summary); setAnchors(c.cached.anchors); setTitle(c.cached.title); setChatKey((k) => k + 1); return; }
      }
      pageRef.current = null;
      const page = getPage();
      setTitle(page.title);
      const r = await rpc('summarize', { url: u, title: page.title, content: page.content, anchors: page.anchors, force });
      if (stale()) return; // cancelled (or replaced) meanwhile
      if (!r.ok) throw new Error(r.error);
      if ('cancelled' in r) { setCancelled(true); return; }
      // keep the skeleton visible briefly so a fast re-summarize still reads as "something happened"
      if (force) await new Promise((res) => setTimeout(res, Math.max(0, 500 - (Date.now() - t0))));
      if (stale()) return;
      setSummary(r.summary); setAnchors(r.anchors);
      if (force || !chatBusy.current) setChatKey((k) => k + 1); // a reply streaming in the chat must not be reloaded away
      if (force) { setFlash(t.updated); setTimeout(() => setFlash(''), 2000); }
    } catch (e: any) {
      if (!stale()) setError(String(e.message ?? e));
    } finally { if (!stale()) setLoading(false); }
  }, [getPage]);

  /** Stop the running summary: the request is aborted in the background and nothing is cached. */
  const cancel = useCallback(async () => {
    runId.current++;
    const u = normalizeUrl(location.href);
    rpc('cancelSummarize', { url: u });
    setError('');
    // a cancelled refresh falls back to the overview that is still cached, if any
    const c = await rpc('getCached', { url: u });
    if (c.ok && c.cached) { setCacheInfo({ createdAt: c.cached.createdAt }); setSummary(c.cached.summary); setAnchors(c.cached.anchors); setTitle(c.cached.title); setCancelled(false); }
    else setCancelled(true);
    setLoading(false);
  }, []);

  useEffect(() => { run(false); }, [run]);
  useEffect(() => bus.on('toggle', () => setOpen((o) => {
    if (!o && normalizeUrl(location.href) !== url) run(false); // SPA navigation
    return !o;
  })), [url, run]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={rootRef} translate="no"
          initial={{ opacity: 0.6, x: width + 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0.6, x: width + 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="notranslate pointer-events-auto fixed right-5 top-5 flex flex-col overflow-hidden bg-white font-sans text-zinc-900 antialiased"
          style={{ width, minWidth: width, maxWidth: width, boxSizing: 'border-box', userSelect: resizing ? 'none' : undefined, borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,.1)', height: min ? 'auto' : 'calc(100vh - 40px)', border: '1px solid rgba(0,0,0,.06)' }}
        >
          {/* left-edge resize handle */}
          <div
            role="separator" aria-orientation="vertical" aria-label={t.resizeHandle} title={t.resizeHandle}
            data-resize-handle
            {...handleProps}
            className="group absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none"
          >
            <span className={`absolute inset-y-3 left-0.5 w-[3px] rounded-full transition-colors duration-150 ${resizing ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong'}`} />
          </div>
          {/* top row: tabs on the left, compact icon actions on the right (also the slim bar when minimized) */}
          <div
            data-top-row
            className={`flex h-12 shrink-0 items-center gap-2 pl-3 pr-2 ${min ? 'cursor-pointer hover:bg-zinc-50' : 'border-b border-zinc-100'}`}
            title={min ? t.clickToRestore : undefined}
            onClick={() => min && setMin(false)}
          >
            <Segmented value={tab} onChange={(t) => { setTab(t); setMin(false); }} generating={loading && tab === 'chat'} compact={min} />
            {min && <MinTitle>{loading ? <Shimmer>{t.summarizing}</Shimmer> : title}</MinTitle>}
            <div className="ml-auto flex shrink-0 items-center gap-0.5 text-ink-2">
              {/* Refresh re-summarizes, so it only belongs to the overview. In chat the slot holds "new side chat" until side chats exist (then it moves into the session tabs). */}
              {tab === 'overview' ? (
                <Button variant="quiet" size="icon" onClick={(e) => { e.stopPropagation(); run(true); }} disabled={loading}
                  title={loading ? t.summarizing : flash ? t.updated : t.resummarize} aria-label={t.resummarize}>
                  {flash && !loading ? <Check className="h-4 w-4 text-green" /> : <Refresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
                </Button>
              ) : !min && sideCount === 0 && (
                <Button variant="quiet" size="icon" onClick={(e) => { e.stopPropagation(); bus.emit('fork'); }} 
                  title={t.newSide} aria-label={t.newSide}>
                  <Fork className="h-4 w-4" />
                </Button>
              )}
              <Button variant="quiet" size="icon" title={min ? t.restore : t.minimize} aria-label={min ? t.restore : t.minimize}
                onClick={(e) => { e.stopPropagation(); setMin((m) => !m); }}>
                {min ? <Restore /> : <Minus />}
              </Button>
              <Button variant="quiet" size="icon" title={t.close} aria-label={t.close} onClick={(e) => { e.stopPropagation(); setOpen(false); }}><Close /></Button>
            </div>
          </div>
          {!min && (
            <>
              <div className="relative min-h-0 flex-1">
                {tab === 'overview' ? (
                  <div className="rp-scroll h-full overflow-y-auto">
                    {loading && <div className="flex h-full flex-col overflow-hidden"><div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4"><LoadingState label={t.summarizingLabel} /><Button variant="secondary" size="xs" data-cancel onClick={cancel}>{t.cancelSummary}</Button></div><div className="min-h-0 flex-1"><Skeleton /></div></div>}
                    {!loading && error && <ErrorView error={error} retry={() => run(true)} onChat={() => setTab('chat')} />}
                    {!loading && !error && !summary && cancelled && <NoOverview onStart={() => run(true)} onChat={() => setTab('chat')} />}
                    {!loading && summary && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                        <Overview fromCache={cacheInfo !== null} cachedAt={cacheInfo?.createdAt} summary={summary} anchors={anchors} pageTitle={title} onAsk={(term) => { setDraft({ text: t.askTerm(term), id: Date.now() }); setTab('chat'); setMin(false); }} />
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <Chat url={url} pageTitle={title} reloadKey={chatKey} hasSummary={!!summary} getPage={getPage} onBusy={(b) => { chatBusy.current = b; }} onSideCount={setSideCount} draft={draft} onDraftUsed={() => setDraft(null)} />
                )}
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
