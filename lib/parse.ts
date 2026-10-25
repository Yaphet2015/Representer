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
  const text = stripMarks(q.text).replace(/\s+/g, ' ').trim();
  if (text.length < QUOTE_MIN || text.length > QUOTE_MAX) return undefined;
  const anchor = anchorId(q.anchor);
  const block = anchor ? blockTexts(content).get(anchor) : undefined;
  if (!block) return undefined;
  const key = keyOf(text);
  if (key.length < 6 || !keyOf(bareLinks(block)).includes(key)) return undefined;
  return { text, anchor };
}
