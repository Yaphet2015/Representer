/** Render one PDF page to an image. Loaded only with the PDF panel/parser, never by the webpage bundle. */
import { OPS, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PDF_RENDER_MAX_EDGE = 1280;
export const PDF_RENDER_PNG_SOFT_MAX = 1_200_000;

export type PdfCanvasPair = { canvas: PdfCanvasSurface; context: PdfCanvasContext };
export type PdfCanvasSurface = {
  width: number;
  height: number;
  toBuffer?(mime?: string, opts?: { quality?: number }): Uint8Array;
  convertToBlob?(opts: { type: string; quality?: number }): Promise<Blob>;
  toDataURL?(type?: string, quality?: number): string;
};
export type PdfCanvasContext = { /* pdf.js writes through the standard 2d context */ };
export type PdfCanvasFactory = {
  create(width: number, height: number): PdfCanvasPair;
  reset(pair: PdfCanvasPair, width: number, height: number): void;
  destroy(pair: PdfCanvasPair): void;
};

/** Browser factory (OffscreenCanvas in the side panel or service worker; HTML canvas as a fallback). */
export function webCanvasFactory(): PdfCanvasFactory {
  const make = (width: number, height: number): PdfCanvasPair => {
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('OffscreenCanvas 2d context is not available.');
      return { canvas, context };
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width));
      canvas.height = Math.max(1, Math.ceil(height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2d context is not available.');
      return { canvas, context };
    }
    throw new Error('No canvas is available to render PDF pages in this environment.');
  };
  return {
    create: make,
    reset(pair, width, height) { pair.canvas.width = Math.max(1, Math.ceil(width)); pair.canvas.height = Math.max(1, Math.ceil(height)); },
    destroy(pair) { pair.canvas.width = 0; pair.canvas.height = 0; },
  };
}

export type OpenPdfOptions = { data: Uint8Array; cMapUrl: string; standardFontDataUrl: string; canvasFactory?: PdfCanvasFactory };
export function openPdfDocument(opts: OpenPdfOptions) {
  return getDocument({
    data: opts.data, useSystemFonts: false, cMapUrl: opts.cMapUrl, cMapPacked: true,
    standardFontDataUrl: opts.standardFontDataUrl, ...(opts.canvasFactory ? { canvasFactory: opts.canvasFactory } : {}),
  });
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintSolidColorImageMask,
]);

export function operatorListHasImages(fnArray: readonly number[]): boolean {
  return fnArray.some((op) => IMAGE_OPS.has(op));
}

export type RenderedPdfPage = { page: number; width: number; height: number; mimeType: 'image/png' | 'image/jpeg'; bytes: Uint8Array };

export async function renderPdfPage(pdf: PDFDocumentProxy, pageNumber: number, factory: PdfCanvasFactory, signal?: AbortSignal): Promise<RenderedPdfPage> {
  signal?.throwIfAborted();
  const page = await pdf.getPage(pageNumber);
  let pair: PdfCanvasPair | undefined;
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, PDF_RENDER_MAX_EDGE / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale: Math.max(scale, 0.25) });
    pair = factory.create(viewport.width, viewport.height);
    signal?.throwIfAborted();
    // @ts-expect-error OffscreenCanvas, HTML canvas and the Node test canvas all paint at runtime; PDF.js typings only name HTMLCanvasElement.
    await page.render({ canvasContext: pair.context, viewport, canvas: pair.canvas }).promise;
    signal?.throwIfAborted();
    let { bytes, mimeType } = await canvasBytes(pair.canvas, 'image/png');
    if (bytes.byteLength > PDF_RENDER_PNG_SOFT_MAX) {
      const jpeg = await canvasBytes(pair.canvas, 'image/jpeg', 0.82);
      if (jpeg.bytes.byteLength < bytes.byteLength) { bytes = jpeg.bytes; mimeType = 'image/jpeg'; }
    }
    return { page: pageNumber, width: Math.round(viewport.width), height: Math.round(viewport.height), mimeType, bytes };
  } finally {
    page.cleanup();
    if (pair) factory.destroy(pair);
  }
}

async function canvasBytes(canvas: PdfCanvasSurface, mimeType: 'image/png' | 'image/jpeg', quality = 0.92): Promise<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }> {
  if (typeof canvas.toBuffer === 'function') {
    const out = mimeType === 'image/jpeg' ? canvas.toBuffer('image/jpeg', { quality }) : canvas.toBuffer('image/png');
    return { bytes: out, mimeType };
  }
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: mimeType, quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType };
  }
  if (typeof canvas.toDataURL === 'function') {
    const url = canvas.toDataURL(mimeType, quality);
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error('Canvas produced an invalid data URL.');
    return { bytes: dataUrlPayload(url.slice(comma + 1)), mimeType };
  }
  throw new Error('This canvas cannot be encoded as an image.');
}

function dataUrlPayload(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


export type PdfRenderBackendOptions = OpenPdfOptions & { canvasFactory: PdfCanvasFactory };
/** Open a PDF for on-demand page renders. Caller must close() (destroys the PDF.js task). */
export function createPdfRenderBackend(opts: PdfRenderBackendOptions) {
  const task = openPdfDocument(opts);
  let pdfPromise = task.promise;
  return {
    async render(page: number, signal?: AbortSignal) {
      const pdf = await pdfPromise;
      return renderPdfPage(pdf, page, opts.canvasFactory, signal);
    },
    async close() {
      await task.destroy();
    },
  };
}

export async function pageHasPaintedImages(pdf: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy, pageNumber: number): Promise<boolean> {
  const page = await pdf.getPage(pageNumber);
  try {
    const ops = await page.getOperatorList();
    return operatorListHasImages(ops.fnArray);
  } finally {
    page.cleanup();
  }
}
