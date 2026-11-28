import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDF_CONTEXT, PDF_VISUAL_CLOSE, isPdfContext, pdfCacheUrl, publicPdfUrl, type PdfContext, type PdfGrant } from '@/lib/pdf-contract';
import { PDF_VISUAL_PORT, isPdfVisualRenderRequest } from '@/lib/pdf-visual-port';
import type { PdfText } from '@/lib/pdf-text';
import { pageNeedsVisualInspection } from '@/lib/pdf-text';
import type { OverviewStatus } from '@/lib/overview-agent';
import type { ReadPdfResult } from '@/lib/pdf-read';
import { formatVisualInspectReport, type RenderedPdfPageBytes } from '@/lib/pdf-visual';
import { pageHash } from '@/lib/cache';
import { rpc } from '@/lib/messages';
import { streamSummary } from '@/lib/summary-client';
import { createThoughtTicker } from '@/lib/thinking';
import type { Summary } from '@/lib/types';
import { Overview, OverviewSource } from '../Overview';
import { Button } from '../bui/Button';
import LoadingState from '../bui/LoadingState';
import { ErrorView, NoOverview } from '../EmptyStates';
import { useLang, useT } from '../i18n';
import type { Messages } from '@/lib/i18n';
import { Skeleton } from '../Skeleton';
import { ThoughtLine } from '../ThoughtLine';
import { useTheme } from '../theme';
import { PdfChat } from './PdfChat';

function panelTabId(): number | undefined {
  const raw = new URLSearchParams(location.search).get('tab');
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

async function context(): Promise<PdfContext> {
  const tabId = panelTabId();
  const r: unknown = await chrome.runtime.sendMessage({ type: PDF_CONTEXT, ...(tabId !== undefined ? { tabId } : {}) });
  return isPdfContext(r) ? r : { kind: 'none' };
}

/** Source lock: existing settings design system, same Overview; PDF page sources are explicitly not DOM highlights. */
export function PdfPanel() {
  const t = useT();
  const theme = useTheme(); const [ctx, setCtx] = useState<PdfContext>({ kind: 'none' });
  useEffect(() => { document.title = t.pdfDocumentTitle; }, [t]);
  const requests = useRef(0), selected = useRef<PdfGrant | null>(null);
  useEffect(() => {
    const apply = (r: PdfContext) => { selected.current = r.kind === 'pdf' ? r.grant : null; setCtx(r); };
    const refresh = () => { const seq = ++requests.current; void context().then((r) => { if (seq === requests.current) apply(r); }); };
    refresh();
    const activate = (info: { tabId: number }) => {
      const seq = ++requests.current;
      void context().then((r) => {
        if (seq !== requests.current) return;
        const g = selected.current;
        // Another tab became active: keep this tab's reader. A tab-specific panel should be hidden there.
        if (r.kind !== 'pdf' && g && g.tabId !== info.tabId) return;
        apply(r);
      });
    };
    const update = (id: number, info: chrome.tabs.OnUpdatedInfo) => { const g = selected.current; if (g?.tabId === id && info.url && publicPdfUrl(info.url) !== g.url) refresh(); };
    const message = (msg: unknown) => { if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'rp-pdf-selected') refresh(); };
    chrome.tabs.onActivated.addListener(activate); chrome.tabs.onUpdated.addListener(update); chrome.runtime.onMessage.addListener(message);
    return () => { requests.current++; chrome.tabs.onActivated.removeListener(activate); chrome.tabs.onUpdated.removeListener(update); chrome.runtime.onMessage.removeListener(message); };
  }, []);
  return <main data-theme={theme} className="relative flex h-screen min-w-0 flex-col bg-page font-sans text-ink antialiased">
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3"><h1 className="text-[15px] font-[650]">Representer <span className="text-ink-3">{t.pdfHeaderSuffix}</span></h1><Button variant="quiet" size="sm" onClick={() => { void chrome.runtime.openOptionsPage(); }}>{t.settingsShort}</Button></header>
    {ctx.kind === 'pdf' ? <PdfDocument key={ctx.grant.token} grant={ctx.grant} /> : <div className="space-y-3 p-4 text-[13px] leading-6 text-ink-2"><p>{ctx.kind === 'web' ? t.pdfWebHint : t.pdfOpenHint}</p><p>{t.pdfStaysInTab}</p></div>}
  </main>;
}


