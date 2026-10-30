import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoadingState from '../components/bui/LoadingState';
import { ThoughtLine } from '../components/ThoughtLine';
import { createCache } from '../lib/cache';
import type { SummaryEvent, SummaryRequest } from '../lib/messages';
import { buildMockSummary, mockSummaryStream } from '../lib/mock';
import { memKV } from '../lib/storage';
import { createSummarizeRunner } from '../lib/summarize-run';
import { serveSummaryPort } from '../lib/summarize-stream';
import { clipLine, createThoughtTicker, sentences, THOUGHT_COLS } from '../lib/thinking';
import type { Summary } from '../lib/types';

describe('sentences', () => {
  it('splits Chinese on full-width marks, keeping closing quotes', () => {
    expect(sentences('先通读全文。再看例子！要不要分节？然后')).toEqual(['先通读全文。', '再看例子！', '要不要分节？']);
    expect(sentences('他说「好。」接着')).toEqual(['他说「好。」']);
  });
  it('splits English only at . ! ? followed by whitespace, so numbers and URLs stay whole', () => {
    expect(sentences('Version 3.5 is out. See x.com now! Then')).toEqual(['Version 3.5 is out.', 'See x.com now!']);
    expect(sentences('The user wants a summary.')).toEqual([]); // not finished until the next whitespace
  });
  it('treats newlines as ends and skips empty or punctuation-only pieces', () => {
    expect(sentences('**Plan**\n\n- read it\n...\n2. Then [[terms]] here.\n')).toEqual(['Plan', 'read it', 'Then terms here.']);
    expect(sentences('1.\n2. ')).toEqual([]); // a bare list number is not a line
  });
});

describe('clipLine', () => {
  it('leaves short lines alone and cuts long ones with an ellipsis within the column budget', () => {
    expect(clipLine('Short line.')).toBe('Short line.');
    const en = clipLine('First, read the whole article and find the core idea the author wants to make.');
    expect(en.endsWith('…')).toBe(true); expect(en.length).toBeLessThanOrEqual(THOUGHT_COLS);
    const zh = clipLine('先通读全文，找出作者最想说明的核心观点，再看看例子是怎么解释机制的。');
    expect(zh.endsWith('…')).toBe(true); expect([...zh].length).toBeLessThanOrEqual(THOUGHT_COLS / 2 + 1);
    expect(clipLine('一二三四五六七八九十，一二三四五六七八九十')).not.toMatch(/，…$/);
  });
});

describe('createThoughtTicker', () => {
  afterEach(() => vi.useRealTimers());
  it('shows each finished sentence, at least minMs apart, skipping to the newest when behind', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const t = createThoughtTicker((l) => lines.push(l), 1200);
    t.push('Read the page');
    expect(lines).toEqual([]); // nothing finished yet: the plain status stays
    t.push('.');
    expect(lines).toEqual([]); // "." needs the following whitespace
    t.push(' Find');
    expect(lines).toEqual(['Read the page.']); // the first line shows at once
    t.push(' examples. Group advice. Check anchors. ');
    expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(1199); expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(lines).toEqual(['Read the page.', 'Check anchors.']); // caught up to the newest
  });
  it('stop() drops a pending line', () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const t = createThoughtTicker((l) => lines.push(l), 1200);
    t.push('第一句话。'); t.push('第二句话。'); t.stop(); vi.advanceTimersByTime(5000);
    expect(lines).toEqual(['第一句话。']);
  });
});

describe('reasoning over the summary port', () => {
  it('is forwarded as its own event and never reaches the summary or the cache', async () => {
    const cache = createCache(memKV()); const events: SummaryEvent[] = [];
    let onMsg!: (r: SummaryRequest) => void;
    const content = '[p1] some text that is long enough to be a block of the page for the mock.';
    serveSummaryPort({ postMessage: (e) => events.push(e), onMessage: { addListener: (f) => { onMsg = f; } }, onDisconnect: { addListener: () => {} } }, {
      cache, runner: createSummarizeRunner(cache),
      summarize: (_r, signal, onDelta, onThinking) => mockSummaryStream('T', 'en', signal, content, onDelta, 0, onThinking),
    });
    onMsg({ url: 'https://x.test/r', title: 'T', content, force: true });
    for (let i = 0; i < 400 && !events.some((e) => 'done' in e); i++) await new Promise((r) => setTimeout(r, 5));
    const thinking = events.filter((e): e is { thinking: string } => 'thinking' in e).map((e) => e.thinking).join('');
    expect(thinking).toMatch(/^First, read/);
    const firstDelta = events.findIndex((e) => 'delta' in e), lastThought = events.map((e) => 'thinking' in e).lastIndexOf(true);
    expect(lastThought).toBeLessThan(firstDelta); // reasoning comes before the answer
    const done = events.find((e) => 'done' in e) as { summary: Summary };
    expect(done.summary).toEqual(buildMockSummary('T', 'en', content));
    expect(JSON.stringify(await cache.getSummary('https://x.test/r'))).not.toContain('First, read');
  });
});

describe('status row', () => {
  it('shows the reasoning line (single line, truncating) with the timer kept', () => {
    const html = renderToStaticMarkup(<LoadingState label={<ThoughtLine line="Find the core idea." />} />);
    expect(html).toContain('data-thought');
    expect(html).toContain('truncate');
    expect(html).toContain('Find the core idea.');
    expect(html).toMatch(/0\.0s/);
  });
  it('falls back to the plain status text', () => {
    const html = renderToStaticMarkup(<LoadingState label="正在总结" />);
    expect(html).toContain('正在总结'); expect(html).not.toContain('data-thought');
  });
});

describe('status timer', () => {
  it('counts from the run start, so it keeps going when the status row is re-mounted', () => {
    const html = renderToStaticMarkup(<LoadingState label="x" since={Date.now() - 4200} />);
    expect(html).toMatch(/4\.[12]s/);
  });
});
