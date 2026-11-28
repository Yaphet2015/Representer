// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../components/App';
import { Chat } from '../components/Chat';
import { LangProvider } from '../components/i18n';
import { PdfPanel } from '../components/pdf/PdfPanel';
import { CHAT_PORT, SUMMARY_PORT } from '../lib/messages';
import { PDF_CONTEXT } from '../lib/pdf-contract';
import { pdfTextDocument } from '../lib/pdf-text';
import { initialState } from '../lib/sessions';

const extract = vi.hoisted(() => vi.fn());
vi.mock('../lib/frame-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/frame-bridge')>();
  return { ...actual, extractPageWithFrames: extract };
});

const readPdf = vi.hoisted(() => vi.fn());
vi.mock('../lib/pdf-read', () => ({ readPdf }));
vi.mock('@/lib/pdf-render', () => ({
  createPdfRenderBackend: () => ({ render: async (page: number) => ({ page, width: 1, height: 1, mimeType: 'image/png', bytes: new Uint8Array([1]) }), close: async () => {} }),
  webCanvasFactory: () => ({ create: () => ({ canvas: { width: 1, height: 1 }, context: {} }), reset() {}, destroy() {} }),
}));

const page = {
  title: 'Page',
  content: '[p1] Hello world, this is readable page text for the overview.',
  anchors: { p1: { h: 'x', n: 20, head: 'Hello', o: 0 } },
  sources: [],
  notices: [],
  generation: 'g1',
};
const cachedSummary = { overview: 'Cached overview about the page.', sections: [] };
const freshSummary = { overview: 'Fresh overview after a refresh.', sections: [] };
const grant = { tabId: 8, url: 'https://files.example.org/doc', token: 'clicked' };

function noListeners() { return { addListener: vi.fn(), removeListener: vi.fn() }; }
function port(name: string, onPost?: (emit: (e: unknown) => void) => void) {
  const listeners: Array<(e: unknown) => void> = [];
  const emit = (e: unknown) => listeners.forEach((f) => f(e));
  return {
    name,
    postMessage: vi.fn(() => { onPost?.(emit); }),
    disconnect: vi.fn(),
    onMessage: { addListener: (f: (e: unknown) => void) => { listeners.push(f); }, removeListener: vi.fn() },
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
  };
}

const settle = async (ms = 0) => {
  await act(async () => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
};
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
};
const setTextarea = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  });
  await settle();
  expect(el.value).toBe(value);
};

