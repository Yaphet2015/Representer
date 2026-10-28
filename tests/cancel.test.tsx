import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorView, NoOverview } from '../components/EmptyStates';
import { LangProvider } from '../components/i18n';
import { createCache } from '../lib/cache';
import { messages } from '../lib/i18n';
import { appendMessages, initialState, MAIN_ID } from '../lib/sessions';
import { memKV } from '../lib/storage';
import { chatContext, createSummarizeRunner } from '../lib/summarize-run';
import type { Summary } from '../lib/types';

const summary = (t: string): Summary => ({ overview: t, sections: [] });
const req = { url: 'https://x.test/a', title: 'T', content: '[p1] hello world' };
const never = () => new Promise<Summary>(() => {});

describe('cancelling the summary', () => {
  it('aborts the request, writes nothing to the cache and reports a cancel, not an error', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    let seen: AbortSignal | undefined;
    const p = runner.run(req, (signal) => { seen = signal; return never(); });
    await new Promise((r) => setTimeout(r, 10));
    runner.cancel(req.url);
    expect(await p).toEqual({ cancelled: true });
    expect(seen!.aborted).toBe(true);
    expect(await cache.getSummary(req.url)).toBeNull();
  });
  it('a provider that finishes after the cancel still leaves no cache entry', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    let finish!: (s: Summary) => void;
    const p = runner.run(req, () => new Promise<Summary>((r) => { finish = r; }));
    runner.cancel(req.url); finish(summary('late'));
    expect(await p).toEqual({ cancelled: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(await cache.getSummary(req.url)).toBeNull();
  });
  it('a provider that rejects with an AbortError is a cancel as well; other errors still surface', async () => {
    const runner = createSummarizeRunner(createCache(memKV()));
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(await runner.run(req, () => Promise.reject(abort))).toEqual({ cancelled: true });
    await expect(runner.run(req, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
  it('cancelling with nothing running is harmless, and the page can be summarized afterwards', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    runner.cancel(req.url);
    const r = await runner.run(req, async () => summary('ok'));
    expect('summary' in r && r.summary.overview).toBe('ok');
    expect((await cache.getSummary(req.url))?.summary.overview).toBe('ok');
  });
  it('a newer run for the same page cancels the older one', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    const first = runner.run(req, never);
    const second = runner.run(req, async () => summary('second'));
    expect(await first).toEqual({ cancelled: true });
    expect('summary' in (await second)).toBe(true);
  });
});

describe('chats without a summary', () => {
  it('first summary keeps the chats held without one; replacing a summary starts them over', async () => {
    const cache = createCache(memKV()); const runner = createSummarizeRunner(cache);
    await cache.updateSessions(req.url, (s) => appendMessages(s, MAIN_ID, [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]));
    await runner.run(req, async () => summary('one'));
    expect((await cache.getSessions(req.url)).sessions[0]!.messages).toHaveLength(2);
    await runner.run(req, async () => summary('two'));
    expect((await cache.getSessions(req.url)).sessions[0]!.messages).toHaveLength(0);
    expect(initialState().sessions[0]!.messages).toHaveLength(0);
  });
  it('chat context is the cached summary when there is one, the page sent along when not, and nothing otherwise', async () => {
    const cache = createCache(memKV());
    const page = { title: 'P', content: '[p1] page text' };
    expect(await chatContext(cache, req.url)).toBeNull();
    expect(await chatContext(cache, req.url, { title: 'P', content: '' })).toBeNull();
    expect(await chatContext(cache, req.url, page)).toEqual({ title: 'P', summary: null, content: '[p1] page text' });
    await createSummarizeRunner(cache).run(req, async () => summary('cached'));
    const c = await chatContext(cache, req.url, page);
    expect(c?.summary?.overview).toBe('cached'); expect(c?.content).toBe(req.content); // summary mode wins
  });
});

describe('the empty states', () => {
  const html = (node: any) => renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
  it('NoOverview offers starting the summary and going straight to the chat, in both languages', () => {
    for (const lang of ['zh-CN', 'en'] as const) {
      const m = messages(lang);
      expect(m.startSummary).toBeTruthy(); expect(m.chatNow).toBeTruthy(); expect(m.cancelSummary).toBeTruthy();
      expect(m.noSummaryChat).toBeTruthy(); expect(m.summaryCancelled).toBeTruthy();
    }
    const h = html(<NoOverview onStart={() => {}} onChat={() => {}} />);
    expect(h).toContain('data-no-overview'); expect(h).toContain(messages('en').startSummary); expect(h).toContain(messages('en').chatNow);
  });
  it('a failed summary can also go to the chat', () => {
    const h = html(<ErrorView error="boom" retry={() => {}} onChat={() => {}} />);
    expect(h).toContain('boom'); expect(h).toContain(messages('en').retry); expect(h).toContain(messages('en').chatNow);
  });
});
