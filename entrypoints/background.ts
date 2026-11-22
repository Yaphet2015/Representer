import { recordEntryTrace } from '@/lib/pdf-entry-trace';
import { installPdfEntry } from '@/lib/pdf-entry';
import { visualSession } from '@/lib/pdf-visual-sessions';
import { visualInspectReport } from '@/lib/pdf-visual';
import { createCache, pageHash } from '@/lib/cache';
import { createFrameRelay } from '@/lib/frame-relay';
import { CHAT_PORT, SUMMARY_PORT, TOGGLE, type Api, type ChatEvent, type ChatRequest, type MsgType, type Request } from '@/lib/messages';
import { listModels, testConnection } from '@/lib/models';
import { providerFor } from '@/lib/provider';
import { chatContext, createSummarizeRunner } from '@/lib/summarize-run';
import { serveSummaryPort } from '@/lib/summarize-stream';
import { appendMessages, closeSession, forkSession, newSession, setActive } from '@/lib/sessions';
import { messages, resolveLang, uiLanguage } from '@/lib/i18n';
import { chromeKV, loadSettings } from '@/lib/storage';
import type { ChatMessage } from '@/lib/types';

const COMMAND = 'toggle-overlay';

export default defineBackground(() => {
  if (import.meta.env.VITE_RP_ENTRY_DIAG === '1') recordEntryTrace({ stage: 'worker-main' });
  const cache = createCache(chromeKV);
  const summarizer = createSummarizeRunner(cache);
  const ctx = async () => { const s = await loadSettings(); return { s, lang: resolveLang(s.lang, uiLanguage()) }; };

  const relay = createFrameRelay({
    sendMessage: (tabId, msg, opts) => chrome.tabs.sendMessage(tabId, msg, opts),
  });

  const toggle = async (tabId?: number, documentId?: string) => {
    if (tabId == null) return;
    await chrome.tabs.sendMessage(tabId, TOGGLE, documentId ? { documentId } : { frameId: 0 });
  };
  // Toolbar and the existing toggle-overlay command share one router in installPdfEntry
  // (PDF → side panel, webpage → overlay). Do not query or await before sidePanel.open().
  installPdfEntry(toggle);

  type Handlers = { [K in MsgType]: (req: Api[K]['req']) => Promise<Api[K]['res']> };
  const handlers: Handlers = {
    getCached: async ({ url, hash }) => ({ cached: await cache.getSummary(url, hash) }),
    summarize: async ({ url, title, content, force, anchors }) => {
      if (!force) { const c = await cache.getSummary(url, pageHash(content)); if (c) return { summary: c.summary, anchors: c.anchors }; }
      const { s, lang } = await ctx();
      return summarizer.run({ url, title, content, anchors }, (signal) => providerFor(s, lang).summarize(title, url, content, signal, undefined, undefined, { visual: visualSession(url) }));
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
    newSession: async ({ url }) => {
      let id = '';
      const state = await cache.updateSessions(url, (s) => { const r = newSession(s); id = r.id; return r.state; });
      return { state, id };
    },
    closeSession: async ({ url, id }) => ({ state: await cache.updateSessions(url, (s) => closeSession(s, id)) }),
    setActiveSession: async ({ url, id }) => ({ state: await cache.updateSessions(url, (s) => setActive(s, id)) }),
  };

  chrome.runtime.onMessage.addListener((msg: any, sender, reply) => {
    const frameSender = {
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      url: sender.url,
    };
    if (relay.handle(msg, frameSender, reply)) return true;

    const handler = handlers[(msg as Request)?.type] as ((req: unknown) => Promise<object>) | undefined;
    if (!handler) return false;
    handler(msg).then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => relay.dropTab(tabId));

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SUMMARY_PORT) return;
    serveSummaryPort(port, {
      cache, runner: summarizer,
      summarize: async ({ url, title, content }, signal, onDelta, onThinking, more) => {
        const { s, lang } = await ctx();
        return providerFor(s, lang).summarize(title, url, content, signal, onDelta, onThinking, { ...more, visual: visualSession(url) });
      },
      visualInspect: (url) => { const v = visualSession(url); return v ? visualInspectReport(v) : undefined; },
    });
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== CHAT_PORT) return;
    const ac = new AbortController();
    port.onDisconnect.addListener(() => ac.abort());
    const post = (e: ChatEvent) => { try { port.postMessage(e); } catch { /* */ } };
    port.onMessage.addListener(async ({ url, text, sid, label, page }: ChatRequest) => {
      try {
        const { s, lang } = await ctx();
        const c = await chatContext(cache, url, page);
        if (!c) throw new Error(messages(lang).summaryExpired);
        const history = ((await cache.getSessions(url)).sessions.find((x) => x.id === sid)?.messages ?? []).filter((m) => m.content);
        const out = await providerFor(s, lang).chat({ ...c, visual: visualSession(url) }, history, text, (delta) => post({ delta }), ac.signal);
        const userMsg: ChatMessage = label ? { role: 'user', content: text, label } : { role: 'user', content: text };
        await cache.updateSessions(url, (s) => appendMessages(s, sid, [userMsg, { role: 'assistant', content: out }]));
        post({ done: true, text: out });
      } catch (e: any) {
        post({ error: String(e?.message ?? e) });
      }
    });
  });
});
