import { normalizeMarks, stripMarks } from './highlight';
import { blockTexts, keyOf } from './locate';
import { ICON_TYPES, type Excerpt, type IconType, type Section, type Summary } from './types';

const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const optStrs = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
/** `p12`, also tolerating `[p12]` / `P12` / 12. */
export const anchorId = (v: unknown): string => { const m = String(v ?? '').match(/^\s*\[?\s*p?(\d+)\s*\]?\s*$/i); return m ? `p${+m[1]!}` : ''; };

/** Structural check for a Summary (replaces the former zod schema; same rules). */
export function isSummary(v: any): v is Summary {
  return !!v && typeof v.overview === 'string' && v.overview.length > 0
    && (v.keyTerms === undefined || (Array.isArray(v.keyTerms) && v.keyTerms.every((t: unknown) => typeof t === 'string')))
    && (v.quote === undefined || (v.quote && typeof v.quote.text === 'string' && typeof v.quote.anchor === 'string'))
    && Array.isArray(v.sections) && v.sections.every((s: any) =>
      s && typeof s.title === 'string' && s.title.length > 0 && ICON_TYPES.includes(s.icon)
      && Array.isArray(s.bullets) && s.bullets.every((b: unknown) => typeof b === 'string')
      && optStr(s.anchor) && optStrs(s.anchors) && optStr(s.quote) && optStrs(s.quotes));
}

/** Extract and validate the summary JSON returned by the LLM (tolerates code fences / prose). */
export function parseSummary(text: string, content?: string): Summary {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  const raw = JSON.parse(s.slice(start, end + 1));
  if (typeof raw.overview !== 'string' || !raw.overview.trim()) throw new Error('Missing "overview"');
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((x: any) => x && typeof x.title === 'string')
    .map((x: any) => {
      // bullets are {text, anchor} objects; plain strings (older summaries / sloppy output) and the legacy {text, quote} still work
      const items = (Array.isArray(x.bullets) ? x.bullets : [])
        .map((b: any) => (typeof b === 'string' ? { text: b } : b && typeof b.text === 'string' ? b : null))
        .filter((b: any) => b && b.text.trim());
      const sec: Section = { title: x.title.trim(), icon: (ICON_TYPES.includes(x.icon) ? x.icon : 'list') as IconType, bullets: items.map((b: any) => b.text.trim()) };
      const anchor = anchorId(x.anchor);
      if (anchor) sec.anchor = anchor;
      const anchors = items.map((b: any) => anchorId(b.anchor));
      if (anchors.some(Boolean)) sec.anchors = anchors;
      if (typeof x.quote === 'string' && x.quote.trim()) sec.quote = x.quote.trim();
      const quotes = items.map((b: any) => (typeof b.quote === 'string' ? b.quote.trim() : ''));
      if (quotes.some(Boolean)) sec.quotes = quotes;
      return sec;
    });
  const summary: Summary = { overview: raw.overview.trim(), sections };
  applyMarks(summary);
  const quote = content ? validateQuote(raw.quote, content) : undefined;
  if (quote) summary.quote = quote;
  if (!isSummary(summary)) throw new Error('Invalid summary: every section needs a non-empty title');
  return summary;
}

/** Marks live in the overview paragraph and the bullets; titles are plain. The limits apply to the whole summary. */
export function applyMarks(summary: Summary): Summary {
  const parts = [summary.overview, ...summary.sections.flatMap((s) => s.bullets)];
  const scopes = [0, ...summary.sections.flatMap((s, i) => s.bullets.map(() => i + 1))];
  const out = normalizeMarks(parts, (i) => scopes[i]!);
  summary.overview = out[0]! || stripMarks(summary.overview);
  let k = 1;
  for (const s of summary.sections) { s.title = stripMarks(s.title); s.bullets = s.bullets.map(() => out[k++]!); }
  return summary;
}

export const QUOTE_MIN = 8, QUOTE_MAX = 200;
/** drop link targets `](https://…)` and the like, which are in the markdown but not the page text */
const bareLinks = (s: string) => s.replace(/\]\([^)]*\)/g, '');

