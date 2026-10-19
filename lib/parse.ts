import { ICON_TYPES, type IconType, type Section, type Summary } from './types';

/** Structural check for a Summary (replaces the former zod schema; same rules). */
export function isSummary(v: any): v is Summary {
  return !!v && typeof v.overview === 'string' && v.overview.length > 0
    && Array.isArray(v.keyTerms) && v.keyTerms.every((t: unknown) => typeof t === 'string')
    && Array.isArray(v.sections) && v.sections.every((s: any) =>
      s && typeof s.title === 'string' && s.title.length > 0 && ICON_TYPES.includes(s.icon)
      && Array.isArray(s.bullets) && s.bullets.every((b: unknown) => typeof b === 'string')
      && (s.quote === undefined || typeof s.quote === 'string')
      && (s.quotes === undefined || (Array.isArray(s.quotes) && s.quotes.every((q: unknown) => typeof q === 'string'))));
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
      // bullets are {text, quote} objects; plain strings (older contract / sloppy output) still work
      const items = (Array.isArray(x.bullets) ? x.bullets : [])
        .map((b: any) => (typeof b === 'string' ? { text: b } : b && typeof b.text === 'string' ? b : null))
        .filter((b: any) => b && b.text.trim());
      const quotes = items.map((b: any) => (typeof b.quote === 'string' ? b.quote.trim() : ''));
      const sec: Section = { title: x.title.trim(), icon: (ICON_TYPES.includes(x.icon) ? x.icon : 'list') as IconType, bullets: items.map((b: any) => b.text.trim()) };
      if (typeof x.quote === 'string' && x.quote.trim()) sec.quote = x.quote.trim();
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
