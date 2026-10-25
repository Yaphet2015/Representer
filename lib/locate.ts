/**
 * Overview items → page passages, like anchors.
 *
 * At extraction every text block of the live page gets an id (`p1`, `p2`, …). The model sees the ids as
 * `[p12]` markers in the content and returns an `anchor` id per section / bullet, so it never has to copy text.
 * For each id we keep a fingerprint (hash + length of the block's letters/digits, its leading words, its
 * position). Later, against the live DOM (after the summary, on clicks, after DOM changes), an id is resolved:
 *  1. a block with the same text hash (ties → the one closest to the original position),
 *  2. else a block that starts the same way with a similar length (text was edited a bit),
 *  3. else fuzzy word overlap with the stored leading words, then with the item text.
 * Summaries cached before anchors existed (plain strings, or the short-lived `quote` format) use the fuzzy
 * path / quote search only.
 */

const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'SUMMARY', 'CAPTION']);
const BOX_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE']); // only when they hold text themselves
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME', 'BUTTON', 'NAV', 'FOOTER']);
/** Our overlay host; its content lives in a shadow root, but never match inside it either way. */
export const OVERLAY_TAG = 'representer-overlay';
const MIN_KEY = 12; // shortest partial quote (in letters/digits) we trust
const HEAD_CHARS = 64; // leading text kept per fingerprint (local storage only, never sent to the model)

/** Letters and digits only, lower-cased (NFKC folds full-width forms). */
export function keyOf(s: string): string {
  let out = '';
  for (const c of s.normalize('NFKC').toLowerCase()) if (/[\p{L}\p{N}]/u.test(c)) out += c;
  return out;
}

/** FNV-1a, 32-bit, hex. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

const STOP = new Set('the and for are but not you all any can had her was one our out has his how its may new now see two way who did get let put say she too use that with have this from they will would there their what about which when your into than them then some these been more also such only over very just like most other where after could while should'.split(' '));
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

/** Comparable tokens: words (3+ letters, minus stop words, crude stemming) and CJK character bigrams. */
export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    for (const run of w.match(CJK) ?? []) for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
    for (const x of w.replace(CJK, ' ').split(' ')) if (x.length >= 3 && !STOP.has(x)) out.add(x.length > 5 ? x.slice(0, 5 + Math.floor((x.length - 5) / 2)) : x);
  }
  return out;
}

/** Index of the text that best overlaps `query` (share of the query's tokens found), or -1 below `min`. */
export function bestMatch(texts: string[], query: string, min = 0.6): number {
  const q = tokens(query);
  if (q.size < 2) return -1;
  let best = -1, score = 0;
  texts.forEach((t, i) => {
    const b = tokens(t); let hit = 0;
    for (const x of q) if (b.has(x)) hit++;
    const s = hit / q.size;
    if (hit >= 2 && s > score) { score = s; best = i; }
  });
  return score >= min ? best : -1;
}

/** Legacy `quote` summaries: find a quote in a keyOf() string, exact then head / tail / middle. */
export function findQuote(hayKey: string, quote: string, from = 0): [number, number] | null {
  const q = keyOf(quote);
  if (q.length < 6) return null;
  const at = (needle: string): [number, number] | null => { const i = hayKey.indexOf(needle, from); return i < 0 ? null : [i, i + needle.length]; };
  const exact = at(q);
  if (exact || q.length < MIN_KEY * 2) return exact;
  const part = Math.max(MIN_KEY, Math.floor(q.length * 0.4));
  return at(q.slice(0, part)) ?? at(q.slice(-part)) ?? at(q.slice(Math.floor((q.length - part) / 2), Math.floor((q.length + part) / 2)));
}

// ── page blocks ───────────────────────────────────────────────────────────────

