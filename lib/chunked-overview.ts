/**
 * Long pages (over OVERVIEW_INLINE_MAX): the page is cut into ~12k-character chunks on block boundaries, a fast call
 * with reasoning off extracts anchored key points from each (several in parallel, each repairing its own reply from
 * the validation feedback), and the overview agent then writes the overview from those notes instead of the page.
 * The notes keep the page's block ids, and the agent's tools still check every anchor against the page itself.
 */
import { AbortError } from './abort';
import { blockTexts, MARKER_RE } from './locate';
import type { ChatMessage } from './types';

export const CHUNK_CHARS = 12_000;
/** at most this many extraction calls run at once */
export const EXTRACT_CONCURRENCY = 6;
/** at most this many extraction calls per page: a very long page puts several chunks in one call */
export const MAX_EXTRACT_CALLS = 12;
/** the longest page read this way (characters) */
export const CHUNKED_MAX_CHARS = 800_000;
const REPAIRS = 2, NOTE_MAX = 200, QUOTE_MAX = 220;

/** `offsets[i]`: where block ids[i] starts, in characters from the start of the page's blocks */
export interface Chunk { index: number; ids: string[]; text: string; chars: number; offsets: number[] }
export interface NotePoint { anchor: string; text: string }
export interface ChunkNote { chunk: number; range: string; points: NotePoint[]; quote?: NotePoint; fallback?: boolean }

/**
 * Consecutive blocks in chunks of about `size` characters: the page is cut into ceil(length / size) chunks of equal
 * length, each cut at the block boundary nearest its ideal position (so chunk k is about the k-th `size` characters).
 * A block is never split; one longer than a chunk stands alone.
 */
export function chunkContent(content: string, size = CHUNK_CHARS): Chunk[] {
  const map = blockTexts(content.slice(0, CHUNKED_MAX_CHARS));
  const ids = [...map.keys()];
  const blocks = [...map].map(([id, t]) => `[${id}] ${t.trim()}`);
  // cut by where blocks sit in the page text itself (markers included), so chunk k covers about the k-th equal slice of the page
  const text = content.slice(0, CHUNKED_MAX_CHARS);
  const at = new Map<string, number>();
  for (const m of text.matchAll(MARKER_RE)) if (!at.has(`p${m[1]}`)) at.set(`p${m[1]}`, m.index!);
  const starts = ids.map((id) => at.get(id) ?? 0);
  const total = text.length;
  const ends = starts.map((_, i) => starts[i + 1] ?? total);
  const n = Math.max(1, Math.min(blocks.length, Math.ceil(total / size)));
  // cut k (1..n-1) goes after the block whose end is nearest k*size characters in, always after the previous cut
  const cuts: number[] = [];
  for (let k = 1, i = 0; k < n; k++) {
    const target = k * size;
    i = Math.max(i, (cuts.at(-1) ?? -1) + 1);
    while (i < blocks.length - 2 && Math.abs(ends[i + 1]! - target) <= Math.abs(ends[i]! - target)) i++;
    if (i >= blocks.length - 1) break;
    cuts.push(i);
  }
  const chunks: Chunk[] = [];
  let start = 0;
  for (const end of [...cuts, blocks.length - 1]) {
    const part = blocks.slice(start, end + 1);
    if (part.length) chunks.push({ index: chunks.length, ids: ids.slice(start, end + 1), text: part.join('\n\n'), chars: part.reduce((m, b) => m + b.length, 0), offsets: starts.slice(start, end + 1) });
    start = end + 1;
  }
  return chunks;
}

/** Chunks grouped into at most `maxCalls` consecutive batches of equal size (one call each). */
export function batchChunks(chunks: Chunk[], maxCalls = MAX_EXTRACT_CALLS): Chunk[][] {
  const per = Math.max(1, Math.ceil(chunks.length / maxCalls));
  const out: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += per) out.push(chunks.slice(i, i + per));
  return out;
}

