/** Running, cancelling and caching the page summary, kept apart from chrome APIs so it can be tested. */
import { isAbort, raceAbort } from './abort';
import type { createCache } from './cache';
import { usedAnchors, type Anchors } from './locate';
import type { Summary } from './types';

type Cache = ReturnType<typeof createCache>;
export type SummarizeResult = { summary: Summary; anchors?: Anchors } | { cancelled: true };

export function createSummarizeRunner(cache: Cache) {
  /** running summarize calls by page, so they can be cancelled */
  const inflight = new Map<string, AbortController>();
  return {
    cancel(url: string) { inflight.get(url)?.abort(); },
    async run(
      req: { url: string; title: string; content: string; anchors?: Anchors },
      generate: (signal: AbortSignal) => Promise<Summary>,
      /** aborts this run only (e.g. its stream's port closed), never a newer run of the same page */
      outer?: AbortSignal,
    ): Promise<SummarizeResult> {
      const { url, title, content } = req;
      inflight.get(url)?.abort(); // a newer run for the same page replaces the old one
      const ac = new AbortController();
      inflight.set(url, ac);
      const stop = () => ac.abort();
      if (outer?.aborted) ac.abort(); else outer?.addEventListener('abort', stop, { once: true });
      try {
        const summary = await raceAbort(generate(ac.signal), ac.signal);
        if (ac.signal.aborted) return { cancelled: true }; // never cache a cancelled run
        const anchors = usedAnchors(summary, req.anchors); // keep only the fingerprints the summary points at
        // Replacing a summary starts the chats over; the first summary of a page keeps the chats held without one.
        if (await cache.getSummary(url)) await cache.clearSummary(url);
        await cache.setSummary(url, { summary, content, title, anchors });
        return { summary, anchors };
      } catch (e) {
        if (ac.signal.aborted || isAbort(e)) return { cancelled: true };
        throw e;
      } finally {
        outer?.removeEventListener('abort', stop);
        if (inflight.get(url) === ac) inflight.delete(url);
      }
    },
  };
}

/** What a chat turn works from: the cached summary, else (no summary) the page text the tab sent along. */
export async function chatContext(cache: Cache, url: string, page?: { title: string; content: string }): Promise<{ title: string; summary: Summary | null; content: string } | null> {
  const c = await cache.getSummary(url);
  if (c) return { title: c.title, summary: c.summary, content: c.content };
  return page?.content ? { title: page.title, summary: null, content: page.content } : null;
}
