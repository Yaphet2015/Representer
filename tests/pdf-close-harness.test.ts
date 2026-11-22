import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPdfContext, PDF_CONTEXT, PDF_DOCUMENT } from '../lib/pdf-contract';
import { recordEntryTrace } from '../lib/pdf-entry-trace';

vi.mock('../lib/pdf-entry-trace', async (original) => ({
  ...await original<typeof import('../lib/pdf-entry-trace')>(), recordEntryTrace: vi.fn(),
}));
function event<Args extends unknown[], Result = void>() {
  const listeners: Array<(...args: Args) => Result> = [];
  return { addListener: (f: (...args: Args) => Result) => listeners.push(f), fire: (...args: Args) => listeners.map((f) => f(...args)) };
}
type Sender = Pick<chrome.runtime.MessageSender, 'id' | 'url' | 'frameId' | 'documentId'> & { tab?: { id: number } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function harness(trace: boolean) {
  vi.stubEnv('VITE_RP_ENTRY_DIAG', trace ? '1' : '0');
  vi.mocked(recordEntryTrace).mockClear();
  const action = event<[{ id: number; url: string; status: string }]>();
  const command = event<[string, { id: number; url: string; status: string }]>();
  const messages = event<[unknown, Sender, (v: unknown) => void], boolean | void>();
  const updated = event<[number, chrome.tabs.OnUpdatedInfo]>(), removed = event<[number]>();
  const tab = { id: 8, url: 'https://files.example.org/no-suffix', status: 'complete', active: true };
  const session: Record<string, unknown> = {};
  const open = vi.fn(async () => {}), close = vi.fn(async () => {}), setOptions = vi.fn(async (_options: unknown) => {});
  const toggle = vi.fn(async () => {});
  let ping: 'none' | 'pdf' | 'html' = 'none';
  const executeScript = vi.fn((_options: unknown, callback: (v: unknown) => void) => callback([
    { frameId: 0, documentId: 'inspected-doc', result: { url: tab.url, mime: 'application/pdf' } },
  ]));
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', getURL: (s: string) => `chrome-extension://ext${s}`, onMessage: messages,
      onConnect: { addListener: vi.fn() }, sendMessage: async () => {} },
    action: { onClicked: action, setBadgeText: async () => {}, setTitle: async () => {} },
    commands: { onCommand: command },
    tabs: { get: async () => tab, onUpdated: updated, onRemoved: removed,
      sendMessage: async () => { if (ping === 'none') throw new Error('no receiver'); return { kind: ping }; } },
    sidePanel: { open, close, setOptions, setPanelBehavior: async () => {} }, scripting: { executeScript },
    storage: { session: {
      get: async (k: string | null) => k === null ? { ...session } : { [k]: session[k] },
      set: async (v: Record<string, unknown>) => { Object.assign(session, v); },
      remove: async (k: string) => { delete session[k]; },
    } },
  });
  const { installPdfEntry } = await import('../lib/pdf-entry');
  installPdfEntry(toggle); await flush();
  const context = async () => {
    const response = await new Promise<unknown>((resolve) => messages.fire({ type: PDF_CONTEXT, tabId: 8 },
      { id: 'ext', url: 'chrome-extension://ext/pdf-panel.html?tab=8' }, resolve));
    if (!isPdfContext(response)) throw new Error('Bad context response');
    return response;
  };
  const announce = (frameId = 0, documentId = 'inspected-doc', url = tab.url) => messages.fire(
    { type: PDF_DOCUMENT, kind: 'html' }, { id: 'ext', frameId, documentId, url, tab: { id: 8 } }, () => {});
  const clearEffects = () => { close.mockClear(); setOptions.mockClear(); vi.mocked(recordEntryTrace).mockClear(); };
  return { action, command, updated, removed, tab, open, close, setOptions, toggle, context, announce,
    executeScript, clearEffects, setPing: (p: typeof ping) => { ping = p; } };
}

