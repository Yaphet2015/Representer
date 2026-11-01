/** Picks the real (pi durable) provider, or the mock one in dev builds, so callers never branch on it. */
import { runTurn } from './llm';
import type { Usage } from '@earendil-works/pi-ai';
import { OutputTruncated, MAX_OUTPUT_CEILING, maxOutputFor, isMaxTokensError, SAFE_MAX_OUTPUT } from './budget';
import { OverviewIncomplete, runOverviewAgent, ToolsUnsupported, type OverviewStatus } from './overview-agent';
import { AbortError } from './abort';
import { mockOverviewAgent, mockStream, useMock } from './mock';
import { summarizeWithSteps } from './steps';
import { messages, type Lang } from './i18n';
import { pageTools } from './page-tools';
import { chatSystem, overviewAgentInstructions, summaryInstructions, summaryInput } from './prompts';
import type { ChatMessage, Settings, Summary } from './types';

export interface Provider {
  /** `onDelta` receives the raw JSON text as the model writes it (a provider that does not stream just never calls it) */
  summarize(title: string, url: string, content: string, signal?: AbortSignal, onDelta?: (t: string) => void, onThinking?: (t: string) => void, more?: SummarizeHooks): Promise<Summary>;
  /** `summary` is null when there is no overview: the page is then an attachment the model reads on demand */
  chat(ctx: { title: string; summary: Summary | null; content: string }, history: ChatMessage[], input: string, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

export interface SummarizeHooks {
  /** the overview agent hands over the summary built so far after each accepted piece */
  onPartial?: (s: Summary) => void;
  /** what the agent is doing besides thinking: reading the page, or repairing a rejected piece */
  onStatus?: (s: OverviewStatus) => void;
  /** token usage of each model reply (for measurement) */
  onUsage?: (u: Usage) => void;
}

export function providerFor(s: Settings, lang: Lang = 'zh-CN'): Provider {
  // Mock mode is a dev-only tool: production builds ignore the stored flag and drop the mock code.
  const dev = import.meta.env?.DEV;
  if (useMock(dev ? s : { ...s, mock: false })) {
    if (dev) return { summarize: (title, _url, content, signal, _onDelta, onThinking, more = {}) => mockOverviewAgent(title, lang, signal, content, onThinking, more), chat: (_c, _h, input, onDelta, signal) => mockStream(input, onDelta, signal, 30, lang) };
    const fail = () => Promise.reject(new Error(messages(lang).noApiKey));
    return { summarize: fail, chat: fail };
  }
  return {
    summarize: async (title, url, content, signal, onDelta, onThinking, more = {}) => {
      try {
        return await runOverviewAgent({
          instructions: overviewAgentInstructions(lang, s.systemPrompt), title, url, content, model: s.model, signal,
          onPartial: more.onPartial, onStatus: more.onStatus,
        }, { turn: (instructions, input, tools, sig, maxTokens, onStop, onToolArgs) => runTurn(s, instructions, [], input, undefined, sig, tools, onThinking, { maxTokens, onStop, onToolArgs, onUsage: more.onUsage }) });
      } catch (e) {
        if (e instanceof AbortError || signal?.aborted) throw e;
        if (!(e instanceof ToolsUnsupported)) throw friendly(e, lang);
      }
      // a model without tool calling: the single JSON reply, but never parsed when it was cut off
      try {
        return await summarizeWithSteps(content, (feedback, attemptSignal, delta, thinking) => singleCall(s, lang, feedback ? `${summaryInput(title, url, content)}\n\n${feedback}` : summaryInput(title, url, content), delta, attemptSignal, thinking), signal, onDelta, onThinking);
      } catch (e) {
        if (e instanceof AbortError || signal?.aborted) throw e;
        throw friendly(e, lang);
      }
    },
    chat: (c, history, input, onDelta, signal) => runTurn(s, chatSystem(c.title, c.summary, c.content, s.systemPrompt), history, input, onDelta, signal, c.summary ? null : pageTools(c.content)),
  };
}

/** One JSON reply. Cut off (stop reason "length"): try again with twice the budget, up to two more times. */
async function singleCall(s: Settings, lang: Lang, input: string, onDelta?: (t: string) => void, signal?: AbortSignal, onThinking?: (t: string) => void): Promise<string> {
  let budget = maxOutputFor(s.model);
  for (let attempt = 0; ; attempt++) {
    try {
      // a retry is not streamed: the panel keeps the first attempt's partial overview until the answer is complete
      return await runTurn(s, summaryInstructions(lang, s.systemPrompt), [], input, attempt ? undefined : onDelta, signal, undefined, onThinking, { maxTokens: budget, failOnLength: true });
    } catch (e) {
      if (signal?.aborted) throw new AbortError();
      if (isMaxTokensError(e) && budget > SAFE_MAX_OUTPUT) { budget = SAFE_MAX_OUTPUT; continue; }
      if (!(e instanceof OutputTruncated) || attempt >= 2 || budget >= MAX_OUTPUT_CEILING) throw e;
      budget = Math.min(budget * 2, MAX_OUTPUT_CEILING);
    }
  }
}

/** What the panel shows when no overview came out: never a parser message or raw model output. */
function friendly(e: unknown, lang: Lang): Error {
  const t = messages(lang);
  if (e instanceof OutputTruncated || e instanceof OverviewIncomplete || e instanceof SyntaxError || /JSON|Missing "overview"|Invalid summary/.test(String((e as any)?.message))) return new Error(t.overviewIncomplete);
  return e instanceof Error ? e : new Error(String(e));
}