describe('overview refresh keeps the webpage chat', () => {
  let root: Root;
  let host: HTMLElement;
  let getSessionsCalls = 0;
  let cached = true;
  let finishOverview: ((e: unknown) => void) | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Element.prototype.scrollIntoView = vi.fn();
    getSessionsCalls = 0;
    cached = true;
    finishOverview = null;
    extract.mockReset();
    extract.mockResolvedValue(page);
    document.title = 'Page';
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (msg: { type: string }) => {
          if (msg.type === 'getCached') return cached ? { ok: true, cached: { summary: cachedSummary, createdAt: 1, title: 'Page', anchors: page.anchors } } : { ok: true };
          if (msg.type === 'getSessions') { getSessionsCalls += 1; return { ok: true, state: initialState() }; }
          if (msg.type === 'openOptions') return { ok: true };
          return { ok: false, error: `unexpected ${msg.type}` };
        }),
        connect: vi.fn((info?: { name?: string }) => {
          if (info?.name === SUMMARY_PORT) {
            return port(SUMMARY_PORT, (emit) => {
              if (finishOverview) return;
              queueMicrotask(() => emit({ done: true, summary: freshSummary, anchors: page.anchors }));
            });
          }
          if (info?.name === CHAT_PORT) {
            return port(CHAT_PORT, (emit) => { queueMicrotask(() => emit({ error: 'Model call failed: 400' })); });
          }
          throw new Error('unexpected port ' + info?.name);
        }),
        getURL: (p: string) => p,
        onMessage: noListeners(),
      },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: noListeners() },
      i18n: { getUILanguage: () => 'en' },
    });
  });
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  const renderApp = async () => {
    await act(async () => root.render(<LangProvider><App /></LangProvider>));
    await settle();
  };
  const composer = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label]')!;
  const tab = (id: 'overview' | 'chat') => host.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`);
  const leaveFailedRoundAndDraft = async () => {
    await click(tab('chat'));
    await setTextarea(composer(), 'will this fail?');
    await click(host.querySelector('[data-send]'));
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('⚠️ Model call failed: 400');
    await setTextarea(composer(), 'keep this draft');
  };

  it('keeps a composer draft and unsaved failed messages when switching overview and chat tabs', async () => {
    await renderApp();
    expect(host.textContent).toContain('Cached overview about the page.');
    const sessionsBefore = getSessionsCalls;
    await leaveFailedRoundAndDraft();
    await click(tab('overview'));
    expect(composer().value).toBe('keep this draft');
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('⚠️ Model call failed: 400');
    await click(tab('chat'));
    expect(composer().value).toBe('keep this draft');
    expect(host.querySelector('[data-msg="user"]')?.textContent).toContain('will this fail?');
    expect(host.querySelector('[data-msg="assistant"]')?.textContent).toContain('⚠️ Model call failed: 400');
    expect(getSessionsCalls).toBe(sessionsBefore);
  });

  it('does not clear a draft or unsaved failed messages when the overview is regenerated', async () => {
    await renderApp();
    const sessionsBefore = getSessionsCalls;
    await leaveFailedRoundAndDraft();
    await click(tab('overview'));
    await click(host.querySelector('[data-regenerate]'));
    await settle(700);
    expect(host.textContent).toContain('Fresh overview after a refresh.');
    expect(composer().value).toBe('keep this draft');
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('⚠️ Model call failed: 400');
    await click(tab('chat'));
    expect(composer().value).toBe('keep this draft');
    expect(host.querySelector('[data-msg="user"]')?.textContent).toContain('will this fail?');
    expect(host.querySelector('[data-msg="assistant"]')?.textContent).toContain('⚠️ Model call failed: 400');
    expect(getSessionsCalls).toBe(sessionsBefore);
  });

  it('does not reload chat when a first overview finishes or hasSummary becomes true', async () => {
    cached = false;
    vi.mocked(chrome.runtime.connect).mockImplementation(((info?: { name?: string }) => {
      if (info?.name === SUMMARY_PORT) {
        return port(SUMMARY_PORT, (emit) => { finishOverview = emit; });
      }
      if (info?.name === CHAT_PORT) {
        return port(CHAT_PORT, (emit) => { queueMicrotask(() => emit({ error: 'Model call failed: 400' })); });
      }
      throw new Error('unexpected port ' + info?.name);
    }) as never);
    await renderApp();
    await leaveFailedRoundAndDraft();
    const sessionsBefore = getSessionsCalls;
    expect(finishOverview).toBeTruthy();
    await act(async () => { finishOverview?.({ done: true, summary: freshSummary, anchors: page.anchors }); });
    await settle();
    expect(host.textContent).toContain('Fresh overview after a refresh.');
    await click(tab('overview'));
    await click(tab('chat'));
    expect(composer().value).toBe('keep this draft');
    expect(host.querySelector('[data-msg="assistant"]')?.textContent).toContain('⚠️ Model call failed: 400');
    expect(getSessionsCalls).toBe(sessionsBefore);
  });
});

describe('Chat only reloads sessions when the page url changes', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Element.prototype.scrollIntoView = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal('chrome', {
      runtime: { connect: vi.fn(), sendMessage: vi.fn() },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: noListeners() },
      i18n: { getUILanguage: () => 'en' },
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (msg: { type: string; url?: string }) => {
      if (msg.type === 'getSessions') {
        const text = msg.url?.includes('other') ? 'from the other page' : 'from the first page';
        return { ok: true, state: initialState([{ role: 'user', content: text }, { role: 'assistant', content: 'ok' }]) };
      }
      return { ok: false };
    }) as never);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('keeps in-memory messages when hasSummary changes, and reloads when the url changes', async () => {
    const getPage = async () => ({ title: 'Page', content: 'body' });
    await act(async () => root.render(<LangProvider><Chat url="https://example.test/one" pageTitle="One" hasSummary={false} getPage={getPage} /></LangProvider>));
    await settle();
    expect(host.textContent).toContain('from the first page');
    const connect = vi.mocked(chrome.runtime.connect).mockImplementation(() =>
      port(CHAT_PORT, (emit) => { queueMicrotask(() => emit({ error: 'Model call failed: 400' })); }) as never,
    );
    const box = host.querySelector<HTMLTextAreaElement>('textarea[aria-label]')!;
    await setTextarea(box, 'will this fail?');
    await click(host.querySelector('[data-send]'));
    expect(host.textContent).toContain('⚠️ Model call failed: 400');
    await setTextarea(box, 'keep this draft');
    const sessionCalls = () => vi.mocked(chrome.runtime.sendMessage).mock.calls.filter((c) => (c[0] as unknown as { type: string }).type === 'getSessions');
    const calls = sessionCalls().length;
    await act(async () => root.render(<LangProvider><Chat url="https://example.test/one" pageTitle="One" hasSummary getPage={getPage} /></LangProvider>));
    await settle();
    expect(host.textContent).toContain('⚠️ Model call failed: 400');
    expect(box.value).toBe('keep this draft');
    expect(sessionCalls()).toHaveLength(calls);
    await act(async () => root.render(<LangProvider><Chat url="https://example.test/other" pageTitle="Other" hasSummary getPage={getPage} /></LangProvider>));
    await settle();
    expect(host.textContent).toContain('from the other page');
    expect(host.textContent).not.toContain('⚠️ Model call failed: 400');
    expect(connect).toHaveBeenCalled();
  });
});

describe('overview refresh keeps the PDF chat', () => {
  let root: Root;
  let host: HTMLElement;
  let getSessionsCalls = 0;
  let cached = true;
  const summary = cachedSummary;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    getSessionsCalls = 0;
    cached = true;
    readPdf.mockReset();
    readPdf.mockResolvedValue({ ...pdfTextDocument(['First page.', 'Second page.'], 5000, 'fixture'), data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
    document.body.innerHTML = '<div id="root"></div>';
    host = document.getElementById('root')!;
    root = createRoot(host);
    window.history.replaceState({}, '', '/pdf-panel.html?tab=8');
    if (typeof URL.createObjectURL !== 'function') {
      Object.assign(URL, { createObjectURL: () => 'blob:test-pdf-page', revokeObjectURL: () => {} });
    }
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async (msg: { type: string }) => {
          if (msg.type === PDF_CONTEXT) return { kind: 'pdf', grant };
          if (msg.type === 'getCached') return cached ? { ok: true, cached: { summary } } : { ok: true };
          if (msg.type === 'getSessions') { getSessionsCalls += 1; return { ok: true, state: initialState() }; }
          if (msg.type === 'rp-pdf-visual-open' || msg.type === 'rp-pdf-visual-close') return { ok: true };
          return { ok: false };
        }),
        connect: vi.fn((info?: { name?: string }) => {
          if (info?.name === 'pdf-visual') return { name: 'pdf-visual', postMessage: vi.fn(), disconnect: vi.fn(), onMessage: noListeners(), onDisconnect: noListeners() };
          if (info?.name === SUMMARY_PORT) return port(SUMMARY_PORT, (emit) => { queueMicrotask(() => emit({ done: true, summary: freshSummary })); });
          if (info?.name === CHAT_PORT) return port(CHAT_PORT, (emit) => { queueMicrotask(() => emit({ error: 'Model call failed: 400' })); });
          throw new Error('unexpected port ' + info?.name);
        }),
        getURL: (p: string) => p,
        openOptionsPage: vi.fn(),
        onMessage: noListeners(),
      },
      tabs: { onActivated: { addListener: vi.fn(), removeListener: vi.fn() }, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: noListeners() },
    });
  });
  afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

  const renderPanel = async () => {
    await act(async () => root.render(<PdfPanel />));
    await settle();
  };
  const chatBox = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message about this PDF"]')!;
  const tabBtn = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  const leaveFailedRoundAndDraft = async () => {
    await click(tabBtn('Chat'));
    await setTextarea(chatBox(), 'will this fail?');
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Send'));
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('Model call failed: 400');
    await setTextarea(chatBox(), 'keep this draft');
  };

  it('keeps a composer draft and unsaved failed messages across PDF tab switches and regenerate', async () => {
    await renderPanel();
    expect(host.textContent).toContain('Cached overview about the page.');
    const sessionsBefore = getSessionsCalls;
    expect(sessionsBefore).toBeGreaterThan(0);
    await leaveFailedRoundAndDraft();
    await click(tabBtn('Overview'));
    expect(chatBox().value).toBe('keep this draft');
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('Model call failed: 400');
    await click(tabBtn('Chat'));
    expect(chatBox().value).toBe('keep this draft');
    await click(tabBtn('Overview'));
    await click(host.querySelector('[data-regenerate]'));
    await settle(200);
    expect(host.textContent).toContain('Fresh overview after a refresh.');
    expect(chatBox().value).toBe('keep this draft');
    expect(host.textContent).toContain('will this fail?');
    expect(host.textContent).toContain('Model call failed: 400');
    await click(tabBtn('Chat'));
    expect(chatBox().value).toBe('keep this draft');
    expect(getSessionsCalls).toBe(sessionsBefore);
  });
});
