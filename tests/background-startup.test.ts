import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

it.each([false, true])('the real worker entry registers commands synchronously with trace=%s and pending settings/session/panel APIs', async (trace) => {
  vi.stubEnv('VITE_RP_ENTRY_DIAG', trace ? '1' : '0');
  const commands: Array<(name: string, tab?: { id: number; url: string; status: string }) => void> = [];
  const event = () => ({ addListener: vi.fn() });
  const pending = () => new Promise<never>(() => {});
  const localGet = vi.fn(pending);
  const open = vi.fn(async () => {});
  const panelClosed = vi.fn(), panelOpened = vi.fn();
  const query = vi.fn(() => { throw new Error('Do not query a different tab'); });
  vi.stubGlobal('defineBackground', (main: () => void) => main);
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', onMessage: event(), onConnect: event(), sendMessage: async () => {}, getURL: (path: string) => `chrome-extension://ext${path}` },
    storage: { local: { get: localGet }, session: { get: vi.fn(pending), set: async () => {}, remove: async () => {} } },
    action: { onClicked: event(), setBadgeText: async () => {}, setTitle: async () => {} },
    commands: { onCommand: { addListener: (listener: typeof commands[number]) => commands.push(listener) } },
    sidePanel: { setOptions: vi.fn(pending), setPanelBehavior: vi.fn(pending), open,
      onClosed: { addListener: panelClosed }, onOpened: { addListener: panelOpened } },
    tabs: { get: async (id: number) => ({ id, active: true }), onUpdated: event(), onRemoved: event(), query, sendMessage: async () => {} },
    scripting: { executeScript: (_injection: unknown, callback: (results: unknown) => void) => callback([{ frameId: 0, documentId: 'doc-8', result: { url: 'https://files.example.org/resource', mime: 'application/pdf' } }]) },
  });
  const start: unknown = (await import('../entrypoints/background')).default;
  expect(typeof start).toBe('function');
  if (typeof start !== 'function') throw new Error('Worker main must be synchronous');
  expect(start()).toBeUndefined();
  expect(commands).toHaveLength(1);
  expect(localGet).not.toHaveBeenCalled();
  commands[0]?.('toggle-overlay', { id: 8, url: 'https://files.example.org/resource', status: 'complete' });
  expect(open).toHaveBeenCalledExactlyOnceWith({ tabId: 8 });
  expect(query).not.toHaveBeenCalled();
  expect(panelClosed).not.toHaveBeenCalled(); expect(panelOpened).not.toHaveBeenCalled();
});
