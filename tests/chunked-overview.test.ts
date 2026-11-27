import { describe, expect, it } from 'vitest';
import { batchChunks, checkNotes, chunkContent, extractNotes, fallbackNotes, isAppendixChunk, leadOf, MAX_PLAN_SECTIONS, notesInput, pool, pointsFor, sectionPlan, trailingAppendixIndices, type ChunkNote } from '../lib/chunked-overview';
import { MAX_SECTIONS } from '../lib/overview-agent';
import { overviewAgentInstructions } from '../lib/prompts';
import { createCache, pageHash } from '../lib/cache';
import { memKV } from '../lib/storage';

const page = (n: number, len = 1000) => Array.from({ length: n }, (_, i) => `[p${i + 1}] ${`block ${i + 1} text. `.repeat(Math.ceil(len / 16)).slice(0, len)}`).join('\n\n');
const reply = (batch: { index: number; ids: string[] }[]) => JSON.stringify({ parts: batch.map((c) => ({ part: c.index + 1, points: [c.ids[0], c.ids.at(-1)].map((a) => ({ anchor: a, text: `note ${a}` })) })) });

describe('chunkContent', () => {
  it('cuts on block boundaries near every 12k characters and keeps every block once', () => {
    const content = page(60);
    const chunks = chunkContent(content);
    expect(chunks.length).toBe(Math.ceil(content.length / 12000));
    expect(chunks.flatMap((c) => c.ids)).toEqual(Array.from({ length: 60 }, (_, i) => `p${i + 1}`));
    chunks.slice(1).forEach((c, k) => expect(Math.abs(c.offsets[0]! - (k + 1) * 12000)).toBeLessThan(1100));
    expect(chunks[0]!.text.startsWith('[p1]')).toBe(true);
  });
  it('a short page is one chunk', () => expect(chunkContent(page(3))).toHaveLength(1));
  it('batches at most maxCalls consecutive groups', () => {
    const b = batchChunks(chunkContent(page(300)), 12);
    expect(b.length).toBeLessThanOrEqual(12);
    expect(b.flat().map((c) => c.index)).toEqual(b.flat().map((_, i) => i));
  });
});

describe('checkNotes', () => {
  const [c] = chunkContent(page(10));
  it('accepts valid anchors', () => expect(checkNotes(reply([c!]), [c!]).errors).toEqual([]));
  it('reports anchors outside the part and bad JSON', () => {
    const r = checkNotes(JSON.stringify({ parts: [{ part: 1, points: [{ anchor: 'p99', text: 'x' }, { anchor: 'p2', text: 'y' }] }] }), [c!]);
    expect(r.errors.join()).toMatch(/p99/);
    expect(r.notes[0]!.points.map((p) => p.anchor)).toEqual(['p2']);
    expect(checkNotes('nope', [c!]).errors[0]).toMatch(/JSON/);
  });
  it('fallback notes use the part\'s own blocks', () => {
    const f = fallbackNotes(c!);
    expect(f.fallback).toBe(true);
    f.points.forEach((p) => expect(c!.ids).toContain(p.anchor));
  });
});