function statusLabel(s: OverviewStatus, t: Messages): string {
  if (!s) return t.pdfWritingOverview;
  if (s === 'repairing') return t.pdfCheckingSources;
  if (s === 'reading') return t.pdfReadingDocument;
  if (s === 'inspecting') return t.pdfInspectingImage;
  if (typeof s === 'object' && 'read' in s) return t.pdfReadingParts(s.read, s.total);
  if (typeof s === 'object' && 'inspect' in s) return t.pdfInspectingPage(s.inspect);
  if (typeof s === 'object' && 'vision' in s) return s.reason;
  return t.pdfWritingOverview;
}
type VisualLink = { port: chrome.runtime.Port; close: () => Promise<void>; render: (page: number, signal?: AbortSignal) => Promise<RenderedPdfPageBytes> };
async function openVisualLink(grant: PdfGrant, doc: ReadPdfResult, previous: VisualLink | null): Promise<VisualLink> {
  if (previous) {
    try {
      previous.port.postMessage({ type: 'register', url: grant.url, token: grant.token, catalog: doc.catalog, pageByAnchor: doc.pageByAnchor });
      return previous;
    } catch { await previous.close(); }
  }
  const { createPdfRenderBackend, webCanvasFactory } = await import('@/lib/pdf-render');
  const backend = createPdfRenderBackend({
    data: doc.data.slice(),
    cMapUrl: chrome.runtime.getURL('/pdf-assets/cmaps/'),
    standardFontDataUrl: chrome.runtime.getURL('/pdf-assets/standard_fonts/'),
    canvasFactory: webCanvasFactory(),
  });
  const port = chrome.runtime.connect({ name: PDF_VISUAL_PORT });
  port.onMessage.addListener((msg: unknown) => {
    if (!isPdfVisualRenderRequest(msg)) return;
    void (async () => {
      try {
        const page = await backend.render(msg.page);
        const copy = page.bytes.slice();
        port.postMessage({ type: 'rendered', id: msg.id, page: page.page, width: page.width, height: page.height, mimeType: page.mimeType, data: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) });
      } catch (e) {
        try { port.postMessage({ type: 'error', id: msg.id, error: e instanceof Error ? e.message : String(e) }); } catch { /* port closed */ }
      }
    })();
  });
  port.postMessage({ type: 'register', url: grant.url, token: grant.token, catalog: doc.catalog, pageByAnchor: doc.pageByAnchor });
  return {
    port,
    render: (page, signal) => backend.render(page, signal),
    close: async () => {
      try { port.disconnect(); } catch { /* already gone */ }
      await backend.close().catch(() => {});
      try { await chrome.runtime.sendMessage({ type: PDF_VISUAL_CLOSE, url: grant.url, token: grant.token }); } catch { /* already gone */ }
    },
  };
}

