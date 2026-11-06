/**
 * Discover which same-document iframes are likely to hold the main readable content, and merge their
 * Defuddle extractions with the top page without rewriting Defuddle itself.
 */
import { MARKER_RE, hash, keyOf, type Anchors, type Fingerprint } from './locate';
import { stripMarkers } from './locate';
import type { ExtractedDoc } from './extract';

export const TOP_FRAME_ID = 0;
export const SAME_ORIGIN_FRAME_ID = -1;

export type FrameNotice =
  | { kind: 'nested_unread'; href: string; count: number }
  | { kind: 'inaccessible'; href: string }
  | { kind: 'not_loaded'; href: string }
  | { kind: 'timeout'; href: string }
  | { kind: 'unsupported_depth'; href: string };

export interface FrameSource {
  /** Stable source identity (`top` / `embed:N` in candidate order). Not a Chrome frameId. */
  sk: string;
  /** Volatile transport id for cross-origin relay (0 = top; may be -1 for same-origin). */
  frameId: number;
  href: string;
  role: 'top' | 'embed';
  embedSrc?: string;
  /** Index among listCandidateIframes at extract time (embed only); for rebinding same-src peers */
  candidateIndex?: number;
  /** Signature of extractDocument().content — must match live extract, never body.innerText */
  docSig: string;
  generation: string;
  nestedFrames?: NestedFrameInfo[];
  /** DEV diagnostics builds only: full DOM block texts by local ordinal */
  diagBlocks?: string[];
}

export interface FramePart extends ExtractedDoc {
  sk: string;
  frameId: number;
  href: string;
  role: 'top' | 'embed';
  embedSrc?: string;
  candidateIndex?: number;
  /** Nested iframes that themselves look like content holders (decorative/empty ignored) */
  nestedContentFrames?: number;
  /** every iframe inside this document, with why it counts (diagnostics) */
  nestedFrames?: NestedFrameInfo[];
  diagBlocks?: string[];
  docSig: string;
}

export interface MergedPage {
  title: string;
  content: string;
  anchors: Anchors;
  sources: FrameSource[];
  notices: FrameNotice[];
  generation: string;
}

export const FRAME_EXCLUDE_RE =
  /(?:^|[^a-z0-9])(?:ad|ads|advert|advertisement|banner-ad|login|signin|sign-in|signup|sign-up|auth|oauth|sso|pay|payment|checkout|cart|billing|chat(?:bot)?|intercom|crisp|drift|widget|cookie|consent|gdpr|pixel|track(?:ing)?|analytics|tag-manager|doubleclick|googletag|facebook\.com\/|twitter\.com\/|linkedin\.com\/|recaptcha|hcaptcha|stripe|paypal)(?:[^a-z0-9]|$)/i;

const MIN_SIDE = 180;
const MIN_AREA = 80_000;
const MIN_VIEWPORT_SHARE = 0.12;
export const THIN_CHARS = 400;
export const THIN_BLOCKS = 3;

export function absUrl(src: string, base: string): string {
  try { return new URL(src, base).href; } catch { return src; }
}

export function plainLength(content: string): number {
  return stripMarkers(content).replace(/\s+/g, ' ').trim().length;
}

export function blockCount(content: string): number {
  return [...content.matchAll(MARKER_RE)].length;
}

export function isThinContent(content: string): boolean {
  return plainLength(content) < THIN_CHARS || blockCount(content) < THIN_BLOCKS;
}

export function isSubstantialContent(content: string): boolean {
  return plainLength(content) >= THIN_CHARS && blockCount(content) >= THIN_BLOCKS;
}

/** Stable short signature of extracted plain text for stale detection after same-URL refresh. */
export function docSignature(content: string): string {
  const plain = stripMarkers(content).replace(/\s+/g, ' ').trim();
  return hash(keyOf(plain.slice(0, 4000)) + ':' + plain.length);
}

function haystack(el: HTMLIFrameElement): string {
  return [el.src, el.name, el.id, el.className, el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('data-testid') ?? ''].join(' ');
}

export function isExcludedFrame(el: HTMLIFrameElement): boolean {
  return FRAME_EXCLUDE_RE.test(haystack(el));
}

function isInvisiblyStyled(el: HTMLIFrameElement): boolean {
  const attr = (el.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
  if (/visibility:\s*hidden/.test(attr) || /opacity:\s*0(?:\.0+)?(?:;|$)/.test(attr)) return true;
  try {
    const s = el.style;
    if (s && (String(s.visibility).toLowerCase() === 'hidden' || String(s.opacity) === '0')) return true;
  } catch { /* */ }
  if (typeof getComputedStyle === 'function') {
    try {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') return true;
    } catch { /* */ }
  }
  return false;
}

export function isContentCandidate(el: HTMLIFrameElement, viewport = { w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 800 }): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
  if (isInvisiblyStyled(el)) return false;
  const rawSrc = (el.getAttribute('src') || el.src || '').trim();
  // Empty / about:blank / javascript: are chrome or media shells — not unread article bodies
  if (!rawSrc || /^about:blank/i.test(rawSrc) || /^javascript:/i.test(rawSrc)) return false;
  if (isExcludedFrame(el)) return false;
  const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: viewport.w, height: viewport.h, top: 0, left: 0, bottom: viewport.h, right: viewport.w };
  if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
  const area = Math.max(0, r.width) * Math.max(0, r.height);
  const vp = Math.max(1, viewport.w * viewport.h);
  if (area < MIN_AREA && area < MIN_VIEWPORT_SHARE * vp) return false;
  return true;
}

