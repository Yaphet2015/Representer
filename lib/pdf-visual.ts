/** On-demand PDF page images for the overview/chat agent. No chrome.storage; bytes stay in memory until close(). */
import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { currentLang, messages, type Lang } from './i18n';
import { formatPdfPageCatalog, pageNeedsVisualInspection, type PdfPageInfo } from './pdf-text';

export const PDF_INSPECT_MAX_PAGES = 10;
export const PDF_RENDER_CACHE = 3;

export type RenderedPdfPageBytes = { page: number; width: number; height: number; mimeType: 'image/png' | 'image/jpeg'; bytes: Uint8Array };
export type PdfRenderBackend = {
  render(page: number, signal?: AbortSignal): Promise<RenderedPdfPageBytes>;
  close(): Promise<void>;
};

/** Standard base64 without Buffer / btoa, so tests and the extension share one path. */
export function bytesToBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const ch = (n: number) => table[(n & 63)] ?? '';
  let out = '', i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ch(n >> 18) + ch(n >> 12) + ch(n >> 6) + ch(n);
  }
  if (i < bytes.length) {
    const a = bytes[i]!, b = bytes[i + 1];
    const n = b === undefined ? a << 16 : (a << 16) | (b << 8);
    out += ch(n >> 18) + ch(n >> 12) + (b === undefined ? '==' : ch(n >> 6) + '=');
  }
  return out;
}

export type PdfVision = { kind: 'ready' } | { kind: 'unsupported'; reason: string } | { kind: 'closed'; reason: string };

export type PdfVisualSession = {
  catalog: readonly PdfPageInfo[];
  pageByAnchor: Record<string, number>;
  inspectBudget: number;
  inspected: () => readonly number[];
  vision: () => PdfVision;
  markUnsupported: (reason: string) => void;
  inspect: (page: number, signal?: AbortSignal) => Promise<InspectedPdfPage>;
  close: () => Promise<void>;
  prompt: () => string;
};

export type InspectedPdfPage = {
  page: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  data: string;
  info: PdfPageInfo;
  blockId: string;
};

export function firstBlockIdForPage(pageByAnchor: Record<string, number>, page: number): string | undefined {
  return Object.keys(pageByAnchor).find((id) => pageByAnchor[id] === page);
}

