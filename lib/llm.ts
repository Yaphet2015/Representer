/**
 * LLM layer built on pi durable (@earendil-works/pi-durable) + pi-ai.
 * Each call opens a short-lived Harness over MemoryStorage (our own 24h cache lives in chrome.storage),
 * creates a root conversation with the BYOK model, seeds prior chat turns, submits the input and
 * streams text deltas from the agent event stream.
 */
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, createProvider, type Model, type Usage } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createRegistry, Harness, type Extension, MemoryStorage, UserEntry, AssistantEntry, watchEvents } from '@earendil-works/pi-durable';
import { AbortError } from './abort';
import { maxOutputFor, OutputTruncated } from './budget';
import type { ChatMessage, Settings } from './types';

const PROVIDER = 'byok';

export function buildModels(s: Settings, maxTokens = maxOutputFor(s.model)) {
  const baseUrl = s.baseUrl.replace(/\/+$/, '');
  const model: Model<'openai-completions'> = {
    id: s.model, name: s.model, api: 'openai-completions', provider: PROVIDER, baseUrl,
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens,
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

export interface TurnOptions {
  /** output-token cap for this call (reasoning included); default: the model's, see maxOutputFor */
  maxTokens?: number;
  /** throw OutputTruncated instead of returning text the model was cut off in */
  failOnLength?: boolean;
  /** the final message's stop reason ('stop', 'length', 'toolUse', ...) */
  onStop?: (reason: string) => void;
  /** a tool call's arguments as they stream in (an object still being filled in), before the tool runs */
  onToolArgs?: (name: string, args: unknown) => void;
  /** token usage of each model reply in this turn (a turn with tool calls has several) */
  onUsage?: (u: Usage) => void;
}

/** Rebuilds streamed tool-call arguments from the event changes (start, string appends at a path, whole blocks). */
function toolArgsTracker(emit: (name: string, args: unknown) => void) {
  const calls = new Map<number, { name: string; args: any }>();
  const set = (i: number, block: any) => { if (block?.type === 'toolCall') { calls.set(i, { name: block.name, args: structuredClone(block.arguments ?? {}) }); emit(block.name, calls.get(i)!.args); } };
  return {
    start: set, block: set,
    delta(i: number, path: (string | number)[], delta: string) {
      const c = calls.get(i);
      if (!c || !path.length) return;
      let o = c.args;
      for (const k of path.slice(0, -1)) { if (o == null || typeof o !== 'object') return; o = o[k]; }
      const last = path[path.length - 1]!;
      if (o == null || typeof o !== 'object') return;
      o[last] = (typeof o[last] === 'string' ? o[last] : '') + delta;
      emit(c.name, c.args);
    },
    reset() { calls.clear(); },
  };
}

/** Run one turn: instructions + prior history + input. Calls onDelta for each streamed text chunk; resolves with the full answer. */
export async function runTurn(
  s: Settings, instructions: string, history: ChatMessage[], input: string,
  onDelta?: (t: string) => void, signal?: AbortSignal, tools?: Extension | null,
  /** the model's reasoning as it streams (OpenAI-compatible `reasoning` / `reasoning_content`); never part of the answer */
  onThinking?: (t: string) => void,
  opts: TurnOptions = {},
): Promise<string> {
  if (signal?.aborted) throw new AbortError();
  const ctx = BACKGROUND_CONTEXT;
  const registry = createRegistry();
  if (tools) registry.install(tools);
  const harness = await Harness.open(new MemoryStorage(), { models: buildModels(s, opts.maxTokens), registry, settings: { progress: { partialIntervalMs: 30, outputIntervalMs: 100 } } } as any, ctx);
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
    const events = onDelta || onThinking || opts.onToolArgs || opts.onUsage ? await watchEvents(harness, root.id, ctx) : null;
    const toolArgs = opts.onToolArgs ? toolArgsTracker(opts.onToolArgs) : null;
    events?.start(async (batch: readonly any[]) => {
      const emit = (d: string) => { if (d && onDelta) { streamed += d; onDelta(d); } };
      const think = (d: string) => { if (d) onThinking?.(d); };
      for (const e of batch) {
        if (e.type === 'message_end') for (const m of e.entry?.model ?? []) if (m.role === 'assistant' && m.usage) opts.onUsage?.(m.usage);
        // the assistant message_start can already carry the first chunk(s) of text
        if (e.type === 'message_start' && e.message?.role === 'assistant') {
          toolArgs?.reset();
          (e.message.content ?? []).forEach((b: any, i: number) => { if (b.type === 'text') emit(b.text); else if (b.type === 'thinking') think(b.thinking); else toolArgs?.start(i, b); });
        }
        if (e.type === 'message_update')
          for (const c of e.changes) {
            if (c.type === 'text_delta') emit(c.delta);
            // a new text block arrives with its first chunk inside (after thinking, it is the start of the answer)
            else if (c.type === 'text_start') emit(c.block?.text ?? '');
            else if (c.type === 'thinking_delta') think(c.delta);
            else if (c.type === 'thinking_start') think(c.block?.thinking ?? '');
            else if (c.type === 'toolcall_start' || c.type === 'block') toolArgs?.block(c.contentIndex, c.block);
            else if (c.type === 'toolcall_delta') toolArgs?.delta(c.contentIndex, c.path ?? [], c.delta ?? '');
            else if (c.type === 'message') (c.message?.content ?? []).forEach((b: any, i: number) => toolArgs?.block(i, b));
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
    opts.onStop?.(msg?.stopReason ?? 'stop');
    if (msg?.stopReason === 'length' && opts.failOnLength) throw new OutputTruncated(text || streamed, opts.maxTokens ?? maxOutputFor(s.model));
    // flush deltas the event stream may not have delivered yet
    if (onDelta && text.length > streamed.length && text.startsWith(streamed)) onDelta(text.slice(streamed.length));
    return text || streamed;
  } finally {
    await harness.close(ctx).catch(() => {});
  }
}
