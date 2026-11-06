/**
 * Cross-frame extract/locate. Top mounts UI; children only answer extract/locate/ping/ack.
 * Content signature always comes from extractDocument().content (never body.innerText).
 * Fingerprints carry stable `sk` (source key); Chrome `frameId` is transport-only and rebound each extract.
 */
import { extractDocument, extractPage } from './extract';
import {
  SAME_ORIGIN_FRAME_ID, TOP_FRAME_ID, absUrl, docSignature, isThinContent, listCandidateIframes,
  mergeFrameParts, newGeneration, sourceKeyFor, countNestedContentFrames, describeNestedFrames,
  type FrameNotice, type FramePart, type FrameSource, type MergedPage,
} from './frames';
import {
  FRAME_ACK, FRAME_BYE, FRAME_COLLECT, FRAME_EXTRACT, FRAME_HELLO, FRAME_LOCATE, FRAME_PING, FRAME_PROBE,
  REPRESENTER_SOURCE, urlsLooselyEqual,
  type FrameCollectReply, type FrameExtractReply, type FrameLocateReply, type FramePingReply,
} from './frame-protocol';
import { jumpTo, listBlocks, liveIndex, resolveFingerprint, type Fingerprint } from './locate';

/** DEV diagnostics only: full normalized text of each DOM block, by local ordinal. */
export const diagBlockTexts = (doc: Document) => listBlocks(doc).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

export {
  FRAME_BYE, FRAME_COLLECT, FRAME_EXTRACT, FRAME_HELLO, FRAME_LOCATE, FRAME_PING, FRAME_ACK,
} from './frame-protocol';
export type { FrameCollectReply, FrameExtractReply, FrameLocateReply, FramePingReply } from './frame-protocol';
export { SAME_ORIGIN_FRAME_ID } from './frames';

let lastMerge: MergedPage | null = null;
export const getLastMergedPage = () => lastMerge;
export const setLastMergedPage = (p: MergedPage | null) => { lastMerge = p; };

export const RETRY_TOTAL_MS = 3500;
export const RETRY_GAP_MS = 400;
const PROBE_TIMEOUT_MS = 1500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Live signature MUST use the same extract pipeline as FRAME_EXTRACT / merge docSig. */
export function liveExtractSignature(doc: Document = document, href?: string): string {
  const page = extractDocument(doc, href || doc.URL || (typeof location !== 'undefined' ? location.href : ''));
  return docSignature(page.content);
}

export function trySameOriginExtract(iframe: HTMLIFrameElement, baseHref: string, candidateIndex: number): FramePart | null {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return null;
    const href = doc.URL || absUrl(iframe.src, baseHref);
    const extracted = extractDocument(doc, href);
    if (!extracted.content.trim()) return null;
    const nestedContentFrames = countNestedContentFrames(doc);
    const sk = sourceKeyFor('embed', candidateIndex);
    return {
      ...extracted,
      sk,
      frameId: SAME_ORIGIN_FRAME_ID,
      href,
      role: 'embed',
      embedSrc: absUrl(iframe.src, baseHref),
      candidateIndex,
      nestedContentFrames,
      nestedFrames: describeNestedFrames(doc),
      ...(import.meta.env.VITE_RP_DIAG === '1' ? { diagBlocks: diagBlockTexts(doc) } : {}),
      docSig: docSignature(extracted.content),
    };
  } catch {
    return null;
  }
}

