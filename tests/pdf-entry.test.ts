import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPdfEntry, TOGGLE_COMMAND } from '../lib/pdf-entry';
import { isPdfPanelUrl, PDF_CONTEXT, PDF_DOCUMENT, PDF_VISUAL_CLOSE } from '../lib/pdf-contract';
import { PDF_VISUAL_PORT } from '../lib/pdf-visual-port';

type Listener = (...args: any[]) => any;
function event() { const listeners: Listener[] = []; return { clear() { listeners.length = 0; }, addListener(f: Listener) { listeners.push(f); }, fire(...args: any[]) { return listeners.map((f) => f(...args)); } }; }
let action: ReturnType<typeof event>, command: ReturnType<typeof event>, messages: ReturnType<typeof event>, updated: ReturnType<typeof event>, removed: ReturnType<typeof event>, connect: ReturnType<typeof event>;
let open: ReturnType<typeof vi.fn>, send: ReturnType<typeof vi.fn>, setOptions: ReturnType<typeof vi.fn>, setPanelBehavior: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>;
let toggle: (id?: number) => Promise<void>;
let execute: ReturnType<typeof vi.fn>;
let mime: string;
let badge: ReturnType<typeof vi.fn>, title: ReturnType<typeof vi.fn>;
let session: Record<string, unknown>;
let tabs: Record<number, { id: number; url: string; status?: string }>;
let tab: { id: number; url: string; status?: string };
let reply: (tabId: number, msg: unknown) => unknown;
function setReply(fn: (tabId: number, msg: unknown) => unknown) { reply = fn; }
function noReceiver(): never { throw new Error('No receiver'); }
function bindSend() {
  send = vi.fn((tabId: number, msg: unknown, opts?: unknown, cb?: unknown) => {
    const callback = typeof opts === 'function' ? opts : typeof cb === 'function' ? cb : undefined;
    const deliver = (err: unknown, value?: unknown) => {
      const runtime = (globalThis as { chrome: { runtime: { lastError?: { message: string } } } }).chrome.runtime;
      if (callback) {
        if (err) {
          runtime.lastError = { message: String((err as { message?: string }).message ?? err) };
          callback(undefined);
          runtime.lastError = undefined;
        } else {
          runtime.lastError = undefined;
          callback(value);
        }
        return;
      }
      return err ? Promise.reject(err) : Promise.resolve(value);
    };
    try {
      const out = reply(tabId, msg);
      if (out && typeof out === 'object' && 'then' in out) {
        const p = out as Promise<unknown>;
        if (callback) { p.then((v) => deliver(null, v), (e) => deliver(e)); return; }
        return p;
      }
      return deliver(null, out);
    } catch (e) {
      return deliver(e);
    }
  });
  return send;
}
beforeEach(() => {
  session = {};
  mime = 'application/pdf';
  badge = vi.fn(async () => {}); title = vi.fn(async () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  execute = vi.fn((injection, callback) => {
    const result = [{ frameId: 0, documentId: 'document-8', result: { url: tabs[injection.target.tabId]?.url, mime } }];
    if (callback) { callback(result); return; }
    return Promise.resolve(result);
  });
  action = event(); command = event(); messages = event(); updated = event(); removed = event(); connect = event();
  tab = { id: 8, url: 'https://files.example.org/no-extension', status: 'complete' };
  tabs = { 8: tab };
  open = vi.fn(async () => {}); setOptions = vi.fn(async () => {}); setPanelBehavior = vi.fn(async () => {}); close = vi.fn(async () => {});
  disconnect = vi.fn();
  toggle = vi.fn(async () => {});
  setReply(noReceiver);
  bindSend();
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', getURL: (p: string) => 'chrome-extension://ext' + p, onMessage: messages, onConnect: connect, sendMessage: vi.fn(async () => {}), lastError: undefined },
    storage: { session: {
      get: async (k: string | null) => (k == null ? { ...session } : { [k]: session[k] }),
      set: async (v: Record<string, unknown>) => { Object.assign(session, v); },
      remove: async (k: string) => { delete session[k]; },
    } },
    scripting: { executeScript: execute },
    action: { onClicked: action, setBadgeText: badge, setTitle: title }, commands: { onCommand: command },
    sidePanel: { open, close, setOptions, setPanelBehavior },
    tabs: {
      onUpdated: updated, onRemoved: removed,
      query: async () => { throw new Error('PDF context must not guess the active tab'); },
      get: async (id: number) => { const t = tabs[id]; if (!t) throw new Error('no tab'); return t; },
      sendMessage: send,
    },
  });
  installPdfEntry(async (id) => { await toggle(id); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const panel = { id: 'ext', url: 'chrome-extension://ext/pdf-panel.html?tab=8' };
const ctx = (sender = panel, tabId = 8) => new Promise<any>((resolve) => {
  const handled = messages.fire({ type: PDF_CONTEXT, tabId }, sender, resolve).some(Boolean); if (!handled) resolve(null);
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('toolbar routing and PDF user-action capability', () => {
  it('opens a side panel for an affirmatively inspected native PDF with no suffix, without a URL fetch', async () => {
    action.fire(tab); expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(execute).toHaveBeenCalled();
    expect(setOptions).toHaveBeenCalledWith({ tabId: 8, path: 'pdf-panel.html?tab=8', enabled: true });
    const c = await ctx(); expect(c.kind).toBe('pdf'); expect(c.grant.url).toBe(tab.url); expect(c.grant.token).toBeTruthy();
  });
  it('leaves a known normal webpage on the original floating-panel path', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.fire(tab); await flush(); expect(open).not.toHaveBeenCalled(); expect(toggle).toHaveBeenCalledWith(8);
  });
  it('keeps an HTML application/pdf viewer on the PDF sidebar path after a ping', async () => {
    setReply(() => ({ kind: 'pdf' }));
    messages.fire({ type: PDF_DOCUMENT, kind: 'pdf' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.fire(tab);
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect((await ctx()).kind).toBe('pdf');
    expect(toggle).not.toHaveBeenCalled();
  });
  it('classifies a loaded HTML page via its MIME and uses only the overlay, even with no cached kind', async () => {
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    action.fire(tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('will not grant access to a page that was not clicked, or to content-script senders', async () => {
    expect((await ctx()).kind).toBe('none'); action.fire(tab);
    expect(await ctx({ id: 'ext', url: tab.url })).toBeNull();
    expect((await ctx(panel, 9)).kind).toBe('none');
  });
  it('ignores same-document loading and hash updates, and only forgets on navigation, tab removal, or a mid-ping URL change', async () => {
    action.fire(tab);
    updated.fire(8, { status: 'loading' });
    expect((await ctx()).kind).toBe('pdf');
    updated.fire(8, { url: `${tab.url}#page=2` });
    expect((await ctx()).kind).toBe('pdf');
    updated.fire(8, { status: 'loading', url: `${tab.url}#page=3` });
    expect((await ctx()).kind).toBe('pdf');
    action.fire(tab); removed.fire(8); expect((await ctx()).kind).toBe('none');
    action.fire(tab);
    setReply(async () => { updated.fire(8, { url: 'https://other.example.org/' }); tabs[8] = { id: 8, url: 'https://other.example.org/' }; return { kind: 'pdf' }; });
    expect((await ctx()).kind).toBe('none');
  });
  it('does not drop a grant when the PDF viewer reports its own chrome-extension URL but the tab is still the document', async () => {
    action.fire(tab);
    updated.fire(8, { url: 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html' });
    await flush();
    expect((await ctx()).kind).toBe('pdf');
  });
  it('forgets the grant when a non-public URL update is a real navigation away from the document', async () => {
    action.fire(tab);
    tabs[8] = { id: 8, url: 'chrome://settings' };
    updated.fire(8, { url: 'chrome://settings' });
    await flush();
    expect((await ctx()).kind).toBe('none');
  });
  it('keeps an explicit selection across service-worker suspension without retaining PDF data, including visual-session lookup', async () => {
    action.fire(tab); const first = await ctx();
    action.clear(); messages.clear(); updated.clear(); removed.clear(); command.clear(); connect.clear();
    installPdfEntry(async (id) => { await toggle(id); });
    await flush();
    const restored = await ctx(); expect(restored.grant.token).toBe(first.grant.token);
    expect(Object.keys(session).sort()).toEqual(['pdf-authorization:8', 'pdf-document:8']); expect(session['pdf-authorization:8']).not.toHaveProperty('content');
    const port = { sender: panel, disconnect: disconnect, postMessage: vi.fn(), onMessage: event(), onDisconnect: event() };
    connect.fire(port);
    port.onMessage.fire({ type: 'register', url: first.grant.url, token: first.grant.token, catalog: [{ page: 1, chars: 1, hasImages: false }], pageByAnchor: { p1: 1 } });
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    const closeReply = await new Promise<any>((resolve) => { messages.fire({ type: PDF_VISUAL_CLOSE, url: first.grant.url, token: first.grant.token }, panel, resolve); });
    expect(closeReply).toEqual({ ok: true });
    updated.fire(8, { url: 'https://other.example.org/doc' });
    tabs[8] = { id: 8, url: 'https://other.example.org/doc' };
    await flush();
    expect((await ctx()).kind).toBe('none');
  });
  it('rejects restricted schemes, private URLs and stale grants, and lets a new click renew a grant', async () => {
    action.fire({ id: 8, url: 'chrome://settings' }); expect(open).not.toHaveBeenCalled();
    action.fire({ id: 8, url: 'http://127.0.0.1/doc' }); expect(open).not.toHaveBeenCalled();
    action.fire({ id: 8, url: 'file:///tmp/doc.pdf' }); expect(open).not.toHaveBeenCalled();
    action.fire(tab); const first = await ctx();
    const now = Date.now(); const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    expect((await ctx()).kind).toBe('none'); spy.mockRestore();
    action.fire(tab); const renewed = await ctx();
    expect(renewed.kind).toBe('pdf'); expect(renewed.grant.token).toBeTruthy(); expect(renewed.grant.token).not.toBe(first.grant.token);
  });
  it('binds context to the panel tab, not whichever tab lastFocusedWindow would return', async () => {
    action.fire(tab);
    tabs[9] = { id: 9, url: 'https://other.example.org/page' };
    expect((await ctx(panel, 8)).kind).toBe('pdf');
    expect((await ctx(panel, 9)).kind).toBe('none');
  });
  it('accepts the panel URL with a tab query string and rejects a context request with no tab id', async () => {
    expect(isPdfPanelUrl('chrome-extension://ext/pdf-panel.html?tab=8', 'chrome-extension://ext/pdf-panel.html')).toBe(true);
    action.fire(tab);
    const handled = await new Promise<any>((resolve) => {
      const ok = messages.fire({ type: PDF_CONTEXT }, panel, resolve).some(Boolean);
      if (!ok) resolve(null);
    });
    expect(handled.kind).toBe('none');
  });
  it('disables the global side panel at startup so it cannot follow ordinary tabs', () => {
    expect(setOptions).toHaveBeenCalledWith({ enabled: false });
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
  it('enables a tab-specific panel and opens it in the same user-gesture turn, without awaiting setOptions', () => {
    let finish: (v?: void) => void = () => {};
    setOptions.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    action.fire(tab);
    expect(setOptions).toHaveBeenCalledWith({ tabId: 8, path: 'pdf-panel.html?tab=8', enabled: true });
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    const enable = setOptions.mock.calls.findIndex((c) => c[0] && typeof c[0] === 'object' && 'tabId' in c[0] && c[0].enabled === true);
    expect(enable).toBeGreaterThanOrEqual(0);
    expect(setOptions.mock.invocationCallOrder[enable]!).toBeLessThan(open.mock.invocationCallOrder[0]!);
    finish();
  });
  it("disables that tab's panel on navigation and does not enable a global panel for a known webpage", async () => {
    action.fire(tab);
    tabs[8] = { id: 8, url: 'https://other.example.org/' };
    tab = tabs[8];
    updated.fire(8, { url: 'https://other.example.org/' });
    expect(setOptions).toHaveBeenCalledWith({ tabId: 8, enabled: false });
    expect(close).toHaveBeenCalledWith({ tabId: 8 });
    setOptions.mockClear(); open.mockClear();
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.fire({ id: 8, url: tab.url });
    await flush();
    expect(open).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith(8);
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
});

describe('shared keyboard shortcut routing', () => {
  it('uses the existing toggle-overlay command to open the PDF sidebar on the same path as the toolbar', async () => {
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(toggle).not.toHaveBeenCalled();
    expect((await ctx()).kind).toBe('pdf');
  });
  it('keeps the command on the overlay path for a known webpage and does not open a sidebar', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('does not query or open when the command has no tab, so a user-gesture gap is not introduced', () => {
    command.fire(TOGGLE_COMMAND);
    expect(open).not.toHaveBeenCalled();
  });
  it('opens the sidebar in the same turn as the command, before any async work', () => {
    let finish: (v?: void) => void = () => {};
    setOptions.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    finish();
  });
});

describe('ordinary webpages use only the in-page overlay', () => {
  it('keeps the command on the overlay when the tab URL differs from the announcement only by a hash', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    command.fire(TOGGLE_COMMAND, { id: 8, url: `${tab.url}#section` });
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
  it('keeps the toolbar on the overlay when the announcement URL carries a hash the tab URL does not', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: `${tab.url}#top` }, () => {});
    action.fire(tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('keeps the command on the overlay after a same-tab history URL change on a known HTML document', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    const next = 'https://files.example.org/article';
    tabs[8] = { id: 8, url: next };
    updated.fire(8, { url: next });
    command.fire(TOGGLE_COMMAND, { id: 8, url: next });
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
  it('does not open a sidebar when a previously announced HTML tab is used after a worker restart', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.clear(); messages.clear(); updated.clear(); removed.clear(); command.clear(); connect.clear();
    setOptions.mockClear(); open.mockClear();
    (toggle as ReturnType<typeof vi.fn>).mockClear();
    installPdfEntry(async (id) => { await toggle(id); });
    await flush();
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('on an unknown public page that pings as HTML, toggles only the overlay and does not open a sidebar', async () => {
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
  it('after a real navigation away from a PDF, a newly announced HTML document only uses the overlay', async () => {
    action.fire(tab);
    const htmlUrl = 'https://other.example.org/page';
    tabs[8] = { id: 8, url: htmlUrl };
    updated.fire(8, { status: 'loading', url: htmlUrl });
    setOptions.mockClear(); open.mockClear();
    (toggle as ReturnType<typeof vi.fn>).mockClear();
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: htmlUrl }, () => {});
    command.fire(TOGGLE_COMMAND, { id: 8, url: htmlUrl });
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('disables a leftover tab panel when the tab finishes a navigation as HTML', async () => {
    action.fire(tab);
    const htmlUrl = 'https://other.example.org/page';
    tabs[8] = { id: 8, url: htmlUrl };
    updated.fire(8, { status: 'loading', url: htmlUrl });
    expect(setOptions).toHaveBeenCalledWith({ tabId: 8, enabled: false });
    setOptions.mockClear(); open.mockClear();
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: htmlUrl }, () => {});
    expect(setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    command.fire(TOGGLE_COMMAND, { id: 8, url: htmlUrl });
    expect(open).not.toHaveBeenCalled();
  });
  it('still opens only the sidebar for a public PDF URL with no suffix, including after a hash-only HTML announcement would have mismatched', () => {
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('keeps an in-page application/pdf document on the sidebar and does not open the overlay', () => {
    messages.fire({ type: PDF_DOCUMENT, kind: 'pdf' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    command.fire(TOGGLE_COMMAND, { id: 8, url: `${tab.url}#page=2` });
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('classifies HTML on the first command of a cold worker without waiting for session hydrate', async () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.clear(); messages.clear(); updated.clear(); removed.clear(); command.clear(); connect.clear();
    setOptions.mockClear(); open.mockClear();
    (toggle as ReturnType<typeof vi.fn>).mockClear();
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    installPdfEntry(async (id) => { await toggle(id); });
    // Intentionally no flush: hydrate is still pending. Classification uses the MIME callback.
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(toggle).toHaveBeenCalledWith(8);
  });
  it('does not open a PDF sidebar while the tab is still loading, even for a public URL with no cached kind', () => {
    command.fire(TOGGLE_COMMAND, { ...tab, status: 'loading' });
    expect(open).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('drops HTML kind on a same-URL reload and opens the sidebar once a native PDF has finished loading, without revoking a same-URL grant', async () => {
    action.fire(tab);
    const token = (await ctx()).grant.token;
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    updated.fire(8, { status: 'loading', url: tab.url });
    expect((await ctx()).kind).toBe('pdf');
    expect((await ctx()).grant.token).toBe(token);
    setOptions.mockClear(); open.mockClear();
    (toggle as ReturnType<typeof vi.fn>).mockClear();
    command.fire(TOGGLE_COMMAND, { ...tab, status: 'loading' });
    expect(open).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    mime = 'application/pdf'; setReply(noReceiver);
    command.fire(TOGGLE_COMMAND, { ...tab, status: 'complete' });
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('opens PDF in the MIME inspection callback, not before it or in a later Promise continuation', () => {
    let resume: ((results: chrome.scripting.InjectionResult[]) => void) | undefined;
    execute.mockImplementation((_injection, callback) => { resume = callback; });
    command.fire(TOGGLE_COMMAND, tab);
    expect(open).not.toHaveBeenCalled();
    resume?.([{ frameId: 0, documentId: 'doc-8', result: { url: tab.url, mime: 'application/pdf' } }]);
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
    expect(toggle).not.toHaveBeenCalled();
  });
  it('consumes a context grant once so two concurrent HTML classifications cannot both toggle the overlay', async () => {
    action.fire(tab);
    const pending: Array<() => void> = [];
    chrome.tabs.get = ((id: number) => new Promise((resolve, reject) => {
      const t = tabs[id];
      if (!t) { reject(new Error('no tab')); return; }
      pending.push(() => resolve(t as chrome.tabs.Tab));
    })) as typeof chrome.tabs.get;
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    const first = ctx();
    const second = ctx();
    await flush();
    expect(pending.length).toBe(2);
    const wave1 = pending.splice(0, pending.length);
    wave1.forEach((fn) => fn());
    await flush();
    expect(pending.length).toBe(2);
    const wave2 = pending.splice(0, pending.length);
    wave2.forEach((fn) => fn());
    const results = await Promise.all([first, second]);
    expect(results.filter((r) => r.kind === 'web')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'none')).toHaveLength(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('after a same-URL reload from announced HTML to a native PDF, the command opens the sidebar instead of a dead overlay', () => {
    mime = 'text/html'; messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    updated.fire(8, { status: 'loading', url: tab.url });
    (toggle as ReturnType<typeof vi.fn>).mockClear();
    open.mockClear();
    mime = 'application/pdf';
    command.fire(TOGGLE_COMMAND, { ...tab, status: 'complete' });
    expect(toggle).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith({ tabId: 8 });
  });
});


describe('affirmative document inspection and missing content-script recovery', () => {
  it('recovers an installation-before-open HTML tab without refreshing or opening PDF UI', async () => {
    mime = 'text/html';
    setReply(noReceiver);
    command.fire(TOGGLE_COMMAND, tab);
    await flush();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8, documentIds: ['document-8'] }, files: ['content-scripts/content.js'],
    }));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(8);
    expect(open).not.toHaveBeenCalled();
    expect(title).toHaveBeenLastCalledWith({ tabId: 8, title: 'Representer' });
  });
  it.each(['https://example.com/', 'https://example.com/#hash'])('uses only overlay for positively inspected HTML %s', async (url) => {
    tab.url = url; mime = 'text/html';
    setReply(noReceiver);
    action.fire(tab); await flush();
    expect(open).not.toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('does not inject the content bundle again when its live receiver already exists', async () => {
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    action.fire(tab); await flush();
    expect(execute.mock.calls.filter(([injection]) => injection.files)).toHaveLength(0);
    expect(toggle).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('coalesces overlapping missing-script recovery rather than injecting or toggling twice', async () => {
    mime = 'text/html'; setReply(noReceiver);
    action.fire(tab); command.fire(TOGGLE_COMMAND, tab); await flush();
    expect(execute.mock.calls.filter(([injection]) => injection.files)).toHaveLength(1);
    expect(toggle).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('does not mistake Chrome inspection denial for a PDF, and exposes a bounded non-sensitive error', async () => {
    execute.mockImplementation((_injection, callback) => {
      Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: { message: 'Denied https://private.example.org/?secret=token' } });
      callback();
      Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: undefined });
    });
    action.fire(tab); action.fire(tab); await flush();
    expect(open).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
    expect(badge).toHaveBeenCalledWith({ tabId: 8, text: '!' });
    expect(title).toHaveBeenLastCalledWith({ tabId: 8, title: expect.stringContaining('No PDF panel was opened') });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('[representer] entry failed', { code: 'document-unavailable' });
  });
  it('does not open PDF for an absent or malformed inspection result', () => {
    execute.mockImplementation((_injection, callback) => callback([{ frameId: 0, result: { url: tab.url } }]));
    action.fire(tab);
    expect(open).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
    expect(badge).toHaveBeenCalledWith({ tabId: 8, text: '!' });
  });
  it('reports failed HTML bundle injection without falling back to a PDF panel or claiming overlay success', async () => {
    mime = 'text/html'; setReply(noReceiver);
    execute.mockImplementation((injection, callback) => {
      if (injection.files) return Promise.reject(new Error('Denied'));
      callback([{ frameId: 0, documentId: 'document-8', result: { url: tab.url, mime } }]);
    });
    action.fire(tab); await flush();
    expect(open).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('[representer] entry failed', { code: 'webpage-unavailable' });
  });
  it('records positively confirmed PDF after successful open, but invalidates kind on document loading', async () => {
    action.fire(tab); await flush();
    expect(session['pdf-document:8']).toEqual({ tabId: 8, url: tab.url, kind: 'pdf' });
    execute.mockClear(); open.mockClear();
    command.fire(TOGGLE_COMMAND, tab);
    expect(execute).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledExactlyOnceWith({ tabId: 8 });
    updated.fire(8, { status: 'loading' });
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    command.fire(TOGGLE_COMMAND, tab); await flush();
    expect(execute).toHaveBeenCalled(); expect(toggle).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('reports sidePanel.open rejection instead of swallowing it', async () => {
    open.mockRejectedValue(new Error('sidePanel.open() may only be called in response to a user gesture.'));
    action.fire(tab); await flush();
    expect(console.warn).toHaveBeenCalledWith('[representer] entry failed', { code: 'pdf-user-gesture' });
    expect(title).toHaveBeenLastCalledWith({ tabId: 8, title: expect.stringContaining('Click the toolbar button') });
    expect(session['pdf-authorization:8']).toBeUndefined();
  });
  it('does not open a panel for a late MIME callback after a navigation or tab removal', () => {
    let resume: ((results: chrome.scripting.InjectionResult[]) => void) | undefined;
    execute.mockImplementation((_injection, callback) => { resume = callback; });
    action.fire(tab);
    updated.fire(8, { status: 'loading', url: 'https://example.com/next' });
    resume?.([{ frameId: 0, documentId: 'old-doc', result: { url: tab.url, mime: 'application/pdf' } }]);
    expect(open).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
    action.fire(tab); removed.fire(8);
    resume?.([{ frameId: 0, documentId: 'old-doc', result: { url: tab.url, mime: 'application/pdf' } }]);
    expect(open).not.toHaveBeenCalled();
  });
  it('keeps a command bound to the provided tab, never a different active window or panel tab', async () => {
    tabs[9] = { id: 9, url: 'https://example.com/page', status: 'complete' }; mime = 'text/html';
    setReply(() => ({ kind: 'html' }));
    command.fire(TOGGLE_COMMAND, tabs[9]); await flush();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 9, frameIds: [0] } }), expect.any(Function));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(9); expect(open).not.toHaveBeenCalled();
  });
});


describe('document-pinned overlay delivery', () => {
  it('passes the inspected document id through to the overlay sender', async () => {
    action.clear(); messages.clear(); updated.clear(); removed.clear(); command.clear(); connect.clear();
    const deliver = vi.fn(async () => {});
    installPdfEntry(deliver);
    mime = 'text/html'; setReply(() => ({ kind: 'html' }));
    command.fire(TOGGLE_COMMAND, tab); await flush();
    expect(deliver).toHaveBeenCalledExactlyOnceWith(8, 'document-8');
    expect(open).not.toHaveBeenCalled();
  });
});