describe('extractNotes', () => {
  it('runs batches in parallel within the limit, reports progress, repairs from feedback', async () => {
    let live = 0, peak = 0;
    const progress: [number, number][] = [];
    const seen = new Map<string, number>();
    const all = chunkContent(page(120));
    const { chunks, notes } = await extractNotes({ title: 't', content: page(120), replyLanguage: 'en', concurrency: 3, onProgress: (r, t) => progress.push([r, t]) }, {
      async extract(_i, history, input) {
        live++; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        const parts = [...String(history[0]?.content ?? input).matchAll(/<part (\d+)>/g)].map((m) => +m[1]! - 1);
        const key = parts.join(',');
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (!history.length && parts[0] === 0) return '{"parts":[{"part":1,"points":[{"anchor":"p9999","text":"bad"}]}]}';
        return reply(parts.map((i) => all[i]!));
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(progress[0]).toEqual([0, chunks.length]);
    expect(progress.at(-1)).toEqual([chunks.length, chunks.length]);
    expect(notes).toHaveLength(chunks.length);
    expect(notes.every((n) => !n.fallback && n.points.every((p) => chunks[n.chunk]!.ids.includes(p.anchor)))).toBe(true);
    expect([...seen.entries()].find(([k]) => k.startsWith('0'))![1]).toBe(2);
  });
  it('falls back when a call keeps failing', async () => {
    const { notes } = await extractNotes({ title: 't', content: page(30), replyLanguage: 'en' }, { extract: async () => { throw new Error('boom'); } });
    expect(notes.every((n) => n.fallback)).toBe(true);
  });
});

describe('pool', () => it('keeps job order', async () => {
  expect(await pool([3, 1, 2].map((d, i) => () => new Promise<number>((r) => setTimeout(() => r(i), d))), 2)).toEqual([0, 1, 2]);
}));

describe('aggregation input', () => {
  it('plans one section per part up to the cap, covering every part when none are appendix', () => {
    expect(MAX_PLAN_SECTIONS).toBeLessThanOrEqual(MAX_SECTIONS);
    expect(sectionPlan(6).groups).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    for (const n of [1, 5, 14, 38, 67]) {
      const { groups, appendix } = sectionPlan(n);
      expect(appendix).toEqual([]);
      expect(groups.length).toBe(Math.min(MAX_PLAN_SECTIONS, n));
      expect(groups[0]![0]).toBe(0);
      expect(groups.at(-1)![1]).toBe(n - 1);
    }
    const chunks = chunkContent(page(60));
    const notes: ChunkNote[] = chunks.map((c) => ({ chunk: c.index, range: '', points: c.ids.map((a) => ({ anchor: a, text: a })) }));
    const lead = leadOf(notes[1]!, chunks[1]);
    const i = chunks[1]!.ids.indexOf(lead.anchor);
    expect(Math.abs(i - chunks[1]!.ids.length / 2)).toBeLessThanOrEqual(1);
    const text = notesInput('T', 'u', 'x'.repeat(99), notes, chunks);
    expect(text).toContain(`★ ${lead.anchor}`);
    expect(text).not.toContain('[p1] block');
    expect((text.match(/=== Section/g) ?? []).length).toBe(sectionPlan(chunks.length, { chunks }).groups.length);
  });

  it('does not pinch a 6-part page into 4 sections or one bullet per part, and keeps trailing references out of the plan', () => {
    const topics = Array.from({ length: 5 }, (_, c) =>
      `[p${c + 1}] ## Topic ${c + 1}: Eval family ${c + 1}\n\n` + `NamedEval${c + 1} found that graders failed on ${c + 3} tasks. `.repeat(280));
    const refs = [
      '[p6] Did I miss your favourite benchmark? Please reach out!',
      '## [p7] References',
      ...Array.from({ length: 8 }, (_, i) => `[p${8 + i}] Author. “Paper ${i}.” arXiv:2500.1000${i}. Preprint, arXiv, 2026. https://doi.org/10.48550/arXiv.2500.1000${i}. Accessed November 19, 2026.`),
    ].join('\n\n');
    const content = [...topics, refs].join('\n\n');
    const chunks = chunkContent(content);
    expect(chunks.length).toBe(6);
    expect(isAppendixChunk(chunks[5]!)).toBe(true);
    expect(chunks.slice(0, 5).every((c) => !isAppendixChunk(c))).toBe(true);
    expect(trailingAppendixIndices(chunks)).toEqual([5]);
    const { groups, appendix } = sectionPlan(chunks.length, { chunks });
    expect(appendix).toEqual([5]);
    expect(groups.length).toBe(5);
    expect(groups).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    const notes: ChunkNote[] = chunks.map((c) => ({
      chunk: c.index, range: `${c.ids[0]}-${c.ids.at(-1)}`,
      points: c.ids.slice(0, 3).map((a) => ({ anchor: a, text: `note ${a}` })),
    }));
    const text = notesInput('Lessons from 12 Evals', 'https://example.com/evals', content, notes, chunks);
    expect(text).not.toMatch(/Write exactly these \d+ sections/);
    expect(text).not.toMatch(/, one bullet per part/);
    expect(text).not.toMatch(/bullets are the ★ lead notes/);
    expect(text).not.toMatch(/The number of bullets in a section equals/);
    expect(text).toMatch(/Write these 5 sections/);
    expect(text).toMatch(/2-6 bullets per section/);
    expect(text).toMatch(/rather than one bullet per part/);
    expect(text).toMatch(/not a section/);
    expect((text.match(/=== Section/g) ?? []).length).toBe(5);
    expect(text).toContain('References and closing (parts 6-6; not a section');
    expect(pointsFor(chunks[0]!)).toBeGreaterThan(4);
  });
});

describe('overview length instructions', () => {
  it('keeps a compact shape for short pages and relaxes it only for long ones', () => {
    const short = overviewAgentInstructions('zh-CN');
    expect(short).toMatch(/3-5 sentences/);
    expect(short).toMatch(/3-6 sections/);
    expect(short).toMatch(/2-5 concise/);
    expect(short).not.toMatch(/more than 6 is allowed/);
    const long = overviewAgentInstructions('zh-CN', undefined, { long: true });
    expect(long).toMatch(/3-8 sentences/);
    expect(long).toMatch(/more than 6 is allowed/);
    expect(long).toMatch(/2-6/);
    expect(long).not.toMatch(/3-6 sections in page order/);
  });
});

describe('cache key', () => it('misses when the page text changed', async () => {
  const c = createCache(memKV());
  await c.setSummary('u', { summary: { overview: 'x', keyTerms: [], sections: [] }, content: 'old', title: 't' });
  expect(await c.getSummary('u', pageHash('old'))).not.toBeNull();
  expect(await c.getSummary('u', pageHash('new'))).toBeNull();
  expect(pageHash('a')).not.toBe(pageHash('b'));
}));
