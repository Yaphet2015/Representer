/** Picks the real (pi durable) provider, or the mock one in dev builds, so callers never branch on it. */
import { runTurn } from './llm';
import { mockStream, mockSummaryStream, useMock } from './mock';
import { summarizeWithSteps } from './steps';
import { messages, type Lang } from './i18n';
import { pageTools } from './page-tools';
import { chatSystem, summaryInstructions, summaryInput } from './prompts';
import type { ChatMessage, Settings, Summary } from './types';

export interface Provider {
  /** `onDelta` receives the raw JSON text as the model writes it (a provider that does not stream just never calls it) */
  summarize(title: string, url: string, content: string, signal?: AbortSignal, onDelta?: (t: string) => void): Promise<Summary>;
  /** `summary` is null when there is no overview: the page is then an attachment the model reads on demand */
  chat(ctx: { title: string; summary: Summary | null; content: string }, history: ChatMessage[], input: string, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

export function providerFor(s: Settings, lang: Lang = 'zh-CN'): Provider {
  // Mock mode is a dev-only tool: production builds ignore the stored flag and drop the mock code.
  const dev = import.meta.env.DEV;
  if (useMock(dev ? s : { ...s, mock: false })) {
    if (dev) return { summarize: (title, _url, content, signal, onDelta) => mockSummaryStream(title, lang, signal, content, onDelta), chat: (_c, _h, input, onDelta, signal) => mockStream(input, onDelta, signal, 30, lang) };
    const fail = () => Promise.reject(new Error(messages(lang).noApiKey));
    return { summarize: fail, chat: fail };
  }
  return {
    summarize: async (title, url, content, signal, onDelta) => {
      const input = summaryInput(title, url, content);
      return summarizeWithSteps(content, (feedback, attemptSignal, delta) => runTurn(s, summaryInstructions(lang, s.systemPrompt), [],
        feedback ? `${input}\n\n${feedback}` : input, delta, attemptSignal), signal, onDelta);
    },
    chat: (c, history, input, onDelta, signal) => runTurn(s, chatSystem(c.title, c.summary, c.content, s.systemPrompt), history, input, onDelta, signal, c.summary ? null : pageTools(c.content)),
  };
}