/**
 * Check a model-provided quote against the block it names: its text (letters/digits only) must be part of
 * that block's text, and it must have a sensible length. Anything else is dropped silently.
 */
export function validateQuote(raw: unknown, content: string): Excerpt | undefined {
  const q = raw as { text?: unknown; anchor?: unknown } | null | undefined;
  if (!q || typeof q.text !== 'string') return undefined;
  const text = stripMarks(q.text).replace(/\s+/g, ' ').trim(); // quotation marks are tidied below, after the checks
  if (text.length < QUOTE_MIN || text.length > QUOTE_MAX) return undefined;
  const anchor = anchorId(q.anchor);
  const block = anchor ? blockTexts(content).get(anchor) : undefined;
  if (!block) return undefined;
  const key = keyOf(text);
  if (key.length < 6 || !keyOf(bareLinks(block)).includes(key)) return undefined;
  const clean = cleanQuoteText(text);
  if (clean.length < QUOTE_MIN) return undefined;
  return { text: clean, anchor };
}

const OPEN: Record<string, string> = { '“': '”', '「': '」', '『': '』', '«': '»' };
const CLOSE = new Set(Object.values(OPEN));
/** positions of quotation marks that have no partner (straight `"` pairs up with the next one) */
function unpairedQuotes(s: string): number[] {
  const stack: [string, number][] = []; const lone: number[] = [];
  [...s].forEach((c, i) => {
    if (c === '"') { const top = stack[stack.length - 1]; if (top?.[0] === '"') stack.pop(); else stack.push(['"', i]); }
    else if (OPEN[c]) stack.push([OPEN[c]!, i]);
    else if (CLOSE.has(c)) { const k = stack.map((x) => x[0]).lastIndexOf(c); if (k >= 0) stack.splice(k); else lone.push(i); }
  });
  return [...lone, ...stack.map((x) => x[1])].sort((a, b) => a - b);
}
const WRAPS: [string, string][] = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"], ['「', '」'], ['『', '』'], ['«', '»']];
const EDGE_PUNCT = /^[\s,;:，；：、\-–—]+|[\s,;:，；：、\-–—]+$/g;
/**
 * Tidy a quote that already passed validation: no one-sided quotation marks and no dangling punctuation at the
 * ends. A stray closing mark followed by a short attribution (`…find them," Kanhere said.`) ends the quote there;
 * any other unpaired mark is just removed. Paired marks inside the text stay.
 */
export function cleanQuoteText(text: string): string {
  let out = text.trim();
  // the display adds its own quotation marks, so a pair wrapped around the whole text goes
  for (let n = 0; n < 3; n++) {
    // a quoted sentence followed by a short attribution (`"…them," Kanhere said.`): keep the sentence only
    const open = WRAPS.find(([a]) => out.startsWith(a) && a !== "'" && a !== '‘');
    const close = open ? out.indexOf(open[1], 1) : -1;
    if (open && close > 0 && close < out.length - 1 && out.length - close - 1 <= 40 && !/["“”「」『』«»]/.test(out.slice(close + 1)) && out.slice(1, close).replace(EDGE_PUNCT, '').length >= QUOTE_MIN) { out = out.slice(1, close).replace(EDGE_PUNCT, ''); continue; }
    const pair = WRAPS.find(([a, b]) => out.length > 2 && out.startsWith(a) && out.endsWith(b) && !unpairedQuotes(out.slice(1, -1)).length);
    if (!pair) break;
    out = out.slice(1, -1).trim();
  }
  const lone = unpairedQuotes(out);
  if (lone.length) {
    const last = lone[lone.length - 1]!; const chars = [...out];
    const head = chars.slice(0, last).join('').replace(EDGE_PUNCT, '');
    if ((chars[last] === '"' || CLOSE.has(chars[last]!)) && chars.length - last - 1 <= 40 && head.length >= QUOTE_MIN) out = head;
    out = [...out].filter((_, i) => !unpairedQuotes(out).includes(i)).join('');
  }
  return out.replace(EDGE_PUNCT, '').replace(/\s{2,}/g, ' ').trim();
}