const skipped = (el: Element | null): boolean => {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName.toUpperCase()) || e.localName === OVERLAY_TAG || e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
};
const visible = (el: Element) => typeof (el as any).getClientRects !== 'function' || el.getClientRects().length > 0;
const ownText = (el: Element) => { let s = ''; for (const n of el.childNodes) if (n.nodeType === 3) s += (n as Text).data; return s; };
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Innermost text blocks of the page, in document order (paragraphs, list items, headings, cells, text-holding divs). */
export function listBlocks(doc: Document): Element[] {
  const root = doc.body ?? doc.documentElement;
  const cands = [...root.querySelectorAll('*')].filter((el) => {
    const tag = el.tagName.toUpperCase();
    return BLOCK_TAGS.has(tag) || (BOX_TAGS.has(tag) && keyOf(ownText(el)).length >= 20);
  });
  const parents = new Set<Element>();
  const set = new Set(cands);
  for (const el of cands) for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (set.has(p)) parents.add(p);
  // a box that only wraps other blocks is not a block itself; a <p>/<li> wrapping nested blocks keeps its own place
  return cands.filter((el) => !(parents.has(el) && BOX_TAGS.has(el.tagName.toUpperCase())) && !skipped(el) && keyOf(el.textContent ?? '').length >= 2 && visible(el));
}

export interface Fingerprint { /** hash of the letters/digits */ h: string; /** their count */ n: number; /** leading text */ head: string; /** position among the page blocks */ o: number }
export type Anchors = Record<string, Fingerprint>;

export function fingerprint(el: Element, o: number): Fingerprint {
  const text = clean(el.textContent ?? '');
  const k = keyOf(text);
  return { h: hash(k), n: k.length, head: text.slice(0, HEAD_CHARS), o };
}

/** Number the page's blocks: ids p1…pN in document order, with their fingerprints. */
export function numberBlocks(doc: Document): { blocks: Element[]; anchors: Anchors } {
  const blocks = listBlocks(doc);
  const anchors: Anchors = {};
  blocks.forEach((el, i) => { anchors[`p${i + 1}`] = fingerprint(el, i); });
  return { blocks, anchors };
}

/** The fingerprints a summary actually points at (what gets cached). */
export function usedAnchors(summary: { sections: { anchor?: string; anchors?: string[] }[]; quote?: { anchor?: string } }, all: Anchors | undefined): Anchors | undefined {
  if (!all) return undefined;
  const out: Anchors = {};
  for (const s of summary.sections) for (const id of [s.anchor, ...(s.anchors ?? [])]) if (id && all[id]) out[id] = all[id]!;
  const q = summary.quote?.anchor;
  if (q && all[q]) out[q] = all[q]!;
  return out;
}

/** Matches `[p12]` markers in extracted content (Markdown converters may escape the brackets). */
export const MARKER_RE = /\\?\[p(\d+)\\?\]\s?/g;
export const stripMarkers = (s: string) => s.replace(MARKER_RE, '');

/** Text of each `[pN]` block in extracted content (up to the next marker). */
export function blockTexts(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const ms = [...content.matchAll(MARKER_RE)];
  ms.forEach((m, i) => {
    const id = `p${m[1]}`;
    if (!out.has(id)) out.set(id, content.slice(m.index! + m[0].length, ms[i + 1]?.index ?? content.length));
  });
  return out;
}

// ── live resolution ───────────────────────────────────────────────────────────

export interface LiveIndex { blocks: Element[]; fps: Fingerprint[]; texts: string[]; keys: string[]; byHash: Map<string, number[]>; key: string; keyBlock: number[] }

export function liveIndex(doc: Document): LiveIndex {
  const blocks = listBlocks(doc);
  const fps = blocks.map((el, i) => fingerprint(el, i));
  const texts = blocks.map((el) => clean(el.textContent ?? ''));
  const keys = texts.map(keyOf);
  const byHash = new Map<string, number[]>();
  fps.forEach((f, i) => { const l = byHash.get(f.h); if (l) l.push(i); else byHash.set(f.h, [i]); });
  // flat letters/digits string with a block index per char, for legacy quotes
  let key = ''; const keyBlock: number[] = [];
  keys.forEach((k, i) => { key += k; for (let j = 0; j < k.length; j++) keyBlock.push(i); });
  return { blocks, fps, texts, keys, byHash, key, keyBlock };
}