export function createPdfVisualSession(opts: {
  catalog: readonly PdfPageInfo[];
  pageByAnchor: Record<string, number>;
  backend: PdfRenderBackend;
  inspectBudget?: number;
}): PdfVisualSession {
  const inspectBudget = opts.inspectBudget ?? PDF_INSPECT_MAX_PAGES;
  const catalog = opts.catalog;
  const pageByAnchor = opts.pageByAnchor;
  const inspected: number[] = [];
  const cache = new Map<number, InspectedPdfPage>();
  let vision: PdfVision = { kind: 'ready' };
  let closed = false;

  const inspect = async (page: number, signal?: AbortSignal): Promise<InspectedPdfPage> => {
    if (closed) throw new Error('The PDF visual session was closed.');
    if (vision.kind === 'unsupported') throw new Error(vision.reason);
    if (!Number.isInteger(page) || page < 1 || page > catalog.length) {
      throw new Error(`PDF page ${page} is out of range (1–${catalog.length}).`);
    }
    const hit = cache.get(page);
    if (hit) return hit;
    if (inspected.length >= inspectBudget && !inspected.includes(page)) {
      throw new Error(`Page-image budget reached (${inspectBudget}). Inspect only the most relevant remaining pages in a later run, or rely on already inspected pages: ${inspected.join(', ')}.`);
    }
    const rendered = await opts.backend.render(page, signal);
    const info = catalog[page - 1] ?? { page, chars: 0, hasText: false, hasImages: true };
    const blockId = firstBlockIdForPage(pageByAnchor, page) ?? '';
    const item: InspectedPdfPage = { page, width: rendered.width, height: rendered.height, mimeType: rendered.mimeType, data: bytesToBase64(rendered.bytes), info, blockId };
    if (cache.size >= PDF_RENDER_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(page, item);
    if (!inspected.includes(page)) inspected.push(page);
    return item;
  };

  return {
    catalog, pageByAnchor, inspectBudget,
    inspected: () => inspected.slice(),
    vision: () => vision,
    markUnsupported(reason) { vision = { kind: 'unsupported', reason }; cache.clear(); },
    inspect,
    async close() {
      closed = true; cache.clear(); vision = vision.kind === 'unsupported' ? vision : { kind: 'closed', reason: 'The PDF visual session was closed.' };
      await opts.backend.close();
    },
    prompt: () => formatPdfPageCatalog(catalog, inspectBudget),
  };
}

export function inspectCaption(item: InspectedPdfPage): string {
  const need = pageNeedsVisualInspection(item.info) ? 'This page was flagged for visual inspection.' : 'Inspected because a figure or question may depend on the page image.';
  const block = item.blockId ? ` Cite this page with block id ${item.blockId}.` : '';
  return `Rendered PDF page ${item.page} (${item.width}×${item.height} ${item.mimeType}). ${need}${block} Selectable text chars: ${item.info.chars}.`;
}

export function inspectPdfPageTools(session: PdfVisualSession, hooks: { onInspect?: (page: number) => void } = {}) {
  return [
    defineTool({
      name: 'inspect_pdf_page',
      description: 'Render one PDF page as an image so you can read charts, figures, photos, vector drawings or scanned wording that the text layer may omit. Pass a 1-based page number. Prefer pages the catalog marks inspect first, image-only or scanned pages, and any page whose figures, charts, diagrams or layout may matter. A page with no detected image paint operators can still contain vector charts; do not skip it for that reason. This run has a fixed page-image budget that is not renewable mid-run; if it is reached, say which pages were and were not inspected and do not claim uninspected pages were visually read.',
      parameters: Type.Object({ page: Type.Number({ description: '1-based PDF page number' }) }),
      replay: 'unsafe',
      execute: async (args) => {
        const page = args.page;
        hooks.onInspect?.(page);
        try {
          const item = await session.inspect(page);
          return {
            output: [
              { type: 'text' as const, text: inspectCaption(item) },
              { type: 'image' as const, data: item.data, mimeType: item.mimeType },
            ],
          };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { isError: true, output: [{ type: 'text' as const, text: `Error: ${message}` }] };
        }
      },
    }),
  ];
}

export function pdfVisualExtension(session: PdfVisualSession, hooks?: { onInspect?: (page: number) => void }) {
  return defineExtension({ name: 'pdf-visual', tools: inspectPdfPageTools(session, hooks) });
}

/** A 400-class rejection of image parts, not a generic model failure. */
export function isImageInputRejected(e: unknown): boolean {
  const s = String(e instanceof Error ? e.message : e);
  if (!/image|vision|multimodal|image_url|content.?type/i.test(s)) return false;
  return /400|415|unsupported|not support|invalid|unknown|not allowed|cannot/i.test(s);
}

/** English catalog copy; UI and thrown errors should use messages(lang).visionUnsupported. */
export const VISION_UNSUPPORTED = messages('en').visionUnsupported;
/** English catalog copy; UI and thrown errors should use messages(lang).visionToolsUnsupported. */
export const VISION_TOOLS_UNSUPPORTED = messages('en').visionToolsUnsupported;

export class VisionUnsupportedError extends Error {
  readonly code = 'vision-unsupported' as const;
  constructor(message = VISION_UNSUPPORTED) {
    super(message);
    this.name = 'VisionUnsupportedError';
  }
}

export type VisualInspectReport = { inspected: readonly number[]; total: number; budget: number; remaining: number };
export function visualInspectReport(session: PdfVisualSession): VisualInspectReport {
  const inspected = session.inspected();
  const total = session.catalog.length;
  return { inspected, total, budget: session.inspectBudget, remaining: Math.max(0, total - inspected.length) };
}
export function formatVisualInspectReport(r: VisualInspectReport, lang: Lang = currentLang()): string {
  const t = messages(lang);
  if (r.total <= 0) return '';
  if (r.inspected.length === 0) return t.visualInspectNone(r.total, r.budget);
  if (r.remaining === 0) return t.visualInspectAll(r.total);
  return t.visualInspectPartial(r.inspected.length, r.total, r.inspected.join(', '), r.budget);
}

export function rejectUnsupportedVision(visual: PdfVisualSession, reason = VISION_UNSUPPORTED): never {
  visual.markUnsupported(reason);
  throw new VisionUnsupportedError(reason);
}
