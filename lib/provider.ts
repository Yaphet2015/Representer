/** Picks the real (pi durable) provider, or the mock one in dev builds, so callers never branch on it. */
import { runTurn } from './llm';
import { mockStream, mockSummary, useMock } from './mock';
import { summarizeWithSteps } from './steps';
import { messages, type Lang } from './i18n';
import { chatSystem, summaryInstructions, summaryInput } from './prompts';
import type { ChatMessage, Settings, Summary } from './types';

export interface Provider {
  summarize(title: string, url: string, content: string, signal?: AbortSignal): Promise<Summary>;
  chat(ctx: { title: string; summary: Summary; content: string }, history: ChatMessage[], input: string, onDelta: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

export function providerFor(s: Settings, lang: Lang = 'zh-CN'): Provider {
  // Mock mode is a dev-only tool: production builds ignore the stored flag and drop the mock code.
  const dev = import.meta.env.DEV;
  if (useMock(dev ? s : { ...s, mock: false })) {
    if (dev) return { summarize: (title, _url, content) => mockSummary(title, lang, undefined, content), chat: (_c, _h, input, onDelta, signal) => mockStream(input, onDelta, signal, 30, lang) };
    const fail = () => Promise.reject(new Error(messages(lang).noApiKey));
    return { summarize: fail, chat: fail };
  }
  return {
    summarize: async (title, url, content, signal) => {
      const input = summaryInput(title, url, content);
      return summarizeWithSteps(content, (feedback, attemptSignal) => runTurn(s, summaryInstructions(lang, s.systemPrompt), [],
        feedback ? `${input}\n\n${feedback}` : input, undefined, attemptSignal), signal);
    },
    chat: (c, history, input, onDelta, signal) => runTurn(s, chatSystem(c.title, c.summary, c.content, s.systemPrompt), history, input, onDelta, signal),
  };
}
