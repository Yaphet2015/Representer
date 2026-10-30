/**
 * LLM layer built on pi durable (@earendil-works/pi-durable) + pi-ai.
 * Each call opens a short-lived Harness over MemoryStorage (our own 24h cache lives in chrome.storage),
 * creates a root conversation with the BYOK model, seeds prior chat turns, submits the input and
 * streams text deltas from the agent event stream.
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createRegistry, Harness, type Extension, MemoryStorage, UserEntry, AssistantEntry, watchEvents } from '@earendil-works/pi-durable';
import { AbortError } from './abort';
import type { ChatMessage, Settings } from './types';

const PROVIDER = 'byok';

export function buildModels(s: Settings) {
  const baseUrl = s.baseUrl.replace(/\/+$/, '');
  const model: Model<'openai-completions'> = {
    id: s.model, name: s.model, api: 'openai-completions', provider: PROVIDER, baseUrl,
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 8192,
  } as Model<'openai-completions'>;
  const models = createModels();
  models.setProvider(createProvider({
    id: PROVIDER, name: 'BYOK (OpenAI-compatible)', baseUrl,
    auth: { apiKey: { name: 'BYOK API key', resolve: async () => ({ auth: { apiKey: s.apiKey || 'no-key' } }) /* keyless local servers (Ollama) ignore it */ } },
    models: [model],
    api: openAICompletionsApi(),
  }) as any);
  return models;
}

const now = () => Date.now();

/** Run one turn: instructions + prior history + input. Calls onDelta for each streamed text chunk; resolves with the full answer. */
export async function runTurn(
  s: Settings, instructions: string, history: ChatMessage[], input: string,
  onDelta?: (t: string) => void, signal?: AbortSignal, tools?: Extension | null,
): Promise<string> {
  if (signal?.aborted) throw new AbortError();
  const ctx = BACKGROUND_CONTEXT;
  const registry = createRegistry();
  if (tools) registry.install(tools);
  const harness = await Harness.open(new MemoryStorage(), { models: buildModels(s), registry, settings: { progress: { partialIntervalMs: 30, outputIntervalMs: 100 } } } as any, ctx);
  try {
    const root = await harness.root(ctx, { agent: { model: { provider: PROVIDER, modelId: s.model }, instructions } } as any);
    if (history.length) {
      await root.commit(async (tx: any) => {
        for (const m of history) {
          if (m.role === 'user') await tx.appendEntry(UserEntry, root.id, { model: [{ role: 'user', content: m.content, timestamp: now() }] });
          else await tx.appendEntry(AssistantEntry, root.id, { model: [{
            role: 'assistant', content: [{ type: 'text', text: m.content }], api: 'openai-completions', provider: PROVIDER,
            model: s.model, stopReason: 'stop', timestamp: now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          }] });
        }
      }, ctx);
    }
    let streamed = '';
    const events = onDelta ? await watchEvents(harness, root.id, ctx) : null;
    events?.start(async (batch: readonly any[]) => {
      const emit = (d: string) => { if (d) { streamed += d; onDelta!(d); } };
      for (const e of batch) {
        // the assistant message_start can already carry the first chunk(s) of text
        if (e.type === 'message_start' && e.message?.role === 'assistant')
          for (const b of e.message.content ?? []) if (b.type === 'text') emit(b.text);
        if (e.type === 'message_update')
          for (const c of e.changes) {
            if (c.type === 'text_delta') emit(c.delta);
            // a new text block arrives with its first chunk inside (after thinking, it is the start of the answer)
            else if (c.type === 'text_start') emit(c.block?.text ?? '');
          }
      }
    });
    const submission = await root.submit({ type: 'input', content: input }, ctx);
    const onAbort = () => { (root as any).abort?.(ctx).catch?.(() => {}); };
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) onAbort();
    let settled: any;
    try { settled = await submission.wait(ctx); } finally { signal?.removeEventListener('abort', onAbort); }
    if (signal?.aborted) throw new AbortError();
    if (settled.status !== 'done') throw new Error(`Model call failed: ${settled.detail ?? settled.reason ?? settled.status}`);
    const entry: any = await root.commit((tx: any) => tx.entry(AssistantEntry, settled.answer), ctx).catch(() => null);
    const msg = entry?.model?.[0] ?? settled.answer?.model?.[0];
    const text = (msg?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    if (msg?.stopReason === 'error') throw new Error(msg.errorMessage || 'Model error');
    // flush deltas the event stream may not have delivered yet
    if (onDelta && text.length > streamed.length && text.startsWith(streamed)) onDelta(text.slice(streamed.length));
    return text || streamed;
  } finally {
    await harness.close(ctx).catch(() => {});
  }
}