type Load = { kind: 'loading'; page: number; total: number } | { kind: 'error'; message: string } | { kind: 'ready'; doc: ReadPdfResult };
function PdfDocument({ grant }: { grant: PdfGrant }) {
  const t = useT();
  const lang = useLang();
  const [load, setLoad] = useState<Load>({ kind: 'loading', page: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null), [partial, setPartial] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [status, setStatus] = useState<OverviewStatus>(null);
  const [thought, setThought] = useState(''), [startedAt, setStartedAt] = useState(() => Date.now());
  const [cancelled, setCancelled] = useState(false), [inspectNotice, setInspectNotice] = useState('');
  const [cacheInfo, setCacheInfo] = useState<{ createdAt?: number } | null>(null);
  const [tab, setTab] = useState<'overview' | 'chat'>('overview'), [sourcePage, setSourcePage] = useState<number | null>(null);
  const [flash, setFlash] = useState('');
  const operation = useRef(0), ac = useRef<AbortController | null>(null), stream = useRef<ReturnType<typeof streamSummary> | null>(null), visual = useRef<VisualLink | null>(null);
  const loadRef = useRef(load); loadRef.current = load;
  const key = pdfCacheUrl(grant.url);
  const validate = useCallback(async () => {
    const r = await context();
    if (r.kind !== 'pdf' || r.grant.token !== grant.token || r.grant.url !== grant.url) throw new Error(t.pdfAuthExpired);
  }, [grant.token, grant.url, t]);

  const run = useCallback(async (force: boolean) => {
    const seq = ++operation.current;
    ac.current?.abort(); stream.current?.stop(); stream.current = null;
    const ctrl = new AbortController(); ac.current = ctrl;
    const stale = () => seq !== operation.current;
    setCacheInfo(null); setError(''); setFlash(''); setCancelled(false); setPartial(null); setThought(''); setStatus(null); setInspectNotice(''); setStartedAt(Date.now()); setLoading(true);
    if (force) { setSummary(null); setTab('overview'); }
    try {
      await validate(); ctrl.signal.throwIfAborted();
      let doc = loadRef.current.kind === 'ready' ? loadRef.current.doc : undefined;
      if (!doc) {
        setLoad({ kind: 'loading', page: 0, total: 0 });
        const { readPdf } = await import('@/lib/pdf-read'); ctrl.signal.throwIfAborted();
        doc = await readPdf(grant.url, ctrl.signal, (page, total) => { if (!stale()) setLoad({ kind: 'loading', page, total }); }, lang);
        await validate(); ctrl.signal.throwIfAborted();
      }
      if (stale()) return;
      try { visual.current = await openVisualLink(grant, doc, visual.current); } catch (e) { if (!stale()) setError(e instanceof Error ? e.message : String(e)); }
      if (stale()) return;
      setLoad({ kind: 'ready', doc });
      if (!force) {
        const cached = await rpc('getCached', { url: key, hash: pageHash(doc.content) });
        if (stale()) return;
        if (cached.ok && cached.cached) {
          setCacheInfo({ createdAt: cached.cached.createdAt }); setSummary(cached.cached.summary);
          return;
        }
      }
      const ticker = createThoughtTicker((line) => { if (!stale()) setThought(line); });
      const s = streamSummary({ url: key, title: doc.title, content: doc.content, force }, (p) => { if (!stale()) setPartial(p); }, undefined, (d) => ticker.push(d), (st) => { if (!stale()) setStatus(st); });
      stream.current = s;
      const r = await s.done.finally(() => ticker.stop());
      if (stream.current === s) stream.current = null;
      if (stale()) return;
      if ('error' in r) throw new Error(r.error);
      if ('cancelled' in r) { setCancelled(true); return; }
      setSummary(r.summary);
      setInspectNotice(r.visualInspect ? formatVisualInspectReport(r.visualInspect, lang) : '');
      if (force) { setFlash(t.updated); setTimeout(() => setFlash(''), 1500); }
    } catch (e) {
      if (stale()) return;
      if (ctrl.signal.aborted) { setCancelled(true); return; }
      const message = e instanceof Error ? e.message : String(e);
      if (loadRef.current.kind !== 'ready') setLoad({ kind: 'error', message });
      setError(message);
    } finally {
      if (!stale()) { setLoading(false); setPartial(null); }
    }
  }, [grant, key, validate, t.updated, lang]);

  const cancel = useCallback(async () => {
    const seq = ++operation.current;
    ac.current?.abort(); stream.current?.stop(); stream.current = null;
    setError(''); setPartial(null); setThought(''); setStatus(null); setLoading(false);
    const cached = await rpc('getCached', { url: key });
    if (seq !== operation.current) return;
    if (cached.ok && cached.cached) {
      setCacheInfo({ createdAt: cached.cached.createdAt }); setSummary(cached.cached.summary); setCancelled(false);
    } else {
      setSummary(null); setCancelled(true);
    }
  }, [key]);

  // Start once per authorized sidebar document. A new token remounts this component.
  // `run` is omitted from deps so later identity changes cannot start a second paid summary.
  useEffect(() => {
    void run(false);
    return () => {
      operation.current++;
      ac.current?.abort();
      stream.current?.stop();
      stream.current = null;
      const link = visual.current; visual.current = null; void link?.close();
    };
  }, [grant.token, grant.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = load.kind === 'ready' ? load.doc : null;
  const flagged = doc ? doc.catalog.filter(pageNeedsVisualInspection).length : 0;
  const locale = lang === 'zh-CN' ? 'zh-CN' : 'en';
  const renderSourcePage = useCallback((n: number, signal?: AbortSignal) => {
    const link = visual.current;
    if (!link) return Promise.reject(new Error(t.pdfImageNotReady));
    return link.render(n, signal);
  }, [t]);
  const source = useMemo(() => ({
    label: t.pdfSourceLabel,
    canLocate: (item: { anchor?: string }) => !!(doc && item.anchor && doc.pageByAnchor[item.anchor]),
    locate: (item: { anchor?: string }) => { const n = doc && item.anchor ? doc.pageByAnchor[item.anchor] : undefined; if (n) setSourcePage(n); },
  }), [doc, t]);
  const shown = partial ?? summary;
  const readingLabel = load.kind === 'loading'
    ? (load.total ? t.pdfReadingPageProgress(load.page, load.total) : t.pdfDownloading)
    : thought ? <ThoughtLine line={thought} /> : statusLabel(status, t);

  return <>
    <div className="shrink-0 space-y-2 border-b border-line px-4 py-3">
      <p className="truncate text-[12px] text-ink-3" title={grant.url}>{grant.url}</p>
      <p className="text-[12px] leading-5 text-ink-2">{t.pdfAllPagesAvailable}</p>
      {doc ? <p className="text-[12px] text-ink-3">{t.pdfDocStats(doc.pages.length.toLocaleString(locale), doc.bytes.toLocaleString(locale), doc.content.length.toLocaleString(locale))}{doc.emptyPages.length > 0 && t.pdfNoTextOnPages(doc.emptyPages.join(lang === 'zh-CN' ? '、' : ', '))}{flagged > 0 && t.pdfFlaggedVisual(flagged)}</p> : <p className="text-[12px] text-ink-3">{t.pdfLimits}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {doc && <Button size="sm" variant="quiet" onClick={() => setSourcePage(1)}>{t.pdfSourcePages}</Button>}
        <Button size="sm" variant={tab === 'overview' ? 'ghost' : 'quiet'} onClick={() => setTab('overview')}>{t.tabOverview}</Button>
        <Button size="sm" variant={tab === 'chat' ? 'ghost' : 'quiet'} onClick={() => setTab('chat')} disabled={!doc}>{t.tabChat}</Button>
      </div>
      {!loading && inspectNotice && <p role="status" className="text-[12px] leading-5 text-ink-2">{inspectNotice}</p>}
      {flash && <p data-flash className="text-[11.5px] text-ink-3">{flash}</p>}
    </div>
    {tab === 'chat' && doc ? <div className="flex min-h-0 flex-1 flex-col p-4"><PdfChat url={key} validate={validate} ensureVisual={() => openVisualLink(grant, doc, visual.current).then((link) => { visual.current = link; })} /></div> : <div className="rp-scroll min-h-0 flex-1 overflow-y-auto pt-4">
      {loading && shown && (
        <OverviewSource.Provider value={source}><Overview summary={shown} pageTitle={doc?.title} host={new URL(grant.url).hostname} streaming startedAt={startedAt} statusLabel={status === 'repairing' ? t.repairing : undefined}>
          <Button variant="secondary" size="xs" data-cancel onClick={() => { void cancel(); }}>{t.cancelSummary}</Button>
        </Overview></OverviewSource.Provider>
      )}
      {loading && !shown && (
        <div className="flex h-full flex-col overflow-hidden">
          <div data-status-row className="flex h-6 shrink-0 items-center justify-between gap-2 px-4">
            <LoadingState label={readingLabel} tone="bg-accent" since={startedAt} />
            <Button variant="secondary" size="xs" data-cancel onClick={() => { void cancel(); }} className="shrink-0">{t.cancelSummary}</Button>
          </div>
          <div className="-mt-2 min-h-0 flex-1"><Skeleton /></div>
        </div>
      )}
      {!loading && error && <ErrorView error={error} retry={() => { void run(true); }} onChat={() => { if (doc) setTab('chat'); }} />}
      {!loading && !error && !summary && cancelled && <NoOverview onStart={() => { void run(true); }} onChat={() => { if (doc) setTab('chat'); }} />}
      {!loading && summary && (
        <OverviewSource.Provider value={source}><Overview summary={summary} pageTitle={doc?.title} host={new URL(grant.url).hostname} fromCache={cacheInfo !== null} cachedAt={cacheInfo?.createdAt} onRegenerate={() => { void run(true); }} regenerated={!!flash} /></OverviewSource.Provider>
      )}
      {load.kind === 'error' && !error && <p role="alert" className="px-4 text-[12px] text-red">{load.message}</p>}
    </div>}
    {doc && sourcePage !== null && <PdfSourcePage doc={doc} page={sourcePage} setPage={setSourcePage} close={() => setSourcePage(null)} renderPage={renderSourcePage} />}
  </>;
}

function PdfSourcePage({ doc, page, setPage, close, renderPage }: { doc: PdfText; page: number; setPage: (n: number) => void; close: () => void; renderPage?: (page: number, signal?: AbortSignal) => Promise<RenderedPdfPageBytes> }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [picture, setPicture] = useState<{ kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error'; message: string } | { kind: 'idle' }>({ kind: 'idle' });
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  useEffect(() => {
    if (!renderPage) { setPicture({ kind: 'idle' }); return; }
    let cancelled = false, url = '';
    setPicture({ kind: 'loading' });
    void renderPage(page).then((img) => {
      const copy = img.bytes.slice();
      const next = URL.createObjectURL(new Blob([copy], { type: img.mimeType }));
      if (cancelled) { URL.revokeObjectURL(next); return; }
      url = next;
      setPicture({ kind: 'ready', url: next });
    }, (e) => { if (!cancelled) setPicture({ kind: 'error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [page, renderPage]);
  return <dialog ref={dialog} onClose={close} onCancel={close} aria-label={t.pdfPageDialogLabel(page)} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-page p-0 text-ink">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-4"><label className="text-[13px]">{t.pdfPage} <select aria-label={t.pdfSourcePageLabel} value={page} onChange={(e) => setPage(Number(e.target.value))} className="rounded bg-field px-2 py-1 text-ink">{doc.pages.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select> / {doc.pages.length}</label><Button size="sm" onClick={close}>{t.close}</Button></header>
      <p className="px-4 pt-3 text-[12px] text-ink-3">{t.pdfSourceHelp}</p>
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto">
        {picture.kind === 'loading' && <p className="px-4 pt-3 text-[12px] text-ink-3">{t.pdfRenderingImage}</p>}
        {picture.kind === 'error' && <p className="px-4 pt-3 text-[12px] text-ink-3">{t.pdfRenderFailed(picture.message)}</p>}
        {picture.kind === 'ready' && <img src={picture.url} alt={t.pdfRenderedAlt(page)} className="mx-auto max-w-full bg-white p-4" />}
        <pre tabIndex={0} className="whitespace-pre-wrap break-words p-4 font-sans text-[13px] leading-6 text-ink">{doc.pages[page - 1] || t.pdfNoSelectableText}</pre>
      </div>
    </div>
  </dialog>;
}
