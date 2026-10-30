/** The background side of SUMMARY_PORT, kept apart from chrome APIs so it can be tested with a fake port. */
import type { createCache } from './cache';
import type { SummaryEvent, SummaryRequest } from './messages';
import type { createSummarizeRunner } from './summarize-run';
import type { Summary } from './types';

export interface PortLike {
  postMessage(e: SummaryEvent): void;
  onMessage: { addListener(f: (req: SummaryRequest) => void): void };
  onDisconnect: { addListener(f: () => void): void };
}

export function serveSummaryPort(
  port: PortLike,
  deps: {
    cache: ReturnType<typeof createCache>;
    runner: ReturnType<typeof createSummarizeRunner>;
    summarize: (req: SummaryRequest, signal: AbortSignal, onDelta: (t: string) => void, onThinking: (t: string) => void) => Promise<Summary>;
  },
) {
  const ac = new AbortController();
  let closed = false;
  port.onDisconnect.addListener(() => { closed = true; ac.abort(); }); // panel closed / page left: stop the model
  const post = (e: SummaryEvent) => { if (closed) return; try { port.postMessage(e); } catch { /* port closed */ } };
  port.onMessage.addListener(async (req) => {
    try {
      if (!req.force) { const c = await deps.cache.getSummary(req.url); if (c) return post({ done: true, summary: c.summary, anchors: c.anchors }); }
      const r = await deps.runner.run(req, (signal) => deps.summarize(req, signal, (delta) => { if (delta && !signal.aborted) post({ delta }); },
        (thinking) => { if (thinking && !signal.aborted) post({ thinking }); }), ac.signal);
      post('cancelled' in r ? { cancelled: true } : { done: true, summary: r.summary, anchors: r.anchors });
    } catch (e: any) {
      post({ error: String(e?.message ?? e) }); // also mid-stream: the panel drops the partial overview and shows the error
    }
  });
}
