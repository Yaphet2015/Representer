import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../components/bus', () => ({ bus: { emit: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('../components/App', () => ({ App: () => null }));
vi.mock('../components/i18n', () => ({ LangProvider: () => null }));
vi.mock('../lib/diag-cs', () => ({ installDiag: vi.fn() }));
vi.mock('../lib/panel-css', () => ({ PANEL_SHADOW: {} }));
vi.mock('../lib/frame-bridge', () => ({ installFrameWorker: () => () => {} }));
vi.mock('../lib/messages', () => ({ TOGGLE: { type: 'TOGGLE' }, rpc: vi.fn() }));
vi.mock('../lib/content-init', () => ({ claimContentInitialization: () => true }));

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function load(mime: string, shortcut = '') {
  const { rpc } = await import('../lib/messages');
  vi.mocked(rpc).mockResolvedValue({ ok: true, shortcut });
  const doc = Object.assign(new EventTarget(), { contentType: mime, hidden: false });
  const win = new EventTarget();
  Object.defineProperty(win, 'top', { get: () => win });
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { platform: 'Linux' });
  const listeners: Array<(msg: unknown, sender: object, reply: (x: unknown) => void) => void> = [];
  const sendMessage = vi.fn(async () => {});
  vi.stubGlobal('chrome', { runtime: { sendMessage, onMessage: { addListener: (f: typeof listeners[number]) => listeners.push(f), removeListener: vi.fn() } } });
  const mount = vi.fn(), remove = vi.fn();
  const create = vi.fn(async () => ({ mount, remove }));
  vi.stubGlobal('createShadowRootUi', create);
  type Context = { readonly isInvalid: boolean; signal: AbortSignal; onInvalidated: (f: () => void) => void; addEventListener: (target: EventTarget, name: string, cb: EventListener) => void };
  const captured: { main?: (ctx: Context) => Promise<void> } = {};
  vi.stubGlobal('defineContentScript', (config: { main: (ctx: Context) => Promise<void> }) => { captured.main = config.main; return config; });
  await import('../entrypoints/content/index');
  const controller = new AbortController();
  let orphaned = false, reads = 0;
  // Real WXT semantics: invalidation isn't pushed on disable; reading isInvalid discovers it.
  const ctx: Context = {
    get isInvalid() { reads++; if (orphaned) controller.abort(); return controller.signal.aborted; },
    signal: controller.signal,
    onInvalidated(f) { controller.signal.addEventListener('abort', f); },
    addEventListener(target, name, cb) { target.addEventListener(name, cb, { signal: controller.signal }); },
  };
  if (!captured.main) throw new Error('Content entry not registered');
  await captured.main(ctx); await Promise.resolve();
  const press = () => {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperties(e, { key: { value: 'e' }, ctrlKey: { value: true } });
    win.dispatchEvent(e); return e;
  };
  return { create, mount, listeners, sendMessage, press, ctx, orphan: () => { orphaned = true; }, reads: () => reads };
}

it('HTML with an unassigned command still uses the page fallback', async () => {
  const p = await load('text/html');
  expect(p.press().defaultPrevented).toBe(true);
  await flush(); expect(p.mount).toHaveBeenCalledOnce();
  expect(p.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'html' }));
});
it('HTML with a Chrome-assigned command leaves keydown to Chrome', async () => {
  const p = await load('text/html', 'Ctrl+E');
  expect(p.press().defaultPrevented).toBe(false); expect(p.create).not.toHaveBeenCalled();
});
it('an orphaned content script does not swallow Ctrl+E or create an overlay', async () => {
  const p = await load('text/html'); p.orphan();
  expect(p.press().defaultPrevented).toBe(false); expect(p.ctx.signal.aborted).toBe(true);
  expect(p.create).not.toHaveBeenCalled();
});
it('affirmative PDF announces PDF and never mounts a webpage overlay from keydown or TOGGLE', async () => {
  const p = await load('application/pdf');
  expect(p.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf' }));
  expect(p.press().defaultPrevented).toBe(false);
  for (const listener of p.listeners) listener({ type: 'TOGGLE' }, {}, () => {});
  expect(p.create).not.toHaveBeenCalled();
});
it('a late TOGGLE in an invalid context cannot mount an overlay', async () => {
  const p = await load('text/html'); p.orphan();
  for (const listener of p.listeners) listener({ type: 'TOGGLE' }, {}, () => {});
  expect(p.create).not.toHaveBeenCalled();
});

it('an already mounted HTML overlay cannot be reopened by the orphaned keydown listener', async () => {
  const { bus } = await import('../components/bus');
  vi.mocked(bus.emit).mockClear();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const p = await load('text/html'); p.press(); await flush();
  expect(p.mount).toHaveBeenCalledOnce();
  now.mockReturnValue(1500); p.orphan();
  expect(p.press().defaultPrevented).toBe(false);
  expect(bus.emit).not.toHaveBeenCalled();
});