const rangeOf = (c: Chunk) => `${c.ids[0]}-${c.ids.at(-1)}`;
/** points asked for per chunk: about one per 3,500 characters, 2-4 */
export const pointsFor = (c: Chunk) => Math.max(2, Math.min(4, Math.round(c.chars / 3500)));

export function extractInstructions(replyLanguage: string): string {
  return `You read one part of a long web page and note its key points, so that an overview of the whole page can be written from the notes alone.
Reply with ONLY a JSON object, no prose: {"parts": [{"part": number, "points": [{"anchor": "p12", "text": string}], "quote": {"anchor": "p15", "text": string} or null}]}
- One entry per part you are given, with its number. Each point is one concrete fact, claim, step, number or conclusion from that part, under ${NOTE_MAX} characters, written in ${replyLanguage}.
- "anchor" is the id of the block the point comes from (the [pN] at the block's start). Only ids inside that part.
- Spread the points over the whole part, from its beginning to its end, in page order; do not skip its second half.
- "quote": optional, one striking sentence copied word for word from one block of the part (original language, under 200 characters), or null.
- Skip navigation, references, footnotes, licences and boilerplate unless the part is only that; then give 1-2 points saying what it lists.`;
}

export function extractInput(title: string, batch: Chunk[], total: number): string {
  const want = batch.map((c) => `part ${c.index + 1} (${rangeOf(c)}): ${pointsFor(c)} points`).join('; ');
  return `Page: ${title}\nThis is ${batch.length > 1 ? `parts ${batch[0]!.index + 1}-${batch.at(-1)!.index + 1}` : `part ${batch[0]!.index + 1}`} of ${total}. Notes wanted: ${want}.\n\n${batch.map((c) => `<part ${c.index + 1}>\n${c.text}\n</part ${c.index + 1}>`).join('\n\n')}`;
}

function parseJson(reply: string): any {
  const s = reply.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object');
  return JSON.parse(s.slice(a, b + 1));
}

const clean = (t: unknown) => (typeof t === 'string' ? t.replace(MARKER_RE, '').replace(/\s+/g, ' ').trim() : '');

/**
 * Check an extraction reply against its batch. Returns the notes it holds (invalid points dropped) and the problems
 * to send back; `errors` is empty when every chunk has enough valid points.
 */
export function checkNotes(reply: string, batch: Chunk[]): { notes: ChunkNote[]; errors: string[] } {
  let data: any;
  try { data = parseJson(reply); } catch (e) { return { notes: [], errors: [`The reply is not a valid JSON object (${(e as Error).message}). Reply with only the JSON object.`] }; }
  const entries: any[] = Array.isArray(data?.parts) ? data.parts : Array.isArray(data?.points) ? [{ part: batch[0]!.index + 1, points: data.points, quote: data.quote }] : [];
  const errors: string[] = [];
  const notes = batch.map((c) => {
    const e = entries.find((x) => Number(x?.part) === c.index + 1) ?? (batch.length === 1 ? entries[0] : undefined);
    const ids = new Set(c.ids);
    const bad: string[] = [];
    const points: NotePoint[] = [];
    for (const p of Array.isArray(e?.points) ? e.points : []) {
      const anchor = String(p?.anchor ?? '').replace(/^\[|\]$/g, '').trim(), text = clean(p?.text).slice(0, NOTE_MAX);
      if (!text) continue;
      if (!ids.has(anchor)) { bad.push(anchor || '(empty)'); continue; }
      points.push({ anchor, text });
    }
    points.sort((a, b) => +a.anchor.slice(1) - +b.anchor.slice(1));
    const q = e?.quote, qa = String(q?.anchor ?? '').trim(), qt = clean(q?.text);
    const quote = qt && qt.length <= QUOTE_MAX && ids.has(qa) ? { anchor: qa, text: qt } : undefined;
    const need = Math.min(2, c.ids.length);
    if (!e) errors.push(`Part ${c.index + 1} is missing: add {"part": ${c.index + 1}, "points": [...]}.`);
    else if (bad.length) errors.push(`Part ${c.index + 1}: anchors ${[...new Set(bad)].slice(0, 6).join(', ')} are not block ids of that part (it has ${rangeOf(c)}).`);
    if (e && points.length < need) errors.push(`Part ${c.index + 1} needs at least ${need} points with valid anchors (${rangeOf(c)}); it has ${points.length}.`);
    else if (e && points.length >= 3) {
      // the second half of a chunk left out entirely
      const mid = c.ids[Math.floor(c.ids.length / 2)]!;
      if (!points.some((p) => +p.anchor.slice(1) >= +mid.slice(1))) errors.push(`Part ${c.index + 1}: every point is from its first half; add points from ${mid}-${c.ids.at(-1)}.`);
    }
    return { chunk: c.index, range: rangeOf(c), points, quote };
  });
  return { notes, errors };
}

