import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../components/Overview';
import { LangProvider } from '../components/i18n';
import { createCache } from '../lib/cache';
import type { SummaryEvent, SummaryRequest } from '../lib/messages';
import { buildMockSummary, mockSummaryJson, mockSummaryStream } from '../lib/mock';
import { parseSummary } from '../lib/parse';
import { createPartialReader, parsePartialJson, partialSummary, tidyPartialMarks } from '../lib/partial-json';
import { memKV } from '../lib/storage';
import { createSummarizeRunner } from '../lib/summarize-run';
import { serveSummaryPort } from '../lib/summarize-stream';
import { streamSummary } from '../lib/summary-client';
import type { Summary } from '../lib/types';

const CONTENT = '# T [p1]\n\nFirst paragraph about the topic, long enough for a mock anchor here. [p2]\n\nSecond paragraph with more detail, also comfortably long for anchoring. [p3]';
const MODEL_JSON = '```json\n' + JSON.stringify({
  overview: 'The page explains ==streaming== with [[SSE]] "quotes" and a \\ backslash.',
  sections: [
    { title: 'Why', anchor: 'p2', icon: 'target', bullets: [{ text: 'Faster ==first token==', anchor: 'p2' }, { text: 'Less waiting', anchor: 'p3' }] },
    { title: 'How', anchor: 'p3', icon: 'lightbulb', bullets: [{ text: 'Parse the [[partial JSON]]', anchor: 'p3' }] },
  ],
  quote: null,
}, null, 1) + '\n```';

describe('parsePartialJson', () => {
  it('reads every prefix without throwing, and the full text exactly', () => {
    for (let i = 0; i <= MODEL_JSON.length; i++) expect(() => parsePartialJson(MODEL_JSON.slice(0, i))).not.toThrow();
    expect(parsePartialJson(MODEL_JSON)).toEqual(JSON.parse(MODEL_JSON.slice(8, -4)));
  });
  it('closes open strings, arrays and objects', () => {
    expect(parsePartialJson('{"overview": "Hel')).toEqual({ overview: 'Hel' });
    expect(parsePartialJson('{"a": [1, 2')).toEqual({ a: [1, 2] });
    expect(parsePartialJson('{"s": [{"title": "X", "bul')).toEqual({ s: [{ title: 'X' }] });
  });
  it('drops dangling keys, colons, commas, literals and half escapes', () => {
    expect(parsePartialJson('{"a": "x", "b":')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a": "x",')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a": "x", "q": nu')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a": "x\\')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a": "x\\u00')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a": "x\\u00e9')).toEqual({ a: 'xé' });
    expect(parsePartialJson('{"a": "x\\\\')).toEqual({ a: 'x\\' }); // a complete escaped backslash stays
  });
  it('skips prose and fences around the object; nothing before the first brace', () => {
    expect(parsePartialJson('Sure! ```json\n{"a": 1}\n``` done')).toEqual({ a: 1 });
    expect(parsePartialJson('```js')).toBeUndefined();
  });
});

describe('tidyPartialMarks', () => {
  it('hides marks that are not closed yet', () => {
    expect(tidyPartialMarks('a ==key')).toBe('a key');
    expect(tidyPartialMarks('a ==key== b')).toBe('a ==key== b');
    expect(tidyPartialMarks('see [[ter')).toBe('see ter');
    expect(tidyPartialMarks('see [[term]')).toBe('see term');
    expect(tidyPartialMarks('a =')).toBe('a ');
  });
});

describe('partialSummary', () => {
  it('grows the overview and sections monotonically and ends at the parsed result (minus anchors)', () => {
    let prevLen = 0, prevSections = 0;
    for (let i = 0; i <= MODEL_JSON.length; i++) {
      const p = partialSummary(MODEL_JSON.slice(0, i));
      if (!p) { expect(prevLen + prevSections).toBe(0); continue; }
      expect(p.sections.length).toBeGreaterThanOrEqual(prevSections);
      expect(p.overview.replace(/==|\[\[|\]\]/g, '').length).toBeGreaterThanOrEqual(prevLen);
      prevLen = p.overview.replace(/==|\[\[|\]\]/g, '').length; prevSections = p.sections.length;
      for (const s of p.sections) expect(s.title).toBeTruthy();
    }
    const last = partialSummary(MODEL_JSON)!;
    const final = parseSummary(MODEL_JSON, CONTENT);
    expect(last.overview).toBe(final.overview);
    expect(last.sections.map((s) => [s.title, s.icon, s.bullets])).toEqual(final.sections.map((s) => [s.title, s.icon, s.bullets]));
  });
  it('is independent of how the text was chunked', () => {
    for (const size of [1, 3, 7, 50]) {
      const r = createPartialReader(() => {}, 0);
      for (let i = 0; i < MODEL_JSON.length; i += size) r.push(MODEL_JSON.slice(i, i + size));
      expect(r.text).toBe(MODEL_JSON);
      expect(partialSummary(r.text)).toEqual(partialSummary(MODEL_JSON));
    }
  });
});

