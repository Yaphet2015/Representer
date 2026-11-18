// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPanel } from '../components/pdf/PdfPanel';
import { pdfTextDocument } from '../lib/pdf-text';
import { PDF_CONTEXT } from '../lib/pdf-contract';
import { SUMMARY_PORT } from '../lib/messages';
import { VISION_UNSUPPORTED } from '../lib/pdf-visual';

const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/pdf-read', () => ({ readPdf: read }));
vi.mock('@/lib/pdf-render', () => ({
  createPdfRenderBackend: () => ({ render: async (page: number) => ({ page, width: 1, height: 1, mimeType: 'image/png', bytes: new Uint8Array([1]) }), close: async () => {} }),
  webCanvasFactory: () => ({ create: () => ({ canvas: { width: 1, height: 1 }, context: {} }), reset() {}, destroy() {} }),
}));
let root: Root, host: HTMLElement;
let rpc: ReturnType<typeof vi.fn>, connect: ReturnType<typeof vi.fn>, setStorage: ReturnType<typeof vi.fn>;
let changed: ((id: number, info: { status: string }) => void) | undefined;
let activated: ((info: { tabId: number }) => void) | undefined;
let active = true;
const grant = { tabId: 8, url: 'https://files.example.org/doc', token: 'clicked' };
const summary = { overview: 'Synthetic summary', sections: [{ title: 'Second-page finding', icon: 'list', anchor: 'p2', bullets: ['A repeated sentence'], anchors: ['p2'] }] };
function noListeners() { return { addListener: vi.fn(), removeListener: vi.fn() }; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  active = true; read.mockReset(); read.mockResolvedValue({ ...pdfTextDocument(['First page. Repeated sentence.', 'Second page. Repeated sentence.'], 5000, 'fixture'), data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
  document.body.innerHTML = '<div id="root"></div>'; host = document.getElementById('root')!;
  setStorage = vi.fn(() => { throw new Error('must not write settings/cache'); });
  connect = vi.fn((info?: { name?: string }) => {
    if (info?.name === 'pdf-visual') return { name: 'pdf-visual', postMessage: vi.fn(), disconnect: vi.fn(), onMessage: noListeners(), onDisconnect: noListeners() };
    throw new Error('must not call model unless user chooses Summarize/Send');
  });
  rpc = vi.fn(async (msg) => {
    if (msg.type === PDF_CONTEXT) return active ? { kind: 'pdf', grant } : { kind: 'none' };
    if (msg.type === 'getCached') return { ok: true, cached: { summary } };
    if (msg.type === 'rp-pdf-visual-open' || msg.type === 'rp-pdf-visual-close') return { ok: true };
    return { ok: false };
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: rpc, connect, getURL: (p: string) => p, openOptionsPage: vi.fn(), onMessage: noListeners() },
    tabs: { onActivated: { addListener: (f: typeof activated) => { activated = f; }, removeListener: vi.fn() }, onUpdated: { addListener: (f: typeof changed) => { changed = f; }, removeListener: vi.fn() } },
    storage: { local: { get: async () => ({}), set: setStorage, remove: setStorage }, onChanged: noListeners() },
  });
  if (typeof URL.createObjectURL !== 'function') {
    Object.assign(URL, { createObjectURL: () => 'blob:test-pdf-page', revokeObjectURL: () => {} });
  }
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
const settle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
const clickText = async (text: string) => { const b = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)); expect(b).toBeTruthy(); await act(async () => b!.click()); await settle(); };