/** Notes for a chunk the model could not read: the start of its longest blocks, marked as a fallback. */
export function fallbackNotes(c: Chunk): ChunkNote {
  const blocks = blockTexts(c.text);
  const top = [...blocks].map(([id, t]) => ({ id, t: clean(t) })).filter((b) => b.t.length > 20).sort((a, b) => b.t.length - a.t.length).slice(0, pointsFor(c))
    .sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
  return { chunk: c.index, range: rangeOf(c), points: top.map((b) => ({ anchor: b.id, text: b.t.slice(0, 160) + (b.t.length > 160 ? '…' : '') })), fallback: true };
}

export interface ExtractDeps {
  /** one model call, reasoning off: `history` holds the earlier tries of this batch (for repairs) */
  extract(instructions: string, history: ChatMessage[], input: string, signal: AbortSignal): Promise<string>;
}

/** Extract one batch, repairing from the check's feedback up to REPAIRS times; keeps the best notes seen. */
export async function extractBatch(instructions: string, title: string, batch: Chunk[], total: number, deps: ExtractDeps, signal: AbortSignal): Promise<ChunkNote[]> {
  const history: ChatMessage[] = [];
  let input = extractInput(title, batch, total);
  let best: ChunkNote[] = [];
  const score = (ns: ChunkNote[]) => ns.reduce((n, x) => n + x.points.length, 0);
  for (let attempt = 0; attempt <= REPAIRS; attempt++) {
    let reply: string;
    try { reply = await deps.extract(instructions, history, input, signal); } catch (e) {
      if (signal.aborted) throw new AbortError();
      break;
    }
    const { notes, errors } = checkNotes(reply, batch);
    if (score(notes) > score(best)) best = notes;
    if (!errors.length) break;
    history.push({ role: 'user', content: input }, { role: 'assistant', content: reply });
    input = `Your reply has problems:\n- ${errors.join('\n- ')}\nReply again with the complete corrected JSON object for all ${batch.length > 1 ? 'parts' : 'of the part'}.`;
  }
  return batch.map((c) => { const n = best.find((x) => x.chunk === c.index); return n && n.points.length ? n : fallbackNotes(c); });
}

/** Run `jobs` with at most `limit` at once, in order of start; results in job order. */
export async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i]!(); }
  }));
  return out;
}

/** Read every chunk: notes in page order. `onProgress(read, total)` counts chunks, from 0/total. */
export async function extractNotes(o: { title: string; content: string; replyLanguage: string; signal?: AbortSignal; onProgress?(read: number, total: number): void; concurrency?: number; maxCalls?: number },
  deps: ExtractDeps): Promise<{ chunks: Chunk[]; notes: ChunkNote[] }> {
  const chunks = chunkContent(o.content);
  const batches = batchChunks(chunks, o.maxCalls ?? MAX_EXTRACT_CALLS);
  const ac = new AbortController();
  const stop = () => ac.abort();
  if (o.signal?.aborted) throw new AbortError();
  o.signal?.addEventListener('abort', stop);
  const instructions = extractInstructions(o.replyLanguage);
  let read = 0;
  o.onProgress?.(0, chunks.length);
  try {
    const results = await pool(batches.map((b) => async () => {
      const notes = await extractBatch(instructions, o.title, b, chunks.length, deps, ac.signal);
      read += b.length;
      o.onProgress?.(read, chunks.length);
      return notes;
    }), o.concurrency ?? EXTRACT_CONCURRENCY);
    return { chunks, notes: results.flat() };
  } finally { o.signal?.removeEventListener('abort', stop); }
}

