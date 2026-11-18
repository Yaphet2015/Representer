import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDF_CONTEXT, PDF_VISUAL_CLOSE, PDF_VISUAL_OPEN, isPdfContext, pdfCacheUrl, publicPdfUrl, type PdfContext, type PdfGrant } from '@/lib/pdf-contract';
import type { PdfText } from '@/lib/pdf-text';
import { pageNeedsVisualInspection } from '@/lib/pdf-text';
import type { OverviewStatus } from '@/lib/overview-agent';
import type { ReadPdfResult } from '@/lib/pdf-read';
import { pageHash } from '@/lib/cache';
import { rpc } from '@/lib/messages';
import { streamSummary } from '@/lib/summary-client';
import type { Summary } from '@/lib/types';
import { Overview, OverviewSource } from '../Overview';
import { Button } from '../bui/Button';
import { useTheme } from '../theme';
import { PdfChat } from './PdfChat';

async function context(): Promise<PdfContext> {
  const r: unknown = await chrome.runtime.sendMessage({ type: PDF_CONTEXT });
  return isPdfContext(r) ? r : { kind: 'none' };
}

/** Source lock: existing settings design system, same Overview; PDF page sources are explicitly not DOM highlights. */
export function PdfPanel() {
  const theme = useTheme(); const [ctx, setCtx] = useState<PdfContext>({ kind: 'none' });
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
    const update = (id: number, info: chrome.tabs.OnUpdatedInfo) => { const g = selected.current; if (g?.tabId === id && (info.status === 'loading' || (info.url && publicPdfUrl(info.url) !== g.url))) refresh(); };
    const message = (msg: unknown) => { if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'rp-pdf-selected') refresh(); };
    chrome.tabs.onActivated.addListener(activate); chrome.tabs.onUpdated.addListener(update); chrome.runtime.onMessage.addListener(message);
    return () => { requests.current++; chrome.tabs.onActivated.removeListener(activate); chrome.tabs.onUpdated.removeListener(update); chrome.runtime.onMessage.removeListener(message); };
  }, []);
  return <main data-theme={theme} className="relative flex h-screen min-w-0 flex-col bg-page font-sans text-ink antialiased">
    <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3"><h1 className="text-[15px] font-[650]">Representer <span className="text-ink-3">/ PDF</span></h1><Button variant="quiet" size="sm" onClick={() => { void chrome.runtime.openOptionsPage(); }}>Settings</Button></header>
    {ctx.kind === 'pdf' ? <PdfDocument key={ctx.grant.token} grant={ctx.grant} /> : <div className="space-y-3 p-4 text-[13px] leading-6 text-ink-2"><p>{ctx.kind === 'web' ? 'This is a webpage. Its floating panel is open; you can close this sidebar.' : 'Open a public HTTP(S) PDF and click the Representer toolbar button to select it. Selection expires after 30 minutes or when the tab navigates.'}</p><p>The PDF stays in its original tab. All pages are read locally, including image-only pages. Your model can inspect rendered page images on demand for charts and figures when it supports vision. Password-protected files are not supported.</p></div>}
  </main>;
}


function statusLabel(s: OverviewStatus): string {
  if (!s) return 'Writing overview…';
  if (s === 'repairing') return 'Checking sources…';
  if (s === 'reading') return 'Reading the document…';
  if (s === 'inspecting') return 'Inspecting a page image…';
  if (typeof s === 'object' && 'read' in s) return `Reading parts ${s.read}/${s.total}`;
  if (typeof s === 'object' && 'inspect' in s) return `Inspecting page ${s.inspect}…`;
  if (typeof s === 'object' && 'vision' in s) return s.reason;
  return 'Writing overview…';
}
async function openVisualSession(grant: PdfGrant, doc: ReadPdfResult) {
  const copy = doc.data.slice();
  const r: unknown = await chrome.runtime.sendMessage({
    type: PDF_VISUAL_OPEN, url: grant.url, token: grant.token, catalog: doc.catalog, pageByAnchor: doc.pageByAnchor,
    data: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
  });
  const ok = !!r && typeof r === 'object' && 'ok' in r && r.ok === true;
  const err = r && typeof r === 'object' && 'error' in r && typeof r.error === 'string' ? r.error : 'Could not open a page-image session for the model.';
  if (!ok) throw new Error(err);
}
async function closeVisualSession(grant: PdfGrant) {
  try { await chrome.runtime.sendMessage({ type: PDF_VISUAL_CLOSE, url: grant.url, token: grant.token }); } catch { /* already gone */ }
}

