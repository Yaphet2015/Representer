import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPdfEntry } from '../lib/pdf-entry';
import { PDF_CONTEXT, PDF_DOCUMENT } from '../lib/pdf-contract';

type Listener = (...args: any[]) => any;
function event() { const listeners: Listener[] = []; return { clear() { listeners.length = 0; }, addListener(f: Listener) { listeners.push(f); }, fire(...args: any[]) { return listeners.map((f) => f(...args)); } }; }
let action: ReturnType<typeof event>, messages: ReturnType<typeof event>, updated: ReturnType<typeof event>, removed: ReturnType<typeof event>;
let open: ReturnType<typeof vi.fn>, send: ReturnType<typeof vi.fn>;
let toggle: (id?: number) => Promise<void>;
let session: Record<string, unknown>;
let tab: { id: number; url: string };
beforeEach(() => {
  session = {};
  action = event(); messages = event(); updated = event(); removed = event(); tab = { id: 8, url: 'https://files.example.org/no-extension' };
  open = vi.fn(async () => {}); toggle = vi.fn(async () => {}); send = vi.fn(async () => { throw new Error('No receiver'); });
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', getURL: (p: string) => 'chrome-extension://ext' + p, onMessage: messages, sendMessage: vi.fn(async () => {}) },
    storage: { session: { get: async (k: string) => ({ [k]: session[k] }), set: async (v: Record<string, unknown>) => { Object.assign(session, v); }, remove: async (k: string) => { delete session[k]; } } },
    action: { onClicked: action }, sidePanel: { open, close: vi.fn(async () => {}) },
    tabs: { onUpdated: updated, onRemoved: removed, query: async () => [tab], sendMessage: send },
  });
  installPdfEntry(async (id) => { await toggle(id); });
});
afterEach(() => vi.unstubAllGlobals());
const panel = { id: 'ext', url: 'chrome-extension://ext/pdf-panel.html' };
const ctx = (sender = panel) => new Promise<any>((resolve) => {
  const handled = messages.fire({ type: PDF_CONTEXT }, sender, resolve).some(Boolean); if (!handled) resolve(null);
});

describe('toolbar routing and PDF user-action capability', () => {
  it('opens a side panel in the original action call stack, without a URL fetch, for a native PDF with no suffix', async () => {
    action.fire(tab); expect(open).toHaveBeenCalledWith({ tabId: 8 }); expect(send).not.toHaveBeenCalled();
    const c = await ctx(); expect(c.kind).toBe('pdf'); expect(c.grant.url).toBe(tab.url); expect(c.grant.token).toBeTruthy();
  });
  it('leaves a known normal webpage on the original floating-panel path', () => {
    messages.fire({ type: PDF_DOCUMENT, kind: 'html' }, { frameId: 0, tab: { id: 8 }, url: tab.url }, () => {});
    action.fire(tab); expect(open).not.toHaveBeenCalled(); expect(toggle).toHaveBeenCalledWith(8);
  });
  it('after a worker restart, identifies an ordinary page without fetching it and hands back to the overlay', async () => {
    send.mockResolvedValue({ kind: 'html' }); action.fire(tab);
    expect((await ctx()).kind).toBe('web'); expect(toggle).toHaveBeenCalledWith(8);
    action.fire(tab); expect(open).toHaveBeenCalledTimes(1); // now known; no second classification sidebar
  });
  it('will not grant access to a page that was not clicked, or to content-script senders', async () => {
    expect((await ctx()).kind).toBe('none'); action.fire(tab);
    expect(await ctx({ id: 'ext', url: tab.url })).toBeNull();
    tab = { id: 9, url: tab.url }; expect((await ctx()).kind).toBe('none');
  });
  it('invalidates on reload/navigation/tab removal, including changes during a pending ping', async () => {
    action.fire(tab); updated.fire(8, { status: 'loading' }); expect((await ctx()).kind).toBe('none');
    action.fire(tab); removed.fire(8); expect((await ctx()).kind).toBe('none');
    action.fire(tab);
    send.mockImplementation(async () => { updated.fire(8, { url: 'https://other.example.org/' }); return { kind: 'pdf' }; });
    expect((await ctx()).kind).toBe('none');
  });
  it('keeps an explicit selection across service-worker suspension without retaining PDF data', async () => {
    action.fire(tab); const first = await ctx();
    action.clear(); messages.clear(); updated.clear(); removed.clear(); // a new worker, same session storage
    installPdfEntry(async (id) => { await toggle(id); });
    const restored = await ctx(); expect(restored.grant.token).toBe(first.grant.token);
    expect(Object.keys(session)).toEqual(['pdf-authorization:8']); expect(session['pdf-authorization:8']).not.toHaveProperty('content');
    updated.fire(8, { status: 'loading' }); expect((await ctx()).kind).toBe('none');
  });
  it('rejects restricted schemes, private URLs and stale grants', async () => {
    action.fire({ id: 8, url: 'chrome://settings' }); expect(open).not.toHaveBeenCalled();
    action.fire({ id: 8, url: 'http://127.0.0.1/doc' }); expect(open).not.toHaveBeenCalled();
    action.fire(tab); const now = Date.now(); const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    expect((await ctx()).kind).toBe('none'); spy.mockRestore();
  });
});
