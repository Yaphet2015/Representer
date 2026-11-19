/** Side-panel render RPC for inspect_pdf_page. PDF.js and page bytes stay in the panel, not the service worker. */
import type { PdfPageInfo } from './pdf-text';
import type { PdfRenderBackend, RenderedPdfPageBytes } from './pdf-visual';

export const PDF_VISUAL_PORT = 'pdf-visual';

export type PdfVisualRegister = {
  type: 'register';
  url: string;
  token: string;
  catalog: PdfPageInfo[];
  pageByAnchor: Record<string, number>;
};
export type PdfVisualRenderRequest = { type: 'render'; id: number; page: number };
export type PdfVisualRenderSuccess = {
  type: 'rendered';
  id: number;
  page: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  data: ArrayBuffer;
};
export type PdfVisualRenderFailure = { type: 'error'; id: number; error: string };
export type PdfVisualFromPanel = PdfVisualRegister;
export type PdfVisualFromWorker = PdfVisualRenderRequest;
export type PdfVisualFromRenderer = PdfVisualRenderSuccess | PdfVisualRenderFailure;

export function isPdfVisualRegister(v: unknown): v is PdfVisualRegister {
  if (!v || typeof v !== 'object' || !('type' in v) || v.type !== 'register') return false;
  if (!('url' in v) || typeof v.url !== 'string' || !('token' in v) || typeof v.token !== 'string') return false;
  if (!('catalog' in v) || !Array.isArray(v.catalog) || !('pageByAnchor' in v) || typeof v.pageByAnchor !== 'object' || !v.pageByAnchor) return false;
  return true;
}

export function isPdfVisualRenderRequest(v: unknown): v is PdfVisualRenderRequest {
  return !!v && typeof v === 'object' && 'type' in v && v.type === 'render' && 'id' in v && Number.isInteger(v.id) && 'page' in v && Number.isInteger(v.page);
}

export function isPdfVisualRenderResult(v: unknown): v is PdfVisualRenderSuccess | PdfVisualRenderFailure {
  if (!v || typeof v !== 'object' || !('type' in v) || !('id' in v) || !Number.isInteger(v.id)) return false;
  if (v.type === 'error') return 'error' in v && typeof v.error === 'string';
  if (v.type !== 'rendered') return false;
  return 'page' in v && Number.isInteger(v.page) && 'width' in v && 'height' in v && 'mimeType' in v && (v.mimeType === 'image/png' || v.mimeType === 'image/jpeg') && 'data' in v && v.data instanceof ArrayBuffer;
}

export type VisualPortLike = {
  postMessage(msg: unknown): void;
  onMessage: { addListener(f: (msg: unknown) => void): void };
  onDisconnect: { addListener(f: () => void): void };
};

/** A render backend that asks the PDF panel to paint one page. Bytes never enter the worker. */
export function panelRenderBackend(port: VisualPortLike): PdfRenderBackend {
  let next = 0;
  const pending = new Map<number, { resolve: (v: RenderedPdfPageBytes) => void; reject: (e: Error) => void }>();
  let closed = false;
  const failAll = (reason: string) => {
    for (const job of pending.values()) job.reject(new Error(reason));
    pending.clear();
  };
  port.onMessage.addListener((msg: unknown) => {
    if (!isPdfVisualRenderResult(msg)) return;
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    if (msg.type === 'error') job.reject(new Error(msg.error));
    else job.resolve({ page: msg.page, width: msg.width, height: msg.height, mimeType: msg.mimeType, bytes: new Uint8Array(msg.data) });
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    failAll('The PDF side panel disconnected before the page image was ready. Keep the sidebar open to inspect charts.');
  });
  return {
    async render(page, signal) {
      if (closed) throw new Error('The PDF side panel is not connected. Keep the sidebar open to inspect charts.');
      signal?.throwIfAborted();
      const id = ++next;
      const result = new Promise<RenderedPdfPageBytes>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      const onAbort = () => {
        const job = pending.get(id);
        if (!job) return;
        pending.delete(id);
        job.reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        port.postMessage({ type: 'render', id, page } satisfies PdfVisualRenderRequest);
        return await result;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    async close() {
      closed = true;
      failAll('The PDF visual session was closed.');
    },
  };
}
