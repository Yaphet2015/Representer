/** The tab side of SUMMARY_PORT: one port per run; stop() disconnects it, which cancels the run in the background. */
import { SUMMARY_PORT, type SummaryEvent, type SummaryRequest } from './messages';
import { createPartialReader } from './partial-json';
import type { Summary } from './types';

type Final = Exclude<SummaryEvent, { delta: string } | { thinking: string }>;
interface Port {
  postMessage(m: SummaryRequest): void;
  disconnect(): void;
  onMessage: { addListener(f: (e: SummaryEvent) => void): void };
  onDisconnect: { addListener(f: () => void): void };
}

/**
 * Start a streaming summary. `onPartial` gets the readable overview so far (throttled); `done` settles with the final
 * event. A port that drops without a final event (the worker restarted) settles as an error, never hangs.
 */
export function streamSummary(req: SummaryRequest, onPartial: (s: Summary) => void, connect: () => Port = () => chrome.runtime.connect({ name: SUMMARY_PORT }) as unknown as Port, onThinking?: (t: string) => void) {
  const port = connect();
  const reader = createPartialReader(onPartial);
  let settle!: (e: Final) => void, settled = false;
  const done = new Promise<Final>((res) => { settle = (e) => { if (settled) return; settled = true; reader.stop(); res(e); }; });
  port.onMessage.addListener((e) => {
    if ('delta' in e) { if (!settled) reader.push(e.delta); return; }
    if ('thinking' in e) { if (!settled) onThinking?.(e.thinking); return; }
    settle(e); port.disconnect();
  });
  port.onDisconnect.addListener(() => settle({ error: 'Connection to the extension was lost' }));
  port.postMessage(req);
  return {
    done,
    /** cancel: closing the port aborts the model call; nothing is cached */
    stop() { if (settled) return; settle({ cancelled: true }); try { port.disconnect(); } catch { /* already gone */ } },
  };
}