type Load = { kind: 'idle' } | { kind: 'loading'; page: number; total: number } | { kind: 'error'; message: string } | { kind: 'ready'; doc: ReadPdfResult };
function PdfDocument({ grant }: { grant: PdfGrant }) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [summary, setSummary] = useState<Summary | null>(null), [partial, setPartial] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [tab, setTab] = useState<'overview' | 'chat'>('overview'), [sourcePage, setSourcePage] = useState<number | null>(null);
  const operation = useRef(0), ac = useRef<AbortController | null>(null), stream = useRef<ReturnType<typeof streamSummary> | null>(null);
  const key = pdfCacheUrl(grant.url);
  const validate = useCallback(async () => {
    const r = await context();
    if (r.kind !== 'pdf' || r.grant.token !== grant.token || r.grant.url !== grant.url) throw new Error('The selected tab changed or authorization expired. Click the toolbar button on the PDF again.');
  }, [grant.token, grant.url]);
  useEffect(() => () => { operation.current++; ac.current?.abort(); stream.current?.stop(); void closeVisualSession(grant); }, [grant]);
  const read = async () => {
    const seq = ++operation.current; ac.current?.abort(); const ctrl = new AbortController(); ac.current = ctrl;
    setLoad({ kind: 'loading', page: 0, total: 0 }); setError(''); setSummary(null);
    try {
      await validate(); ctrl.signal.throwIfAborted();
      const { readPdf } = await import('@/lib/pdf-read'); ctrl.signal.throwIfAborted();
      const doc = await readPdf(grant.url, ctrl.signal, (page, total) => { if (seq === operation.current) setLoad({ kind: 'loading', page, total }); });
      await validate(); ctrl.signal.throwIfAborted();
      const cached = await rpc('getCached', { url: key, hash: pageHash(doc.content) });
      if (seq !== operation.current) return;
      try { await openVisualSession(grant, doc); } catch (e) { if (seq === operation.current) setError(e instanceof Error ? e.message : String(e)); }
      if (seq !== operation.current) return;
      setLoad({ kind: 'ready', doc }); if (cached.ok && cached.cached) setSummary(cached.cached.summary);
    } catch (e) { if (seq === operation.current) setLoad({ kind: 'error', message: ctrl.signal.aborted ? 'Reading cancelled.' : e instanceof Error ? e.message : String(e) }); }
  };
  const summarize = async (force = false) => {
    if (load.kind !== 'ready' || busy) return;
    const seq = ++operation.current; setBusy(true); setError(''); setStatus(''); setPartial(null);
    try {
      await validate(); if (seq !== operation.current) return;
      try { await openVisualSession(grant, load.doc); } catch (e) { if (seq === operation.current) setError(e instanceof Error ? e.message : String(e)); }
      if (seq !== operation.current) return;
      const s = streamSummary({ url: key, title: load.doc.title, content: load.doc.content, force }, (p) => { if (seq === operation.current) setPartial(p); }, undefined, undefined, (s) => { if (seq === operation.current) setStatus(statusLabel(s)); });
      stream.current = s; const r = await s.done;
      if (seq !== operation.current) return;
      if ('done' in r) setSummary(r.summary); else if ('error' in r) setError(r.error);
    } catch (e) { if (seq === operation.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (seq === operation.current) { setBusy(false); setPartial(null); } }
  };
  const doc = load.kind === 'ready' ? load.doc : null;
  const source = useMemo(() => ({
    label: 'View PDF source page in sidebar',
    canLocate: (item: { anchor?: string }) => !!(doc && item.anchor && doc.pageByAnchor[item.anchor]),
    locate: (item: { anchor?: string }) => { const n = doc && item.anchor ? doc.pageByAnchor[item.anchor] : undefined; if (n) setSourcePage(n); },
  }), [doc]);
  const shown = partial ?? summary;
  return <>
    <div className="shrink-0 space-y-2 border-b border-line px-4 py-3">
      <p className="truncate text-[12px] text-ink-3" title={grant.url}>{grant.url}</p>
      <p className="text-[12px] leading-5 text-ink-2">All pages stay available to your model, including image-only pages. The model can inspect rendered page images on demand for charts and figures (a vision-capable OpenAI-compatible model is required). Page sources open here, not as highlights in the original viewer. Password-protected files are not supported.</p>
      {doc ? <p className="text-[12px] text-ink-3">{doc.pages.length} pages · {doc.bytes.toLocaleString()} bytes · {doc.content.length.toLocaleString()} characters{doc.emptyPages.length > 0 && ` · No selectable text on pages ${doc.emptyPages.join(', ')}`}{doc.catalog.some(pageNeedsVisualInspection) && ` · ${doc.catalog.filter(pageNeedsVisualInspection).length} page${doc.catalog.filter(pageNeedsVisualInspection).length === 1 ? '' : 's'} flagged for visual inspection`}</p> : <p className="text-[12px] text-ink-3">Limits: 64 MiB · 300 pages · 350,000 text characters · 90 seconds. No redirects or sign-in cookies.</p>}
      {load.kind === 'loading' ? <div className="flex items-center gap-2 text-[12px] text-ink-2"><span>{load.total ? `Reading page ${load.page}/${load.total}` : 'Downloading PDF…'}</span><Button size="sm" onClick={() => ac.current?.abort()}>Cancel</Button></div> : !doc ? <Button size="sm" variant="accent" onClick={() => { void read(); }}>Read PDF locally</Button> : <div className="flex flex-wrap items-center gap-2">
        {!summary && !busy && <Button size="sm" variant="accent" onClick={() => { void summarize(); }}>Summarize with my model</Button>}
        {busy && <Button size="sm" onClick={() => stream.current?.stop()}>Stop summary</Button>}
        <Button size="sm" variant="quiet" onClick={() => setSourcePage(1)}>Source pages</Button>
        {summary && <><Button size="sm" variant="quiet" disabled={busy} onClick={() => { void summarize(true); }}>Regenerate</Button><Button size="sm" variant={tab === 'overview' ? 'ghost' : 'quiet'} onClick={() => setTab('overview')}>Overview</Button><Button size="sm" variant={tab === 'chat' ? 'ghost' : 'quiet'} onClick={() => setTab('chat')}>Chat</Button></>}
      </div>}
      {load.kind === 'error' && <p role="alert" className="text-[12px] text-red">{load.message}</p>}
      {error && <p role="alert" className="text-[12px] text-red">{error}</p>}
      {busy && <p role="status" className="text-[12px] text-ink-3">{status || 'Summarizing…'}</p>}
    </div>
    {doc && (tab === 'chat' && summary ? <div className="flex min-h-0 flex-1 flex-col p-4"><PdfChat url={key} validate={validate} ensureVisual={() => openVisualSession(grant, doc)} /></div> : <div className="rp-scroll min-h-0 flex-1 overflow-y-auto pt-4">
      {shown ? <OverviewSource.Provider value={source}><Overview summary={shown} pageTitle={doc.title} host={new URL(grant.url).hostname} streaming={busy} /></OverviewSource.Provider> : <p className="px-4 text-[13px] leading-6 text-ink-2">All pages have been read locally. Choose Summarize to send the text and allow on-demand page images to your configured model. Nothing is sent until you choose it.</p>}
    </div>)}
    {doc && sourcePage !== null && <PdfSourcePage doc={doc} page={sourcePage} setPage={setSourcePage} close={() => setSourcePage(null)} />}
  </>;
}

function PdfSourcePage({ doc, page, setPage, close }: { doc: PdfText; page: number; setPage: (n: number) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} onClose={close} onCancel={close} aria-label={`PDF page ${page}`} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-page p-0 text-ink">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-4"><label className="text-[13px]">Page <select aria-label="PDF source page" value={page} onChange={(e) => setPage(Number(e.target.value))} className="rounded bg-field px-2 py-1 text-ink">{doc.pages.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select> / {doc.pages.length}</label><Button size="sm" onClick={close}>Close</Button></header>
      <p className="px-4 pt-3 text-[12px] text-ink-3">Extracted page text for your reference. The model can inspect a rendered image of this page; this dialog is not a visual reproduction or a highlight in the PDF viewer.</p>
      <pre tabIndex={0} className="rp-scroll min-h-0 flex-1 whitespace-pre-wrap break-words p-4 font-sans text-[13px] leading-6 text-ink">{doc.pages[page - 1] || '(No selectable text on this page.)'}</pre>
    </div>
  </dialog>;
}