/** Consecutive parts per section, so that one bullet per part (or per few parts) fits the summary's limits. */
export function sectionPlan(total: number): { span: number; groups: [number, number][] } {
  const span = Math.max(1, Math.ceil(total / 48)); // parts per bullet: 8 sections x 6 bullets
  const sections = Math.min(8, Math.max(Math.min(4, total), Math.ceil(total / span / 5)));
  const groups: [number, number][] = [];
  for (let k = 0; k < sections; k++) {
    const a = Math.round((k * total) / sections), b = Math.round(((k + 1) * total) / sections) - 1;
    if (b >= a) groups.push([a, b]);
  }
  return { span, groups };
}

/** The aggregation agent's first message: the notes of every part (grouped into the planned sections), not the page. */
/** A part's lead note: the one whose block is nearest the middle of the part (in characters), so the bullet built on it points well inside the part. */
export function leadOf(n: ChunkNote, chunk?: Chunk): NotePoint {
  if (!chunk) return n.points[Math.floor((n.points.length - 1) / 2)]!;
  const mid = (chunk.offsets[0]! + chunk.offsets.at(-1)!) / 2;
  const at = (p: NotePoint) => { const i = chunk.ids.indexOf(p.anchor); return i < 0 ? Infinity : Math.abs(chunk.offsets[i]! - mid); };
  return n.points.reduce((a, b) => (at(b) < at(a) ? b : a), n.points[0]!);
}

export function notesInput(title: string, url: string, content: string, notes: ChunkNote[], chunks?: Chunk[]): string {
  const total = notes.length;
  const { span, groups } = sectionPlan(total);
  const lead = (n: ChunkNote) => leadOf(n, chunks?.[n.chunk]);
  const part = (n: ChunkNote) => {
    const l = n.points.length ? lead(n) : null;
    return `<part ${n.chunk + 1}: ${n.range}${n.fallback ? ' (not read: block openings only)' : ''}>\n${l ? `★ ${l.anchor}: ${l.text}\n` : ''}${n.points.filter((p) => p !== l).map((p) => `- ${p.anchor}: ${p.text}`).join('\n')}${n.quote ? `\nquote candidate (${n.quote.anchor}, verbatim): ${n.quote.text}` : ''}`;
  };
  const body = groups.map(([a, b], k) => `=== Section ${k + 1}: parts ${a + 1}-${b + 1}; bullet anchors: ${notes.slice(a, b + 1).filter((n, i) => i % span === 0 && n.points.length).map((n) => lead(n).anchor).join(', ')} ===\n${notes.slice(a, b + 1).map(part).join('\n')}`).join('\n\n');
  return `Title: ${title}\nURL: ${url}\n\nThe page is ${content.length} characters, too long to include. It was read in ${total} parts of about ${CHUNK_CHARS} characters; below are the notes of every part, with the page's block ids, already grouped into ${groups.length} sections in page order.
Write the overview from these notes, covering the whole page:
- Write exactly these ${groups.length} sections, in this order (give each a title from its content; its anchor is the ★ id of its first part).
- A section's bullets are the ★ lead notes of its parts${span > 1 ? ` (one bullet per ${span} consecutive parts: the ★ of the first of them)` : ', one bullet per part'}, in order, each with its ★ anchor. Rewrite a lead into a clear point and add details from the other notes of the same part; do not move a part's content into another bullet. The number of bullets in a section equals its number of ${span > 1 ? 'part groups' : 'parts'}.
- Anchors are the block ids in the notes. A quote, if any, must be one of the verbatim quote candidates with its id.

${body}`;
}