describe('createPartialReader', () => {
  afterEach(() => vi.useRealTimers());
  it('throttles reads and picks up the tail with a timer', () => {
    vi.useFakeTimers();
    const seen: Summary[] = [];
    const r = createPartialReader((s) => seen.push(s), 80);
    r.push('{"overview": "A');
    expect(seen.map((s) => s.overview)).toEqual(['A']);
    r.push('B'); r.push('C');
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(80);
    expect(seen.map((s) => s.overview)).toEqual(['A', 'ABC']);
    r.push('"'); vi.advanceTimersByTime(200);
    expect(seen).toHaveLength(2); // same readable summary: no emit
  });
  it('stop() drops the pending read', () => {
    vi.useFakeTimers();
    const seen: Summary[] = [];
    const r = createPartialReader((s) => seen.push(s), 80);
    r.push('{"overview": "A'); r.push('B'); r.stop(); vi.advanceTimersByTime(500);
    expect(seen).toHaveLength(1);
  });
});

describe('mock streaming (dev only)', () => {
  it('streams JSON that parses back to exactly the mock summary', async () => {
    let text = '';
    const s = await mockSummaryStream('T', 'en', undefined, CONTENT, (d) => { text += d; }, 0);
    expect(s).toEqual(buildMockSummary('T', 'en', CONTENT));
    expect(text).toBe(mockSummaryJson(s));
    expect(parseSummary(text, CONTENT)).toEqual(s);
  });
  it('stops when aborted', async () => {
    const ac = new AbortController(); let n = 0;
    const p = mockSummaryStream('T', 'zh-CN', ac.signal, CONTENT, () => { if (++n === 3) ac.abort(); }, 0);
    await expect(p).rejects.toThrow();
    expect(n).toBe(3);
  });
});