for (const trace of [false, true]) describe(`real router teardown harness, diagnostic=${trace}`, () => {
  it('does not close on repeated no-receiver PDF_CONTEXT, parse-end validation, or expired grant', async () => {
    const h = await harness(trace); h.action.fire(h.tab); await flush();
    expect((await h.context()).kind).toBe('pdf'); h.clearEffects();
    expect((await h.context()).kind).toBe('pdf');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
    expect((await h.context()).kind).toBe('none');
    expect(h.close).not.toHaveBeenCalled(); expect(h.setOptions).not.toHaveBeenCalled();
  });
  it('accepts a late top-frame HTML announce over a known PDF and disables it without revoking the grant', async () => {
    const h = await harness(trace); h.action.fire(h.tab); await flush();
    const before = await h.context(); expect(before.kind).toBe('pdf'); h.clearEffects();
    h.announce(); await flush();
    expect(h.setOptions).toHaveBeenCalledExactlyOnceWith({ tabId: 8, enabled: false });
    expect(h.close).not.toHaveBeenCalled(); expect(await h.context()).toEqual(before);
    if (trace) expect(recordEntryTrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'announce-html', knownKind: 'pdf', hasGrant: true, sameDocument: true, sameInspectedDocument: true,
    }));
    else expect(recordEntryTrace).not.toHaveBeenCalled();
  });
  it('a receiver switching to HTML after initial PDF_CONTEXT causes parse-end validate to forget, disable and close', async () => {
    const h = await harness(trace); h.action.fire(h.tab); await flush();
    expect((await h.context()).kind).toBe('pdf'); h.clearEffects(); h.setPing('html');
    expect((await h.context()).kind).toBe('web');
    expect(h.close).toHaveBeenCalledExactlyOnceWith({ tabId: 8 });
    expect(h.setOptions.mock.calls.map(([o]) => o)).toEqual([{ tabId: 8, enabled: false }, { enabled: false }]);
    expect(h.toggle).toHaveBeenCalledExactlyOnceWith(8); expect((await h.context()).kind).toBe('none');
    h.command.fire('toggle-overlay', h.tab); expect(h.executeScript).toHaveBeenCalledTimes(2);
    expect(h.open).toHaveBeenCalledTimes(2); expect(h.toggle).toHaveBeenCalledTimes(1);
    if (trace) expect(recordEntryTrace).toHaveBeenCalledWith(expect.objectContaining({ stage: 'forget', reason: 'context-handoff' }));
  });
  it('ignores HTML announces from child frames but currently accepts mismatched top document IDs/URLs', async () => {
    const h = await harness(trace); h.action.fire(h.tab); await flush(); h.clearEffects();
    h.announce(1); expect(h.setOptions).not.toHaveBeenCalled(); h.announce(0, 'old-doc', 'https://files.example.org/old');
    expect(h.setOptions).toHaveBeenCalledExactlyOnceWith({ tabId: 8, enabled: false });
    if (trace) expect(recordEntryTrace).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'announce-html', knownKind: 'pdf', sameDocument: false, sameInspectedDocument: false,
    }));
  });
  it('attributes tab removal and real URL navigation to separate forget/disable/close reasons', async () => {
    const h = await harness(trace); h.action.fire(h.tab); await flush(); h.clearEffects();
    h.updated.fire(8, { url: 'https://files.example.org/new' }); await flush(); expect(h.close).toHaveBeenCalledOnce();
    if (trace) expect(recordEntryTrace).toHaveBeenCalledWith(expect.objectContaining({ stage: 'close-request', reason: 'navigation-public' }));
    h.clearEffects(); h.removed.fire(8); await flush(); expect(h.close).toHaveBeenCalledOnce();
    if (trace) expect(recordEntryTrace).toHaveBeenCalledWith(expect.objectContaining({ stage: 'close-request', reason: 'tab-removed' }));
  });
});
