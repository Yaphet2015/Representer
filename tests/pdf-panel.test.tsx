// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPanel } from '../components/pdf/PdfPanel';
import { pdfTextDocument } from '../lib/pdf-text';
import { PDF_CONTEXT } from '../lib/pdf-contract';

const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/pdf-read', () => ({ readPdf: read }));
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
  active = true; read.mockReset(); read.mockResolvedValue(pdfTextDocument(['First page. Repeated sentence.', 'Second page. Repeated sentence.'], 5000, 'fixture'));
  document.body.innerHTML = '<div id="root"></div>'; host = document.getElementById('root')!;
  setStorage = vi.fn(() => { throw new Error('must not write settings/cache'); }); connect = vi.fn(() => { throw new Error('must not call model unless user chooses Summarize/Send'); });
  rpc = vi.fn(async (msg) => {
    if (msg.type === PDF_CONTEXT) return active ? { kind: 'pdf', grant } : { kind: 'none' };
    if (msg.type === 'getCached') return { ok: true, cached: { summary } };
    return { ok: false };
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: rpc, connect, openOptionsPage: vi.fn(), onMessage: noListeners() },
    tabs: { onActivated: { addListener: (f: typeof activated) => { activated = f; }, removeListener: vi.fn() }, onUpdated: { addListener: (f: typeof changed) => { changed = f; }, removeListener: vi.fn() } },
    storage: { local: { get: async () => ({}), set: setStorage, remove: setStorage }, onChanged: noListeners() },
  });
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
    const source = host.querySelector<HTMLElement>('[role="button"][aria-label="View PDF source page in sidebar"]'); expect(source).toBeTruthy();
    await act(async () => source!.click()); await settle();
    expect(host.querySelector('[aria-label="PDF page 2"]')).toBeTruthy();
    expect(host.querySelector('pre')?.textContent).toBe('Second page. Repeated sentence.');
    expect(setStorage).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  });
  it('invalidates extracted text on a navigation and does not automatically re-download', async () => {
    await act(async () => root.render(<PdfPanel />)); await settle(); await clickText('Read PDF locally');
    active = false; await act(async () => changed?.(8, { status: 'loading' })); await settle();
    expect(host.textContent).not.toContain('Synthetic summary'); expect(read).toHaveBeenCalledTimes(1); expect(connect).not.toHaveBeenCalled();
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
      return { ok: false };
    });
    await act(async () => activated?.({ tabId: 9 })); await settle();
    expect(host.textContent).toContain('Synthetic summary');
    expect(host.textContent).toContain('2 pages');
    expect(host.textContent).not.toMatch(/Open a public HTTP\(S\) PDF/);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
