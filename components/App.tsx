import { AnimatePresence, motion } from 'framer-motion';
import { useLang, useT } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPage } from '@/lib/extract';
import { normalizeUrl } from '@/lib/url';
import type { Summary } from '@/lib/types';
import type { Anchors } from '@/lib/locate';
import { bus } from './bus';
import { Chat } from './Chat';
import { Overview, pageHost } from './Overview';
import { ErrorView, NoOverview } from './EmptyStates';
import { Capsule, CloseButton } from './Capsule';
import { Skeleton } from './Skeleton';
import { rpc } from '@/lib/messages';
import { escClosesPanel, type Tab } from '@/lib/capsule';
import { useResizableWidth } from './useResizableWidth';
import { useCapsuleCollapse } from './useCapsuleCollapse';
import { Button } from './bui/Button';
import LoadingState from './bui/LoadingState';

export function App() {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [url, setUrl] = useState(() => normalizeUrl(location.href));
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ createdAt?: number } | null>(null);
  const [anchors, setAnchors] = useState<Anchors | undefined>(undefined);
  const [chatKey, setChatKey] = useState(0);
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
    if (force) { setSummary(null); setTab('overview'); }
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
      if (force) { setFlash(t.updated); setTimeout(() => setFlash(''), 1500); }
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

  const { collapsed, glass, scrollRef, expand } = useCapsuleCollapse(tab);
  const isOverview = tab === 'overview';

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={rootRef} translate="no" dir="ltr"
          // Esc anywhere inside the panel closes it, unless a control already used it (slash menu) or an IME is composing
          onKeyDown={(e) => { if (escClosesPanel({ key: e.key, defaultPrevented: e.defaultPrevented, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) { e.stopPropagation(); setOpen(false); } }}
          initial={{ opacity: 0.6, x: width + 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0.6, x: width + 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="notranslate pointer-events-auto fixed right-5 top-5 isolate flex flex-col overflow-hidden bg-white font-sans text-zinc-900 antialiased"
          style={{ width, minWidth: width, maxWidth: width, boxSizing: 'border-box', userSelect: resizing ? 'none' : undefined, borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,.1)', height: 'calc(100vh - 40px)', border: '1px solid rgba(0,0,0,.06)' }}
        >
          {/* glow under the floating controls: accent on the overview, neutral in chat; fades once reading starts */}
          <div aria-hidden data-halo={isOverview ? 'accent' : 'neutral'}
            className={`pointer-events-none absolute inset-x-0 top-0 z-0 h-[150px] transition-opacity duration-200 motion-reduce:transition-none ${glass ? 'opacity-0' : 'opacity-100'}`}
            style={{ background: isOverview
              ? 'radial-gradient(110% 100% at 50% 0%, color-mix(in srgb, var(--accent) 13%, #fff) 0%, color-mix(in srgb, var(--accent) 5%, #fff) 48%, #fff 100%)'
              : 'radial-gradient(110% 100% at 50% 0%, color-mix(in srgb, var(--ink) 9%, #fff) 0%, color-mix(in srgb, var(--ink) 3.5%, #fff) 48%, #fff 100%)' }} />
          {/* left-edge resize handle */}
          <div
            role="separator" aria-orientation="vertical" aria-label={t.resizeHandle} title={t.resizeHandle}
            data-resize-handle
            {...handleProps}
            className="group absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize touch-none"
          >
            <span className={`absolute inset-y-3 left-0.5 w-[3px] rounded-full transition-colors duration-150 ${resizing ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong'}`} />
          </div>
          <div className="relative z-[1] min-h-0 flex-1">
            {isOverview ? (
              <div ref={scrollRef} className="rp-scroll h-full overflow-y-auto pt-11">
                {loading && (
                  <div className="flex h-full flex-col overflow-hidden">
                    {/* first row while summarizing: status, timer, cancel */}
                    <div data-status-row className="flex h-6 shrink-0 items-center justify-between gap-2 px-4">
                      <LoadingState label={t.summarizingLabel} tone="bg-accent" />
                      <Button variant="secondary" size="xs" data-cancel onClick={cancel}>{t.cancelSummary}</Button>
                    </div>
                    <div className="-mt-2 min-h-0 flex-1"><Skeleton /></div>
                  </div>
                )}
                {!loading && error && <ErrorView error={error} retry={() => run(true)} onChat={() => setTab('chat')} />}
                {!loading && !error && !summary && cancelled && <NoOverview onStart={() => run(true)} onChat={() => setTab('chat')} />}
                {!loading && summary && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                    <Overview fromCache={cacheInfo !== null} cachedAt={cacheInfo?.createdAt} summary={summary} anchors={anchors} pageTitle={title} host={pageHost()}
                      onRegenerate={() => run(true)} regenerated={!!flash}
                      onAsk={(term) => { setDraft({ text: t.askTerm(term), id: Date.now() }); setTab('chat'); }} />
                  </motion.div>
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <Chat url={url} pageTitle={title} reloadKey={chatKey} hasSummary={!!summary} getPage={getPage} onBusy={(b) => { chatBusy.current = b; }} scrollRef={scrollRef} draft={draft} onDraftUsed={() => setDraft(null)} />
              </div>
            )}
          </div>
          <div className="absolute left-1/2 top-1.5 z-[7] -translate-x-1/2" onPointerEnter={expand} onFocus={expand}>
            <Capsule value={tab} onChange={setTab} collapsed={collapsed} summarizing={loading} frost={glass} />
          </div>
          <div className="absolute right-2 top-1.5 z-[7]"><CloseButton onClose={() => setOpen(false)} frost={glass} /></div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
