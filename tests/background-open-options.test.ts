import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

it('the worker opens the options page when it receives openOptions', async () => {
  const onMessage: Array<(msg: unknown, sender: object, reply: (r: unknown) => void) => unknown> = [];
  const event = () => ({ addListener: vi.fn() });
  const pending = () => new Promise<never>(() => {});
  const openOptionsPage = vi.fn(async () => {});
  vi.stubEnv('VITE_RP_ENTRY_DIAG', '0');
  vi.stubGlobal('defineBackground', (main: () => void) => main);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext',
      onMessage: { addListener: (f: (typeof onMessage)[number]) => onMessage.push(f) },
      onConnect: event(),
      sendMessage: async () => {},
      getURL: (path: string) => `chrome-extension://ext${path}`,
      openOptionsPage,
    },
    storage: { local: { get: vi.fn(pending) }, session: { get: vi.fn(pending), set: async () => {}, remove: async () => {} } },
    action: { onClicked: event(), setBadgeText: async () => {}, setTitle: async () => {} },
    commands: { onCommand: { addListener: vi.fn() } },
    sidePanel: { setOptions: vi.fn(pending), setPanelBehavior: vi.fn(pending), open: vi.fn(async () => {}),
      onClosed: { addListener: vi.fn() }, onOpened: { addListener: vi.fn() } },
    tabs: { get: async (id: number) => ({ id, active: true }), onUpdated: event(), onRemoved: event(), query: vi.fn(), sendMessage: async () => {} },
    scripting: { executeScript: vi.fn() },
  });

  const start: unknown = (await import('../entrypoints/background')).default;
  expect(typeof start).toBe('function');
  if (typeof start !== 'function') throw new Error('Worker main must be synchronous');
  expect(start()).toBeUndefined();
  expect(onMessage.length).toBeGreaterThanOrEqual(1);
  expect(openOptionsPage).not.toHaveBeenCalled();

  const replies: unknown[] = [];
  const accepted = onMessage.map((listen) => listen({ type: 'openOptions' }, {}, (r) => replies.push(r)));
  expect(accepted).toContain(true);
  await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(replies).toContainEqual({ ok: true }));
});
