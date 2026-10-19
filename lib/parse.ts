import { ICON_TYPES, type IconType, type Section, type Summary } from './types';

const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const optStrs = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
/** `p12`, also tolerating `[p12]` / `P12` / 12. */
export const anchorId = (v: unknown): string => { const m = String(v ?? '').match(/^\s*\[?\s*p?(\d+)\s*\]?\s*$/i); return m ? `p${+m[1]!}` : ''; };

/** Structural check for a Summary (replaces the former zod schema; same rules). */
export function isSummary(v: any): v is Summary {
  return !!v && typeof v.overview === 'string' && v.overview.length > 0
    && Array.isArray(v.keyTerms) && v.keyTerms.every((t: unknown) => typeof t === 'string')
    && Array.isArray(v.sections) && v.sections.every((s: any) =>
      s && typeof s.title === 'string' && s.title.length > 0 && ICON_TYPES.includes(s.icon)
      && Array.isArray(s.bullets) && s.bullets.every((b: unknown) => typeof b === 'string')
      && optStr(s.anchor) && optStrs(s.anchors) && optStr(s.quote) && optStrs(s.quotes));
}

/** Extract and validate the summary JSON returned by the LLM (tolerates code fences / prose). */
export function parseSummary(text: string): Summary {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model output');
  const raw = JSON.parse(s.slice(start, end + 1));
  if (typeof raw.overview !== 'string' || !raw.overview.trim()) throw new Error('Missing "overview"');
  const keyTerms = Array.isArray(raw.keyTerms ?? raw.key_terms)
    ? (raw.keyTerms ?? raw.key_terms).filter((t: unknown) => typeof t === 'string' && t.trim()).map((t: string) => t.trim())
    : [];
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
  const summary = { overview: raw.overview.trim(), keyTerms, sections };
  if (!isSummary(summary)) throw new Error('Invalid summary: every section needs a non-empty title');
  return summary;
}

export type Segment = { text: string; highlight: boolean };

/** Split text into segments, marking occurrences of key terms (case-insensitive, longest first). */
export function highlightTerms(text: string, terms: string[]): Segment[] {
  const t = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!t.length) return [{ text, highlight: false }];
  const re = new RegExp('(' + t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return text.split(re).filter(Boolean).map((p) => ({ text: p, highlight: t.some((x) => x.toLowerCase() === p.toLowerCase()) }));
}
