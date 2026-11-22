import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../components/App', () => ({ App: () => null }));
vi.mock('../components/i18n', () => ({ LangProvider: () => null }));
vi.mock('../lib/diag-cs', () => ({ installDiag: vi.fn() }));
vi.mock('../lib/panel-css', () => ({ PANEL_SHADOW: {} }));
vi.mock('../lib/frame-bridge', () => ({ installFrameWorker: () => () => {} }));
vi.mock('../lib/content-init', () => ({ claimContentInitialization: () => true }));

function event<Args extends unknown[], Result = void>() {
  const listeners: Array<(...args: Args) => Result> = [];
  return { addListener: (f: (...args: Args) => Result) => listeners.push(f),
    removeListener: (f: (...args: Args) => Result) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    fire: (...args: Args) => listeners.map((f) => f(...args)) };
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let dispose = () => {};
afterEach(() => { dispose(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function setup(initialShortcut: string, diagnostic = false) {
  vi.stubEnv('VITE_RP_ENTRY_DIAG', diagnostic ? '1' : '0');
  let shortcut = initialShortcut, clock = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const tab = { id: 8, url: 'https://example.com/', status: 'complete' };
  type MessageListener = (msg: unknown, sender: { id: string; url: string; frameId: number; tab: typeof tab; documentId: string }, reply: (r: unknown) => void) => boolean | void;
  const background = event<Parameters<MessageListener>, ReturnType<MessageListener>>();
  const content = event<Parameters<MessageListener>, ReturnType<MessageListener>>();
  const commands = event<[string, typeof tab]>(), toolbar = event<[typeof tab]>();
  const updates = event<[number, chrome.tabs.OnUpdatedInfo]>();
  let registering: 'background' | 'content' = 'background';
  const sender = { id: 'ext', url: tab.url, tab, frameId: 0, documentId: 'html-doc' };
  const dispatch = (target: typeof background, msg: unknown) => new Promise<unknown>((resolve, reject) => {
    let responded = false;
    const handled = target.fire(msg, sender, (r) => { responded = true; resolve(r); });
    if (!responded && !handled.some(Boolean)) reject(new Error('No receiver'));
  });
  const pendingInspections: Array<(r: unknown) => void> = [];
  const getAll = vi.fn(async () => [{ name: 'toggle-overlay', shortcut }]);
  const setOptions = vi.fn(async () => {}), open = vi.fn(async () => {});
  const session: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext${p}`,
      onMessage: { addListener: (f: MessageListener) => (registering === 'background' ? background : content).addListener(f),
        removeListener: (f: MessageListener) => content.removeListener(f) },
      onConnect: { addListener: vi.fn() }, sendMessage: (msg: unknown) => dispatch(background, msg).catch(() => undefined) },
    commands: { getAll, onCommand: commands },
    action: { onClicked: toolbar, setBadgeText: async () => {}, setTitle: async () => {} },
    sidePanel: { setOptions, open, close: async () => {}, setPanelBehavior: async () => {} },
    scripting: { executeScript: vi.fn((_options: unknown, callback: (r: unknown) => void) => { pendingInspections.push(callback); }) },
    tabs: { sendMessage: (_id: number, msg: unknown) => dispatch(content, msg), get: async () => tab,
      onUpdated: updates, onRemoved: { addListener: vi.fn() } },
    storage: { session: { get: async (k: string | null) => k === null ? { ...session } : { [k]: session[k] },
      set: async (v: Record<string, unknown>) => { Object.assign(session, v); }, remove: async (k: string) => { delete session[k]; } },
      local: { get: async () => ({}) } },
  });
  vi.stubGlobal('defineBackground', (main: () => void) => main);
  const start: unknown = (await import('../entrypoints/background')).default;
  if (typeof start !== 'function') throw new Error('No real worker entry'); start();
  const doc = Object.assign(new EventTarget(), { contentType: 'text/html', hidden: false });
  const win = new EventTarget(); Object.defineProperty(win, 'top', { get: () => win });
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win); vi.stubGlobal('navigator', { platform: 'Linux' });
  const { bus } = await import('../components/bus');
  let visible = false;
  const toggled = vi.fn(() => { visible = !visible; }); dispose = bus.on('toggle', toggled);
  const mount = vi.fn(() => { visible = true; });
  vi.stubGlobal('createShadowRootUi', vi.fn(async () => ({ mount, remove: vi.fn() })));
  type Context = { readonly isInvalid: boolean; signal: AbortSignal; onInvalidated: (f: () => void) => void; addEventListener: (t: EventTarget, n: string, f: EventListener) => void };
  const captured: { main?: (ctx: Context) => Promise<void> } = {};
  vi.stubGlobal('defineContentScript', (c: { main: (ctx: Context) => Promise<void> }) => { captured.main = c.main; return c; });
  registering = 'content'; await import('../entrypoints/content/index');
  const controller = new AbortController();
  if (!captured.main) throw new Error('No real content entry');
  await captured.main({ isInvalid: false, signal: controller.signal,
    onInvalidated: (f) => controller.signal.addEventListener('abort', f),
    addEventListener: (t, n, f) => t.addEventListener(n, f, { signal: controller.signal }) });
  await flush();
  const press = () => {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperties(e, { key: { value: 'e' }, ctrlKey: { value: true } }); win.dispatchEvent(e); return e;
  };
  const resolveInspection = async () => {
    const cb = pendingInspections.shift(); if (!cb) throw new Error('No pending real MIME inspection');
    cb([{ frameId: 0, documentId: 'html-doc', result: { url: tab.url, mime: 'text/html' } }]); await flush();
  };
  return { press, command: () => commands.fire('toggle-overlay', tab), resolveInspection, mount, toggled,
    visible: () => visible, advance: (ms: number) => { clock += ms; }, setShortcut: (s: string) => { shortcut = s; },
    getAll, open, updates, tab, toolbar, session };
}

it('stale NotSet -> CtrlE: keydown first plus a delayed real command must not open then close the overlay', async () => {
  const h = await setup(''); h.setShortcut('Ctrl+E');
  h.press(); await flush(); h.command(); h.advance(500); await h.resolveInspection();
  expect(h.mount).toHaveBeenCalledOnce(); expect(h.toggled).not.toHaveBeenCalled(); expect(h.visible()).toBe(true);
  expect(h.open).not.toHaveBeenCalled();
});
it('stale NotSet -> CtrlE: real command first plus later keydown must not close the overlay', async () => {
  const h = await setup(''); h.setShortcut('Ctrl+E');
  h.command(); await h.resolveInspection(); h.advance(500); h.press(); await flush();
  expect(h.mount).toHaveBeenCalledOnce(); expect(h.toggled).not.toHaveBeenCalled(); expect(h.visible()).toBe(true);
});
it('fresh HTML assigned CtrlE receives exactly one background toggle even across loading/announce', async () => {
  const h = await setup('Ctrl+E'); h.updates.fire(8, { status: 'loading' });
  h.press(); h.command(); await h.resolveInspection();
  expect(h.mount).toHaveBeenCalledOnce(); expect(h.toggled).not.toHaveBeenCalled(); expect(h.visible()).toBe(true);
});
it('unassigned shortcut still supports local fallback, then a second intentional key toggles closed', async () => {
  const h = await setup(''); h.press(); await flush();
  expect(h.visible()).toBe(true); h.advance(500); h.press(); await flush();
  expect(h.toggled).toHaveBeenCalledOnce(); expect(h.visible()).toBe(false);
});
it('CtrlE -> NotSet in the same document restores the local fallback without visibilitychange', async () => {
  const h = await setup('Ctrl+E'); h.setShortcut(''); h.press(); await flush();
  expect(h.mount).toHaveBeenCalledOnce(); expect(h.visible()).toBe(true);
});

it.each([0, 199, 200, 2000])('fresh command ownership prevents duplicate UI even when command delivery is %sms after DOM keydown', async (delay) => {
  const h = await setup(''); h.setShortcut('Ctrl+E'); h.press(); await flush();
  h.command(); h.advance(delay); await h.resolveInspection();
  expect(h.mount).toHaveBeenCalledOnce(); expect(h.toggled).not.toHaveBeenCalled();
  expect(h.getAll).toHaveBeenCalledTimes(2);
});
it('diagnostic records actual HTML message receipt and mounting without new content-storage access', async () => {
  const h = await setup('Ctrl+E', true); h.press(); await flush(); h.command(); await h.resolveInspection();
  await flush(); await flush();
  const { readEntryTrace, ENTRY_TRACE_KEY } = await import('../lib/pdf-entry-trace');
  const stages = readEntryTrace(h.session[ENTRY_TRACE_KEY]).map((r) => r.stage);
  expect(stages).toEqual(expect.arrayContaining(['content-key-command-owned', 'web-toggle-request',
    'content-toggle-message', 'content-mount-request', 'content-mounted', 'web-toggle-resolved']));
  expect(stages).not.toContain('content-toggle-keydown');
});
