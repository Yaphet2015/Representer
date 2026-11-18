/** Lazy-loaded only when a PDF visual session is opened in the service worker. Not imported by content scripts. */
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { createPdfRenderBackend, webCanvasFactory } from './pdf-render';
import { createPdfVisualSession, type PdfVisualSession } from './pdf-visual';
import type { PdfPageInfo } from './pdf-text';

GlobalWorkerOptions.workerSrc = workerUrl;

export function openPdfVisualSession(opts: {
  data: Uint8Array;
  catalog: readonly PdfPageInfo[];
  pageByAnchor: Record<string, number>;
}): PdfVisualSession {
  const backend = createPdfRenderBackend({
    data: opts.data,
    cMapUrl: chrome.runtime.getURL('/pdf-assets/cmaps/'),
    standardFontDataUrl: chrome.runtime.getURL('/pdf-assets/standard_fonts/'),
    canvasFactory: webCanvasFactory(),
  });
  return createPdfVisualSession({ catalog: opts.catalog, pageByAnchor: opts.pageByAnchor, backend });
}
