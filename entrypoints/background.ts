import { createCache } from '@/lib/cache';
import { CHAT_PORT, SUMMARY_PORT, TOGGLE, type Api, type ChatEvent, type ChatRequest, type MsgType, type Request } from '@/lib/messages';
import { listModels, testConnection } from '@/lib/models';
import { providerFor } from '@/lib/provider';
import { chatContext, createSummarizeRunner } from '@/lib/summarize-run';
import { serveSummaryPort } from '@/lib/summarize-stream';
import { appendMessages, closeSession, forkSession, setActive } from '@/lib/sessions';
import { messages, resolveLang, uiLanguage } from '@/lib/i18n';
import { chromeKV, loadSettings } from '@/lib/storage';
import type { ChatMessage } from '@/lib/types';

const COMMAND = 'toggle-overlay';

export default defineBackground(() => {
  const cache = createCache(chromeKV);
  const summarizer = createSummarizeRunner(cache);
  /** settings + resolved UI language */
  const ctx = async () => { const s = await loadSettings(); return { s, lang: resolveLang(s.lang, uiLanguage()) }; };

  // ── toggle: keyboard command + toolbar button ───────────────────────────
  const toggle = async (tabId?: number) => {
    if (tabId == null) return;
    try { await chrome.tabs.sendMessage(tabId, TOGGLE); } catch { /* no content script (chrome:// etc.) */ }
  };
  chrome.commands.onCommand.addListener(async (cmd, tab) => {
    if (cmd !== COMMAND) return;
    toggle(tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
  });
  chrome.action.onClicked.addListener((tab) => toggle(tab.id));

  // ── request/response handlers (typed by lib/messages.ts) ────────────────
  type Handlers = { [K in MsgType]: (req: Api[K]['req']) => Promise<Api[K]['res']> };
  const handlers: Handlers = {
    getCached: async ({ url }) => ({ cached: await cache.getSummary(url) }),
    summarize: async ({ url, title, content, force, anchors }) => {
      if (!force) { const c = await cache.getSummary(url); if (c) return { summary: c.summary, anchors: c.anchors }; }
      const { s, lang } = await ctx();
      return summarizer.run({ url, title, content, anchors }, (signal) => providerFor(s, lang).summarize(title, url, content, signal));
    },
    cancelSummarize: async ({ url }) => { summarizer.cancel(url); return {}; },
    getShortcut: async () => ({ shortcut: (await chrome.commands.getAll()).find((c) => c.name === COMMAND)?.shortcut ?? '' }),
    listModels: async ({ settings }) => ({ models: await listModels(settings, fetch, undefined, (await ctx()).lang) }),
    testConnection: async ({ settings }) => ({ result: await testConnection(settings) }),
    getSessions: async ({ url }) => ({ state: await cache.getSessions(url) }),
    forkSession: async ({ url, from }) => {
      let id = '';
      const state = await cache.updateSessions(url, (s) => { const r = forkSession(s, from); id = r.id; return r.state; });
      return { state, id };
    },
    closeSession: async ({ url, id }) => ({ state: await cache.updateSessions(url, (s) => closeSession(s, id)) }),
    setActiveSession: async ({ url, id }) => ({ state: await cache.updateSessions(url, (s) => setActive(s, id)) }),
  };
  chrome.runtime.onMessage.addListener((msg: Request, _sender, reply) => {
    const handler = handlers[msg?.type] as ((req: unknown) => Promise<object>) | undefined;
    if (!handler) return false; // e.g. the content script's own TOGGLE
    handler(msg).then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });

  // ── streaming overview ──────────────────────────────────────────────────
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SUMMARY_PORT) return;
    serveSummaryPort(port, {
      cache, runner: summarizer,
      summarize: async ({ url, title, content }, signal, onDelta, onThinking) => {
        const { s, lang } = await ctx();
        return providerFor(s, lang).summarize(title, url, content, signal, onDelta, onThinking);
      },
    });
  });

  // ── streaming chat ──────────────────────────────────────────────────────
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT) return;
    const ac = new AbortController();
    port.onDisconnect.addListener(() => ac.abort());
    const post = (e: ChatEvent) => { try { port.postMessage(e); } catch { /* port closed */ } };
    port.onMessage.addListener(async ({ url, text, sid, label, page }: ChatRequest) => {
      try {
        const { s, lang } = await ctx();
        // no summary (cancelled, failed, still running): chat over the page text sent along, as an attachment
        const c = await chatContext(cache, url, page);
        if (!c) throw new Error(messages(lang).summaryExpired);
        const history = ((await cache.getSessions(url)).sessions.find((x) => x.id === sid)?.messages ?? []).filter((m) => m.content);
        const out = await providerFor(s, lang).chat(c, history, text, (delta) => post({ delta }), ac.signal);
        const userMsg: ChatMessage = label ? { role: 'user', content: text, label } : { role: 'user', content: text };
        await cache.updateSessions(url, (s) => appendMessages(s, sid, [userMsg, { role: 'assistant', content: out }]));
        post({ done: true, text: out }); // full answer is authoritative: streamed deltas can miss the first chunk
      } catch (e: any) {
        post({ error: String(e?.message ?? e) });
      }
    });
  });
});