const closest = (list: number[], o: number) => list.reduce((a, b) => (Math.abs(b - o) < Math.abs(a - o) ? b : a));

/**
 * How far blocks moved since extraction (content added/removed above): the median move of anchors whose
 * text is unique on the page. Lets duplicates be told apart by position even after the page shifted.
 */
export function pageShift(live: LiveIndex, anchors: Anchors | undefined): number {
  const d: number[] = [];
  for (const fp of Object.values(anchors ?? {})) {
    const same = live.byHash.get(fp.h);
    if (same?.length === 1) d.push(same[0]! - fp.o);
  }
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : 0;
}

/** Find the live block for a stored fingerprint; `shift` from pageShift(). */
export function resolveFingerprint(live: LiveIndex, fp: Fingerprint, shift = 0): Element | null {
  const o = fp.o + shift;
  const same = live.byHash.get(fp.h)?.filter((i) => live.fps[i]!.n === fp.n);
  if (same?.length) return live.blocks[closest(same, o)]!;
  const head = keyOf(fp.head).slice(0, 24);
  if (head.length >= 8) {
    const near = live.keys.flatMap((k, i) => (k.startsWith(head) && Math.abs(live.fps[i]!.n - fp.n) <= Math.max(20, fp.n * 0.3) ? [i] : []));
    if (near.length) return live.blocks[closest(near, o)]!;
  }
  const i = bestMatch(live.texts, fp.head, 0.7);
  return i >= 0 ? live.blocks[i]! : null;
}

const shifts = new WeakMap<LiveIndex, Map<Anchors | undefined, number>>();
const shiftOf = (live: LiveIndex, anchors: Anchors | undefined) => {
  let m = shifts.get(live); if (!m) shifts.set(live, (m = new Map()));
  if (!m.has(anchors)) m.set(anchors, pageShift(live, anchors));
  return m.get(anchors)!;
};

export interface Item { anchor?: string; /** legacy summaries only */ quote?: string; text: string }

/** The live block an overview item points to, or null. */
export function resolveItem(live: LiveIndex, anchors: Anchors | undefined, item: Item): Element | null {
  const fp = item.anchor ? anchors?.[item.anchor] : undefined;
  if (fp) { const el = resolveFingerprint(live, fp, shiftOf(live, anchors)); if (el) return el; }
  if (item.quote) { const hit = findQuote(live.key, item.quote); if (hit) return live.blocks[live.keyBlock[hit[0]]!]!; }
  for (const q of [item.quote, item.text]) {
    const i = q ? bestMatch(live.texts, q) : -1;
    if (i >= 0) return live.blocks[i]!;
  }
  return null;
}

/** Smooth-scroll a block into view (centered) and flash a fading highlight on it. */
export function jumpTo(el: Element) {
  const win = el.ownerDocument.defaultView ?? window;
  const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const tall = el.getBoundingClientRect().height > win.innerHeight * 0.7;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: tall ? 'start' : 'center', inline: 'nearest' });
  // Paint-only properties: no layout shift, and the page's own styles come back when it ends.
  const on = 'rgba(255, 196, 0, 0.32)', off = 'rgba(255, 196, 0, 0)';
  el.animate?.(
    [
      { backgroundColor: on, boxShadow: `0 0 0 6px ${on}`, borderRadius: '4px' },
      { backgroundColor: on, boxShadow: `0 0 0 6px ${on}`, borderRadius: '4px', offset: 0.35 },
      { backgroundColor: off, boxShadow: `0 0 0 6px ${off}`, borderRadius: '4px' },
    ],
    { duration: reduce ? 900 : 1800, delay: reduce ? 0 : 250, easing: 'ease-out' },
  );
}