/** a fake chrome port pair: the background end and the tab end */
function portPair() {
  const toBg: ((r: SummaryRequest) => void)[] = [], toTab: ((e: SummaryEvent) => void)[] = [];
  const bgGone: (() => void)[] = [], tabGone: (() => void)[] = [];
  let open = true;
  const close = () => { if (!open) return; open = false; bgGone.forEach((f) => f()); tabGone.forEach((f) => f()); };
  const bg = {
    postMessage: (e: SummaryEvent) => { if (!open) throw new Error('closed'); queueMicrotask(() => toTab.forEach((f) => f(e))); },
    onMessage: { addListener: (f: (r: SummaryRequest) => void) => toBg.push(f) },
    onDisconnect: { addListener: (f: () => void) => bgGone.push(f) },
  };
  const tab = {
    postMessage: (r: SummaryRequest) => queueMicrotask(() => toBg.forEach((f) => f(r))),
    disconnect: () => { if (open) { open = false; bgGone.forEach((f) => f()); } }, // chrome: the side that disconnects gets no event
    onMessage: { addListener: (f: (e: SummaryEvent) => void) => toTab.push(f) },
    onDisconnect: { addListener: (f: () => void) => tabGone.push(f) },
  };
  return { bg, tab, close };
}
const REQ: SummaryRequest = { url: 'https://x.test/a', title: 'T', content: CONTENT, force: true };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('summary port', () => {
  it('streams deltas, then the parsed result, which is cached', async () => {
    const cache = createCache(memKV()); const { bg, tab } = portPair();
    serveSummaryPort(bg, { cache, runner: createSummarizeRunner(cache), summarize: async (_r, _s, onDelta) => {
      for (let i = 0; i < MODEL_JSON.length; i += 20) { onDelta(MODEL_JSON.slice(i, i + 20)); await tick(15); }
      return parseSummary(MODEL_JSON, CONTENT);
    } });
    const partials: Summary[] = [];
    const r = await streamSummary(REQ, (p) => partials.push(p), () => tab).done;
    expect(partials.length).toBeGreaterThan(0);
    expect(r).toMatchObject({ done: true, summary: parseSummary(MODEL_JSON, CONTENT) });
    expect((await cache.getSummary(REQ.url))?.summary).toEqual(parseSummary(MODEL_JSON, CONTENT));
  });
  it('falls back for a provider that does not stream: no deltas, just the result', async () => {
    const cache = createCache(memKV()); const { bg, tab } = portPair();
    serveSummaryPort(bg, { cache, runner: createSummarizeRunner(cache), summarize: async () => parseSummary(MODEL_JSON, CONTENT) });
    const partials: Summary[] = [];
    const r = await streamSummary(REQ, (p) => partials.push(p), () => tab).done;
    expect(partials).toHaveLength(0);
    expect('done' in r && r.summary.overview).toBeTruthy();
  });
  it('closing the panel (stop) aborts the model call and caches nothing', async () => {
    const cache = createCache(memKV()); const { bg, tab } = portPair();
    let aborted = false;
    serveSummaryPort(bg, { cache, runner: createSummarizeRunner(cache), summarize: (_r, signal, onDelta) => new Promise((_, rej) => {
      onDelta('{"overview": "Hel');
      signal.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); });
    }) });
    const st = streamSummary(REQ, () => {}, () => tab);
    await tick(5);
    st.stop();
    expect(await st.done).toEqual({ cancelled: true });
    await tick(5);
    expect(aborted).toBe(true);
    expect(await cache.getSummary(REQ.url)).toBeFalsy();
  });
  it('a closed old port never cancels a newer run of the same page', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    const a = portPair(), b = portPair();
    let calls = 0;
    const summarize = (_r: SummaryRequest, signal: AbortSignal) => new Promise<Summary>((res, rej) => {
      const n = ++calls; signal.addEventListener('abort', () => rej(new Error('aborted')));
      if (n === 2) setTimeout(() => res(parseSummary(MODEL_JSON, CONTENT)), 10);
    });
    serveSummaryPort(a.bg, { cache, runner, summarize }); serveSummaryPort(b.bg, { cache, runner, summarize });
    const first = streamSummary(REQ, () => {}, () => a.tab);
    await tick();
    const second = streamSummary(REQ, () => {}, () => b.tab);
    await tick(); first.stop();
    expect(await second.done).toMatchObject({ done: true });
  });
  it('an error mid-stream ends the stream with the error', async () => {
    const cache = createCache(memKV()); const { bg, tab } = portPair();
    serveSummaryPort(bg, { cache, runner: createSummarizeRunner(cache), summarize: async (_r, _s, onDelta) => { onDelta('{"overview": "Half'); await tick(); throw new Error('502 Bad Gateway'); } });
    expect(await streamSummary(REQ, () => {}, () => tab).done).toEqual({ error: '502 Bad Gateway' });
  });
  it('a dropped port (worker restarted) settles as an error instead of hanging', async () => {
    const { tab, close } = portPair();
    const st = streamSummary(REQ, () => {}, () => tab);
    close();
    expect(await st.done).toMatchObject({ error: expect.any(String) });
  });
  it('a cached overview comes back at once without a model call', async () => {
    const cache = createCache(memKV()); const { bg, tab } = portPair();
    const s = parseSummary(MODEL_JSON, CONTENT);
    await cache.setSummary(REQ.url, { summary: s, content: CONTENT, title: 'T' });
    const summarize = vi.fn();
    serveSummaryPort(bg, { cache, runner: createSummarizeRunner(cache), summarize });
    expect(await streamSummary({ ...REQ, force: false }, () => {}, () => tab).done).toMatchObject({ done: true, summary: s });
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe('streaming overview UI', () => {
  it('shows the status and cancel instead of the actions, with a caret at the end', () => {
    const p = partialSummary(MODEL_JSON.slice(0, 260))!;
    const html = renderToStaticMarkup(<LangProvider><Overview streaming summary={p} host="x.test"><button data-cancel>Cancel</button></Overview></LangProvider>);
    expect(html).toContain('data-streaming');
    expect(html).toContain('data-cancel');
    expect(html).toContain('data-caret');
    expect(html).not.toContain('data-regenerate');
  });
});