async function waitAck(nonce: string): Promise<{ ok: true; frameId: number; href: string } | { ok: false; error: string }> {
  try {
    return await chrome.runtime.sendMessage({ type: 'rp-frame-wait-ack', nonce }) as any;
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function probeCandidateFrame(iframe: HTMLIFrameElement): Promise<{ frameId: number; href: string } | null> {
  const win = iframe.contentWindow;
  if (!win) return null;
  const nonce = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `n-${Date.now()}-${Math.random()}`;
  const wait = waitAck(nonce);
  try {
    win.postMessage({ source: REPRESENTER_SOURCE, type: FRAME_PROBE, nonce }, '*');
  } catch {
    return null;
  }
  const raced = await Promise.race([
    wait,
    sleep(PROBE_TIMEOUT_MS).then(() => ({ ok: false as const, error: 'probe timeout' })),
  ]);
  if (!raced || !('ok' in raced) || !raced.ok) return null;
  return { frameId: raced.frameId, href: raced.href };
}

async function collectByFrameIds(frameIds: number[], timeoutMs: number): Promise<FrameCollectReply> {
  if (!frameIds.length) return { ok: true, frames: [] };
  try {
    return await chrome.runtime.sendMessage({ type: FRAME_COLLECT, frameIds, timeoutMs } satisfies { type: typeof FRAME_COLLECT; frameIds: number[]; timeoutMs: number }) as FrameCollectReply;
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function extractPageWithFrames(opts?: { totalMs?: number; gapMs?: number }): Promise<MergedPage> {
  const totalMs = opts?.totalMs ?? RETRY_TOTAL_MS;
  const gapMs = opts?.gapMs ?? RETRY_GAP_MS;
  const started = Date.now();
  let last: MergedPage | null = null;

  while (Date.now() - started <= totalMs) {
    const result = await extractOnce(Math.max(200, totalMs - (Date.now() - started)));
    last = result;
    const embeds = result.sources.filter((s) => s.role === 'embed');
    const waiting = result.notices.some((n) => n.kind === 'not_loaded' || n.kind === 'timeout');
    const needRetry = waiting || (listCandidateIframes(document).length > 0 && embeds.length === 0 && isThinContent(result.content));
    if (!needRetry) break;
    if (Date.now() - started + gapMs > totalMs) break;
    await sleep(gapMs);
  }

  setLastMergedPage(last);
  return last!;
}

async function extractOnce(budgetMs: number): Promise<MergedPage> {
  const generation = newGeneration();
  const topDoc = extractPage();
  const topPart: FramePart = {
    ...topDoc,
    sk: sourceKeyFor('top'),
    frameId: TOP_FRAME_ID,
    href: location.href,
    role: 'top',
    nestedContentFrames: listCandidateIframes(document).length,
    docSig: docSignature(topDoc.content),
  };
  topPart.anchors = Object.fromEntries(Object.entries(topPart.anchors).map(([k, fp]) => [k, { ...fp, f: TOP_FRAME_ID, sk: topPart.sk, ds: topPart.docSig, g: generation }]));

  const candidates = listCandidateIframes(document);
  const notices: FrameNotice[] = [];
  const parts: FramePart[] = [topPart];
  const cross: { frameId: number; embedSrc: string; candidateIndex: number; sk: string }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const iframe = candidates[i]!;
    const src = absUrl(iframe.src, location.href);
    const sk = sourceKeyFor('embed', i);
    if (!src || src === 'about:blank') {
      notices.push({ kind: 'not_loaded', href: src || 'about:blank' });
      continue;
    }
    const same = trySameOriginExtract(iframe, location.href, i);
    if (same) {
      same.anchors = Object.fromEntries(Object.entries(same.anchors).map(([k, fp]) => [k, { ...fp, f: SAME_ORIGIN_FRAME_ID, sk: same.sk, ds: same.docSig, g: generation }]));
      parts.push(same);
      continue;
    }
    const probed = await probeCandidateFrame(iframe);
    if (!probed) {
      notices.push({ kind: 'not_loaded', href: src });
      continue;
    }
    cross.push({ frameId: probed.frameId, embedSrc: src, candidateIndex: i, sk });
  }

  if (cross.length) {
    const collected = await collectByFrameIds(cross.map((c) => c.frameId), budgetMs);
    if (!collected.ok) {
      for (const c of cross) notices.push({ kind: 'inaccessible', href: c.embedSrc });
    } else {
      const byId = new Map(collected.frames.map((f) => [f.frameId, f]));
      for (const c of cross) {
        const hit = byId.get(c.frameId);
        if (!hit) {
          notices.push({ kind: 'inaccessible', href: c.embedSrc });
          continue;
        }
        if ('error' in hit && hit.error) {
          notices.push({ kind: hit.error === 'timeout' ? 'timeout' : 'inaccessible', href: hit.href || c.embedSrc });
          continue;
        }
        if (!('content' in hit) || !hit.content.trim()) {
          notices.push({ kind: 'not_loaded', href: c.embedSrc });
          continue;
        }
        parts.push({
          title: hit.title,
          content: hit.content,
          anchors: Object.fromEntries(Object.entries(hit.anchors).map(([k, fp]) => [k, { ...fp, f: c.frameId, sk: c.sk, ds: hit.docSig || docSignature(hit.content), g: generation }])),
          sk: c.sk,
          frameId: c.frameId,
          href: hit.href,
          role: 'embed',
          embedSrc: c.embedSrc,
          candidateIndex: c.candidateIndex,
          nestedContentFrames: hit.nestedContentFrames,
          nestedFrames: hit.nestedFrames,
          diagBlocks: hit.diagBlocks,
          docSig: hit.docSig || docSignature(hit.content),
        });
      }
    }
  }

  return mergeFrameParts(parts, notices, generation);
}

function findSource(fp: Fingerprint, merge: MergedPage | null): FrameSource | undefined {
  if (!merge) return undefined;
  if (fp.sk) return merge.sources.find((s) => s.sk === fp.sk);
  // Legacy anchors: best-effort by volatile frameId
  if (fp.f != null) return merge.sources.find((s) => s.frameId === fp.f);
  return merge.sources.find((s) => s.role === 'top');
}

/** Resolve the iframe element for a source by candidate index / embedSrc — never "first matching src". */
export function findIframeForSource(source: FrameSource | undefined): HTMLIFrameElement | null {
  if (!source || source.role === 'top') return null;
  const candidates = listCandidateIframes(document);
  if (source.candidateIndex != null && candidates[source.candidateIndex]) {
    const el = candidates[source.candidateIndex]!;
    const src = absUrl(el.src, location.href);
    if (!source.embedSrc || urlsLooselyEqual(src, source.embedSrc)) return el;
  }
  // Fallback: among candidates with the same embedSrc, pick the ordinal encoded in sk (`embed:N`)
  const want = source.embedSrc || source.href;
  if (!want) return null;
  const peers = candidates.filter((el) => urlsLooselyEqual(absUrl(el.src, location.href), want));
  const m = /^embed:(\d+)$/.exec(source.sk || '');
  const ord = m ? Number(m[1]) : 0;
  // sk index is global candidate index; among same-src peers use relative order
  if (source.candidateIndex != null) {
    const rel = peers.findIndex((el) => candidates.indexOf(el) === source.candidateIndex);
    if (rel >= 0) return peers[rel]!;
  }
  // If sk's N falls within peers by filtering candidates with that global index's src group:
  const byGlobal = candidates[ord];
  if (byGlobal && urlsLooselyEqual(absUrl(byGlobal.src, location.href), want)) return byGlobal;
  return peers[0] ?? null;
}

export interface JumpTrace {
  result: 'ok' | 'missing' | 'stale';
  /** which path ran: top document, same-origin iframe, or cross-origin child via the background */
  route: 'top' | 'same-origin' | 'cross-origin';
  sk?: string;
  frameId?: number;
  /** why it was stale / missing, for the dev diagnostics page */
  reason?: string;
  /** leading text of the element that was highlighted */
  matched?: string;
}

/** Scroll the top page so a rect inside `iframe` (iframe-viewport coordinates) is centred. */
export function scrollFrameRectIntoView(iframe: HTMLIFrameElement, rect: { top: number; height: number }) {
  const fr = iframe.getBoundingClientRect();
  const y = fr.top + (iframe.clientTop || 0) + rect.top + Math.min(rect.height, window.innerHeight * 0.6) / 2;
  let scroller: Element | null = iframe.parentElement;
  while (scroller && scroller !== document.body && scroller !== document.documentElement) {
    const cs = getComputedStyle(scroller);
    if (/(auto|scroll)/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
  if (scroller && scroller !== document.body && scroller !== document.documentElement) {
    const sr = scroller.getBoundingClientRect();
    scroller.scrollBy({ top: y - (sr.top + sr.height / 2), behavior });
  } else {
    window.scrollBy({ top: y - window.innerHeight / 2, behavior });
  }
}

/** Centre `el` inside its own (frame) document instantly and report where it ended up in that frame's viewport. */
function settleInFrame(el: Element): { top: number; height: number } {
  try { (el as HTMLElement).scrollIntoView?.({ behavior: 'auto', block: 'center', inline: 'nearest' }); } catch { /* */ }
  try { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height }; } catch { return { top: 0, height: 0 }; }
}

/**
 * Resolve a stored fingerprint in a live document. A block whose exact text hash is unique on the page is
 * the cited block whatever else changed (lazy charts, theme), so it is used without re-running Defuddle;
 * only fuzzy fallbacks require the document signature to still match.
 */
export function locateInDoc(doc: Document, fp: Fingerprint, expectSig: string | undefined, href?: string):
  { el: Element; exact: boolean } | { el: null; stale: boolean; reason: string } {
  const live = liveIndex(doc);
  const same = live.byHash.get(fp.h)?.filter((i) => live.fps[i]!.n === fp.n) ?? [];
  if (same.length === 1) return { el: live.blocks[same[0]!]!, exact: true };
  if (expectSig && expectSig !== liveExtractSignature(doc, href)) return { el: null, stale: true, reason: 'document changed and the block text is not unique/unchanged' };
  const el = resolveFingerprint(live, { ...fp, f: undefined });
  return el ? { el, exact: false } : { el: null, stale: false, reason: 'no matching block' };
}

const headOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

export async function jumpToFingerprint(fp: Fingerprint): Promise<'ok' | 'missing' | 'stale'> {
  return (await jumpToFingerprintTraced(fp)).result;
}

export async function jumpToFingerprintTraced(fp: Fingerprint): Promise<JumpTrace> {
  const merge = lastMerge;
  const source = findSource(fp, merge);
  const isTop = !source || source.role === 'top' || fp.sk === 'top' || ((fp.f == null || fp.f === TOP_FRAME_ID) && !fp.sk);
  const expectSig = fp.ds || source?.docSig;

  if (isTop) {
    const base = { route: 'top' as const, sk: 'top', frameId: TOP_FRAME_ID };
    const r = locateInDoc(document, fp, expectSig);
    if (!r.el) return { ...base, result: r.stale ? 'stale' : 'missing', reason: r.reason };
    jumpTo(r.el);
    return { ...base, result: 'ok', reason: r.exact ? 'exact' : 'fuzzy', matched: headOf(r.el) };
  }

  const iframe = findIframeForSource(source);
  if (source.frameId === SAME_ORIGIN_FRAME_ID || source.frameId < 0) {
    const base = { route: 'same-origin' as const, sk: source.sk, frameId: source.frameId };
    if (!iframe) return { ...base, result: 'stale', reason: 'iframe gone' };
    try {
      const doc = iframe.contentDocument;
      if (!doc) return { ...base, result: 'stale', reason: 'no contentDocument' };
      if (source.href && doc.URL && !urlsLooselyEqual(doc.URL, source.href)) return { ...base, result: 'stale', reason: 'iframe navigated' };
      const r = locateInDoc(doc, fp, expectSig, source.href);
      if (!r.el) return { ...base, result: r.stale ? 'stale' : 'missing', reason: r.reason };
      try { scrollFrameRectIntoView(iframe, settleInFrame(r.el)); } catch { /* scrolling is best-effort; the highlight still runs */ }
      jumpTo(r.el, { scroll: false });
      return { ...base, result: 'ok', reason: r.exact ? 'exact' : 'fuzzy', matched: headOf(r.el) };
    } catch (e: any) {
      return { ...base, result: 'stale', reason: String(e?.message ?? e) };
    }
  }

  // Cross-origin: the child resolves + highlights in place and reports the rect; the top page does the outer scroll.
  const base = { route: 'cross-origin' as const, sk: source.sk, frameId: source.frameId };
  try {
    const reply = await chrome.runtime.sendMessage({
      type: FRAME_LOCATE,
      frameId: source.frameId,
      fingerprint: fp,
      expectHref: source.href,
      expectDocSig: expectSig,
    }) as FrameLocateReply;
    if (!reply?.ok) return { ...base, result: reply?.stale ? 'stale' : 'missing', reason: reply?.error ?? 'no reply' };
    if (source.href && !urlsLooselyEqual(reply.href, source.href)) return { ...base, result: 'stale', reason: 'iframe navigated' };
    if (!reply.found) return { ...base, result: 'missing', reason: 'no matching block in frame' };
    if (iframe && reply.rect) try { scrollFrameRectIntoView(iframe, reply.rect); } catch { /* best-effort */ }
    return { ...base, result: 'ok', reason: reply.exact ? 'exact' : 'fuzzy', matched: reply.matched };
  } catch (e: any) {
    return { ...base, result: 'missing', reason: String(e?.message ?? e) };
  }
}

/** @deprecated prefer findIframeForSource — kept for callers that only have a src string */
export function findIframeBySrc(src: string | undefined): HTMLIFrameElement | null {
  if (!src) return null;
  for (const el of listCandidateIframes(document)) {
    if (urlsLooselyEqual(absUrl(el.src, location.href), src)) return el;
  }
  for (const el of document.querySelectorAll('iframe')) {
    if (urlsLooselyEqual(absUrl((el as HTMLIFrameElement).src, location.href), src)) return el as HTMLIFrameElement;
  }
  return null;
}

/**
 * Only a direct child of the top page may answer the top's probe: the top frame is the only sender we trust,
 * and a candidate frame must not be able to hand the nonce to a grandchild to get a deeper frame read.
 */
export function isTrustedProbe(ev: Pick<MessageEvent, 'source'>, win: { parent: unknown; top: unknown }): boolean {
  return win.parent !== win && win.parent === win.top && ev.source === win.parent;
}

function handleProbeMessage(ev: MessageEvent) {
  if (!isTrustedProbe(ev, window)) return;
  const data = ev.data;
  if (!data || data.source !== REPRESENTER_SOURCE || data.type !== FRAME_PROBE) return;
  if (typeof data.nonce !== 'string' || !data.nonce || data.nonce.length > 128) return;
  try { chrome.runtime.sendMessage({ type: FRAME_ACK, nonce: data.nonce }); } catch { /* */ }
}

/** Child-frame worker: answer extract / locate / ping / probe-ack. No UI. */
export function installFrameWorker() {
  window.addEventListener('message', handleProbeMessage);
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (msg.type === FRAME_EXTRACT) {
      try {
        const page = extractPage();
        reply({
          ok: true,
          href: location.href,
          title: page.title,
          content: page.content,
          anchors: page.anchors,
          nestedContentFrames: countNestedContentFrames(document),
          nestedFrames: describeNestedFrames(document),
          ...(import.meta.env.VITE_RP_DIAG === '1' ? { diagBlocks: diagBlockTexts(document) } : {}),
          docSig: docSignature(page.content),
        } satisfies FrameExtractReply);
      } catch (e: any) {
        reply({ ok: false, error: String(e?.message ?? e), href: location.href } satisfies FrameExtractReply);
      }
      return true;
    }
    if (msg.type === FRAME_PING) {
      try {
        reply({ ok: true, href: location.href, docSig: liveExtractSignature() } satisfies FramePingReply);
      } catch (e: any) {
        reply({ ok: false, error: String(e?.message ?? e) });
      }
      return true;
    }
    if (msg.type === FRAME_LOCATE) {
      try {
        const expectHref = msg.expectHref as string | undefined;
        const expectDocSig = msg.expectDocSig as string | undefined;
        if (expectHref && !urlsLooselyEqual(location.href, expectHref)) {
          reply({ ok: false, error: 'navigated', stale: true, href: location.href } satisfies FrameLocateReply);
          return true;
        }
        const r = locateInDoc(document, msg.fingerprint as Fingerprint, expectDocSig);
        if (r.el) {
          const rect = settleInFrame(r.el);
          jumpTo(r.el, { scroll: false });
          reply({ ok: true, found: true, href: location.href, docSig: '', rect, matched: headOf(r.el), exact: r.exact } satisfies FrameLocateReply);
        } else if (r.stale) reply({ ok: false, error: r.reason, stale: true, href: location.href } satisfies FrameLocateReply);
        else reply({ ok: true, found: false, href: location.href, docSig: '' } satisfies FrameLocateReply);
      } catch (e: any) {
        reply({ ok: false, error: String(e?.message ?? e), href: location.href } satisfies FrameLocateReply);
      }
      return true;
    }
    return false;
  });

  try { chrome.runtime.sendMessage({ type: FRAME_HELLO }); } catch { /* */ }
  window.addEventListener('pagehide', () => {
    try { chrome.runtime.sendMessage({ type: FRAME_BYE }); } catch { /* */ }
  });
}

export type { FrameSource, FrameNotice, MergedPage };