describe('PDF sidebar interaction (no model or storage writes)', () => {
  it('does not download on open, reads only on click, restores cache and shows the exact page for repeated source text', async () => {
    await act(async () => root.render(<PdfPanel />)); await settle();
    expect(read).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
    await clickText('Read PDF locally'); expect(read).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('2 pages'); expect(host.textContent).toContain('Synthetic summary');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ type: 'getCached', url: 'pdf:v1:https://files.example.org/doc' }));
    expect(connect).toHaveBeenCalledWith({ name: 'pdf-visual' });
    expect(host.textContent).toContain('inspect rendered page images');
    expect(host.textContent).not.toMatch(/Text only/);
    const source = host.querySelector<HTMLElement>('[role="button"][aria-label="View PDF source page in sidebar"]'); expect(source).toBeTruthy();
    await act(async () => source!.click()); await settle();
    expect(host.querySelector('[aria-label="PDF page 2"]')).toBeTruthy();
    expect(host.querySelector('pre')?.textContent).toBe('Second page. Repeated sentence.');
    const img = host.querySelector<HTMLImageElement>('img[alt="Rendered PDF page 2"]');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toMatch(/^(blob:|data:)/);
    expect(setStorage).not.toHaveBeenCalled(); expect(connect.mock.calls.every((c) => c[0]?.name === "pdf-visual")).toBe(true);
  });
  it('invalidates extracted text on a navigation and does not automatically re-download', async () => {
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    active = false; await act(async () => changed?.(8, { status: 'loading' })); await settle();
    expect(host.textContent).not.toContain('Synthetic summary'); expect(read).toHaveBeenCalledTimes(1); expect(connect.mock.calls.every((c) => c[0]?.name === 'pdf-visual')).toBe(true);
  });
  it('does not discard the reader or restart extraction when another tab loads', async () => {
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    await act(async () => changed?.(9, { status: 'loading' })); await settle();
    expect(host.textContent).toContain('Synthetic summary'); expect(read).toHaveBeenCalledTimes(1);
  });
  it('does not drop extracted text or show the idle sidebar when an ordinary tab becomes active', async () => {
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    rpc.mockImplementation(async (msg) => {
      if (msg.type === PDF_CONTEXT) return { kind: 'none' };
      if (msg.type === 'getCached') return { ok: true, cached: { summary } };
      if (msg.type === 'rp-pdf-visual-open' || msg.type === 'rp-pdf-visual-close') return { ok: true };
      return { ok: false };
    });
    await act(async () => activated?.({ tabId: 9 })); await settle();
    expect(host.textContent).toContain('Synthetic summary');
    expect(host.textContent).toContain('2 pages');
    expect(host.textContent).not.toMatch(/Open a public HTTP\(S\) PDF/);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('persists a partial inspect report after summarize and does not imply the whole PDF was seen', async () => {
    rpc.mockImplementation(async (msg) => {
      if (msg.type === PDF_CONTEXT) return active ? { kind: 'pdf', grant } : { kind: 'none' };
      if (msg.type === 'getCached') return { ok: true };
      if (msg.type === 'rp-pdf-visual-open' || msg.type === 'rp-pdf-visual-close') return { ok: true };
      return { ok: false };
    });
    const listeners: Array<(e: unknown) => void> = [];
    connect.mockImplementation((info?: { name?: string }) => {
      if (info?.name === 'pdf-visual') return { name: 'pdf-visual', postMessage: vi.fn(), disconnect: vi.fn(), onMessage: noListeners(), onDisconnect: noListeners() };
      if (info?.name === SUMMARY_PORT) {
        return {
          name: SUMMARY_PORT,
          postMessage: vi.fn(() => { queueMicrotask(() => listeners.forEach((f) => f({ done: true, summary, visualInspect: { inspected: [2], total: 59, budget: 10, remaining: 58 } }))); }),
          disconnect: vi.fn(),
          onMessage: { addListener: (f: (e: unknown) => void) => { listeners.push(f); }, removeListener: vi.fn() },
          onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        };
      }
      throw new Error('unexpected port ' + info?.name);
    });
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    await clickText('Summarize with my model');
    expect(host.textContent).toContain('Synthetic summary');
    expect(host.textContent).toContain('1 of 59');
    expect(host.textContent).toContain('not a full visual reading');
    expect(host.textContent).toContain('not renewable mid-run');
  });
  it('keeps an unsupported-vision failure as an error and does not show a successful overview', async () => {
    rpc.mockImplementation(async (msg) => {
      if (msg.type === PDF_CONTEXT) return active ? { kind: 'pdf', grant } : { kind: 'none' };
      if (msg.type === 'getCached') return { ok: true };
      if (msg.type === 'rp-pdf-visual-open' || msg.type === 'rp-pdf-visual-close') return { ok: true };
      return { ok: false };
    });
    const listeners: Array<(e: unknown) => void> = [];
    connect.mockImplementation((info?: { name?: string }) => {
      if (info?.name === 'pdf-visual') return { name: 'pdf-visual', postMessage: vi.fn(), disconnect: vi.fn(), onMessage: noListeners(), onDisconnect: noListeners() };
      if (info?.name === SUMMARY_PORT) {
        return {
          name: SUMMARY_PORT,
          postMessage: vi.fn(() => { queueMicrotask(() => listeners.forEach((f) => f({ error: VISION_UNSUPPORTED }))); }),
          disconnect: vi.fn(),
          onMessage: { addListener: (f: (e: unknown) => void) => { listeners.push(f); }, removeListener: vi.fn() },
          onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
        };
      }
      throw new Error('unexpected port ' + info?.name);
    });
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    await clickText('Summarize with my model');
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('did not accept page images');
    expect(alert?.textContent).toContain('A text-only fallback was not used');
    expect(alert?.textContent).toContain('Choose a vision-capable');
    expect(host.textContent).not.toContain('Synthetic summary');
  });
});
