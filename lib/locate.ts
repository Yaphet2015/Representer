/**
 * Find the part of the live page a summary item came from, so the overview can work like anchors.
 *
 * Matching runs on a "key" of the page text: only letters and digits, lower-cased, so whitespace,
 * punctuation, curly quotes and inline markup (<b>, <a>, line breaks) can't break a match.
 *  1. exact hit of the item's verbatim quote,
 *  2. otherwise a hit of the quote's head, tail or middle (the model shortened or tweaked it),
 *  3. otherwise the block whose words overlap most with the quote / item text (fuzzy).
 */

const BLOCK_TAGS = new Set(['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'SUMMARY', 'CAPTION']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'IFRAME']);
/** Our overlay host; its content lives in a shadow root, but never match inside it either way. */
export const OVERLAY_TAG = 'representer-overlay';
const MIN_KEY = 12; // shortest partial quote (in letters/digits) we trust

const isKeyChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

/** Letters and digits only, lower-cased (NFKC folds full-width forms). */
export function keyOf(s: string): string {
  let out = '';
  for (const c of s.normalize('NFKC').toLowerCase()) if (isKeyChar(c)) out += c;
  return out;
}

/** Find `quote` in `hayKey` (a keyOf() string): exact, then head / tail / middle. Returns [start, end) or null. */
export function findQuote(hayKey: string, quote: string, from = 0): [number, number] | null {
  const q = keyOf(quote);
  if (q.length < Math.min(MIN_KEY, 6)) return null;
  const at = (needle: string): [number, number] | null => {
    const i = hayKey.indexOf(needle, from);
    return i < 0 ? null : [i, i + needle.length];
  };
  const exact = at(q);
  if (exact || q.length < MIN_KEY * 2) return exact;
  const part = Math.max(MIN_KEY, Math.floor(q.length * 0.4));
  return at(q.slice(0, part)) ?? at(q.slice(-part)) ?? at(q.slice(Math.floor((q.length - part) / 2), Math.floor((q.length + part) / 2)));
}

const STOP = new Set('the and for are but not you all any can had her was one our out has his how its may new now see two way who did get let put say she too use that with have this from they will would there their what about which when your into than them then some these been more also such only over very just like most other where after could while should'.split(' '));

/** Comparable tokens: Latin/Cyrillic/etc. words (3+ letters, minus stop words) and CJK character bigrams. */
export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.normalize('NFKC').toLowerCase();
  for (const w of t.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const cjk = w.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu);
    if (cjk) for (const run of cjk) for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
    const rest = w.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, ' ');
    for (const x of rest.split(' ')) if (x.length >= 3 && !STOP.has(x)) out.add(x.length > 5 ? x.slice(0, 5 + Math.floor((x.length - 5) / 2)) : x); // crude stemming
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

export interface PageIndex { key: string; /** key char index → text node */ nodeAt: Text[]; blocks: Element[]; blockText: string[] }

const skipped = (el: Element | null): boolean => {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName.toUpperCase()) || e.localName === OVERLAY_TAG || e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
};

/** Nearest block-level ancestor of a node (a known block tag, else the first non-inline element), never <body>. */
export function blockOf(node: Node): Element | null {
  const view = node.ownerDocument?.defaultView;
  let first: Element | null = null;
  for (let e = node.parentElement; e && e.localName !== 'body' && e.localName !== 'html'; e = e.parentElement) {
    if (BLOCK_TAGS.has(e.tagName.toUpperCase())) return e;
    if (!first) {
      const d = view?.getComputedStyle?.(e).display;
      if (d ? !d.startsWith('inline') && d !== 'contents' : /^(DIV|SECTION|ARTICLE|ASIDE|MAIN)$/i.test(e.tagName)) first = e;
    }
  }
  return first;
}

export function buildIndex(doc: Document): PageIndex {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodeAt: Text[] = []; const blocks: Element[] = []; const blockText: string[] = [];
  const slot = new Map<Element, number>();
  let key = '';
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.data.trim() || skipped(n.parentElement)) continue;
    const k = keyOf(n.data);
    key += k; for (let i = 0; i < k.length; i++) nodeAt.push(n);
    const b = blockOf(n);
    if (!b) continue;
    let i = slot.get(b);
    if (i == null) { i = blocks.push(b) - 1; blockText.push(''); slot.set(b, i); }
    blockText[i] += ' ' + n.data;
  }
  return { key, nodeAt, blocks, blockText };
}

const visible = (el: Element) => typeof (el as any).getClientRects !== 'function' || el.getClientRects().length > 0;

/** The page block an item points to, or null. `quote` is verbatim page text; `text` is the item itself (fallback). */
export function locate(index: PageIndex, item: { quote?: string; text: string }): Element | null {
  if (item.quote) {
    for (let from = 0, hit = findQuote(index.key, item.quote); hit; hit = findQuote(index.key, item.quote, from)) {
      const el = blockOf(index.nodeAt[hit[0]]!);
      if (el && visible(el)) return el;
      from = hit[0] + 1;
    }
  }
  for (const q of [item.quote, item.text]) {
    const i = q ? bestMatch(index.blockText, q) : -1;
    if (i >= 0 && visible(index.blocks[i]!)) return index.blocks[i]!;
  }
  return null;
}

/** Smooth-scroll a block into view (centered, clear of our panel's height) and flash a fading highlight on it. */
export function jumpTo(el: Element) {
  const win = el.ownerDocument.defaultView ?? window;
  const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const tall = el.getBoundingClientRect().height > win.innerHeight * 0.7;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: tall ? 'start' : 'center', inline: 'nearest' });
  // Paint-only properties: no layout shift, and the page's own styles come back when it ends.
  const color = 'rgba(255, 196, 0, 0.32)';
  el.animate?.(
    [
      { backgroundColor: color, boxShadow: `0 0 0 6px ${color}`, borderRadius: '4px' },
      { backgroundColor: color, boxShadow: `0 0 0 6px ${color}`, borderRadius: '4px', offset: 0.35 },
      { backgroundColor: 'rgba(255, 196, 0, 0)', boxShadow: '0 0 0 6px rgba(255, 196, 0, 0)', borderRadius: '4px' },
    ],
    { duration: reduce ? 900 : 1800, delay: reduce ? 0 : 250, easing: 'ease-out' },
  );
}