export function listCandidateIframes(doc: Document, viewport?: { w: number; h: number }): HTMLIFrameElement[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];
  const IFrame = doc.defaultView?.HTMLIFrameElement;
  return [...root.querySelectorAll('iframe')].filter((el) => {
    if (IFrame && !(el instanceof IFrame)) return false;
    return isContentCandidate(el as HTMLIFrameElement, viewport);
  }) as HTMLIFrameElement[];
}

/** Players, maps, sandboxes and charts: real embeds, but not unread article text. */
export const MEDIA_FRAME_RE = /(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|player\.|spotify\.com|soundcloud\.com|twitch\.tv|loom\.com|wistia|brightcove|dailymotion|bilibili\.com|plotly|datawrapper|flourish\.studio|observablehq|codepen\.io|jsfiddle|codesandbox|stackblitz|figma\.com|google\.[a-z.]+\/maps|openstreetmap|giphy|tenor\.com|\.(?:mp4|webm|mp3|pdf)(?:$|[?#]))/i;

export function isMediaFrame(el: HTMLIFrameElement): boolean {
  const src = el.getAttribute('src') || el.src || '';
  if (MEDIA_FRAME_RE.test(src)) return true;
  const allow = (el.getAttribute('allow') || '').toLowerCase();
  return /autoplay|encrypted-media|picture-in-picture/.test(allow) && !/clipboard/.test(allow);
}

export interface NestedFrameInfo { src: string; w: number; h: number; candidate: boolean; media: boolean }

/** Every iframe in a document with why it does or does not count as unread nested text (diagnostics + notice). */
export function describeNestedFrames(doc: Document): NestedFrameInfo[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];
  return [...root.querySelectorAll('iframe')].map((el) => {
    const f = el as HTMLIFrameElement;
    let w = 0, h = 0;
    try { const r = f.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height); } catch { /* */ }
    return { src: (f.getAttribute('src') || '').slice(0, 300), w, h, candidate: isContentCandidate(f), media: isMediaFrame(f) };
  });
}

/** Nested frames that plausibly hold more article text (media/decorative excluded). */
export function countNestedContentFrames(doc: Document): number {
  return describeNestedFrames(doc).filter((f) => f.candidate && !f.media).length;
}

export function embedScore(part: FramePart): number {
  return plainLength(part.content) * 10 + part.content.length;
}

/**
 * Remap `[pN]` markers into a shared id space.
 * Fingerprint.`o` stays the **local** ordinal inside that document (for locate inside the frame).
 * `sk` is the stable source key; `f` is volatile transport only; `g` is generation.
 */
export function remapPart(part: FramePart, offset: number, generation: string): { content: string; anchors: Anchors; next: number } {
  const idMap = new Map<string, string>();
  let max = offset;
  const content = part.content.replace(MARKER_RE, (_m, n: string) => {
    const old = `p${n}`;
    const next = offset + Number(n);
    if (next > max) max = next;
    const id = `p${next}`;
    idMap.set(old, id);
    return `[${id}] `;
  });
  const anchors: Anchors = {};
  for (const [old, fp] of Object.entries(part.anchors)) {
    const id = idMap.get(old) ?? (() => {
      const n = Number(String(old).replace(/^p/i, ''));
      return Number.isFinite(n) ? `p${offset + n}` : '';
    })();
    if (!id) continue;
    anchors[id] = { ...fp, o: fp.o, f: part.frameId, sk: part.sk, ds: part.docSig, g: generation } satisfies Fingerprint;
    if (!idMap.has(old)) {
      const n = Number(String(old).replace(/^p/i, ''));
      if (Number.isFinite(n) && offset + n > max) max = offset + n;
    }
  }
  return { content, anchors, next: Math.max(max, offset) };
}

export function dedupeContent(content: string, anchors: Anchors, seen: Set<string>): { content: string; anchors: Anchors } {
  const parts = content.split(/(?=\[p\d+\]\s?)/);
  const kept: string[] = [];
  const nextAnchors: Anchors = {};
  for (const chunk of parts) {
    const m = chunk.match(/^\[p(\d+)\]\s?/);
    if (!m) { if (chunk.trim()) kept.push(chunk); continue; }
    const id = `p${m[1]}`;
    const fp = anchors[id];
    const token = fp && fp.n >= 12 ? fp.h : '';
    if (token && seen.has(token)) continue;
    if (token) seen.add(token);
    kept.push(chunk);
    if (fp) nextAnchors[id] = fp;
  }
  return { content: kept.join('').trim(), anchors: nextAnchors };
}

export function sourceKeyFor(role: 'top' | 'embed', candidateIndex?: number): string {
  if (role === 'top') return 'top';
  return `embed:${candidateIndex ?? 0}`;
}

export function newGeneration(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* */ }
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function mergeFrameParts(parts: FramePart[], notices: FrameNotice[] = [], generation = newGeneration()): MergedPage {
  const top = parts.find((p) => p.role === 'top');
  const embeds = parts.filter((p) => p.role === 'embed' && plainLength(p.content) > 0)
    .sort((a, b) => embedScore(b) - embedScore(a));

  const outNotices = [...notices];
  for (const e of embeds) {
    const n = e.nestedContentFrames ?? 0;
    // A full article with charts/demos embedded in it is complete text; only a thin shell around
    // further frames means the reader's text may live one level deeper.
    if (n > 0 && isThinContent(e.content)) outNotices.push({ kind: 'nested_unread', href: e.href, count: n });
  }

  const ordered: FramePart[] = [];
  if (top && isSubstantialContent(top.content)) {
    ordered.push(top, ...embeds);
  } else if (embeds.length) {
    ordered.push(embeds[0]!, ...embeds.slice(1));
  } else if (top) {
    ordered.push(top);
  }

  let offset = 0;
  const seen = new Set<string>();
  const chunks: string[] = [];
  const anchors: Anchors = {};
  const sources: FrameSource[] = [];
  let title = top?.title || embeds[0]?.title || '';

  for (const part of ordered) {
    const remapped = remapPart(part, offset, generation);
    let content = remapped.content;
    let partAnchors = remapped.anchors;
    if (part.role === 'embed' && seen.size) {
      const d = dedupeContent(content, partAnchors, seen);
      content = d.content;
      partAnchors = d.anchors;
    } else {
      for (const fp of Object.values(partAnchors)) if (fp.n >= 12) seen.add(fp.h);
    }
    if (!content.trim()) { offset = remapped.next; continue; }
    if (part.role === 'embed' && top && isThinContent(top.content) && part.title) title = part.title || title;
    chunks.push(content);
    Object.assign(anchors, partAnchors);
    sources.push({
      sk: part.sk,
      frameId: part.frameId,
      href: part.href,
      role: part.role,
      embedSrc: part.embedSrc,
      candidateIndex: part.candidateIndex,
      nestedFrames: part.nestedFrames,
      diagBlocks: part.diagBlocks,
      docSig: part.docSig || docSignature(part.content),
      generation,
    });
    offset = remapped.next;
  }

  if (top && isThinContent(top.content) && embeds[0]?.title) title = embeds[0].title;

  const preface = modelPreface(sources, outNotices);
  const body = chunks.join('\n\n').trim();
  return {
    title: title || '',
    content: preface ? `${preface}\n\n${body}`.trim() : body,
    anchors,
    sources,
    notices: outNotices,
    generation,
  };
}

/**
 * The document a frame shows, without its #fragment. Frames such as HF Spaces rewrite their fragment to the
 * section in view while the reader scrolls; the text sent to the model (and hashed for the summary cache)
 * must not change with it. A hash router that really shows another page changes the extracted text instead.
 * `FrameSource.href` keeps the full URL for locating.
 */
export function docUrl(href: string): string {
  const i = href.indexOf('#');
  return i < 0 ? href : href.slice(0, i);
}

function modelPreface(sources: FrameSource[], notices: FrameNotice[]): string {
  const embeds = sources.filter((s) => s.role === 'embed');
  const lines: string[] = [];
  if (embeds.length === 1 && !sources.some((s) => s.role === 'top')) {
    lines.push(`[Source: main text was read from an embedded document at ${docUrl(embeds[0]!.href)}]`);
  } else if (embeds.length) {
    lines.push(`[Source: page text includes the top document and ${embeds.length} embedded document(s): ${embeds.map((e) => docUrl(e.href)).join(', ')}]`);
  }
  for (const n of notices) {
    if (n.kind === 'nested_unread') lines.push(`[Note: ${n.count} nested content frame(s) inside ${docUrl(n.href)} were not read]`);
    if (n.kind === 'inaccessible') lines.push(`[Note: embedded frame at ${docUrl(n.href)} was not accessible]`);
    if (n.kind === 'not_loaded') lines.push(`[Note: embedded frame at ${docUrl(n.href)} had not finished loading]`);
    if (n.kind === 'timeout') lines.push(`[Note: timed out waiting for embedded frame at ${docUrl(n.href)}]`);
    if (n.kind === 'unsupported_depth') lines.push(`[Note: deeper nested frames under ${docUrl(n.href)} are not supported yet]`);
  }
  return lines.join('\n');
}

export { urlsLooselyEqual } from './frame-protocol';
