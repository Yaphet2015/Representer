/** A PDF text document, with explicit page sources (never DOM fingerprints). */
export const PDF_MAX_BYTES = 64 * 1024 * 1024;
export const PDF_MAX_PAGES = 300;
// Below the existing chat/read-page 400k ceiling. Reject, never silently truncate the document.
export const PDF_MAX_CHARS = 350_000;
/** One PDF page's text-layer and image-op facts, used to tell the agent when to inspect a rendering. */
export interface PdfPageInfo { page: number; chars: number; hasText: boolean; hasImages: boolean }
export interface PdfText { title: string; bytes: number; pages: string[]; content: string; pageByAnchor: Record<string, number>; emptyPages: number[]; catalog: PdfPageInfo[] }
/** A page the agent should look at as an image: no/little text, or paint operators for images/charts. */
export const PDF_THIN_TEXT_CHARS = 80;
export function pageNeedsVisualInspection(p: PdfPageInfo): boolean {
  return p.hasImages || !p.hasText || p.chars < PDF_THIN_TEXT_CHARS;
}
const EMPTY_PAGE = '(No selectable text on this page. Inspect the rendered page image for charts, figures or scanned content.)';
export function pdfTextDocument(pages: string[], bytes: number, title: string, visuals: readonly { hasImages: boolean }[] = []): PdfText {
  if (!pages.length || pages.length > PDF_MAX_PAGES) throw new Error(`PDF page limit: ${PDF_MAX_PAGES}.`);
  const pageByAnchor: Record<string, number> = {}; const blocks: string[] = []; const emptyPages: number[] = [];
  const catalog: PdfPageInfo[] = pages.map((text, i) => {
    const cleaned = text.replace(/\[p\d+\]/g, '(source marker)').trim(); // PDF text is untrusted, cannot forge block IDs
    const hasText = /[\p{L}\p{N}]/u.test(cleaned);
    if (!cleaned) emptyPages.push(i + 1);
    const body = cleaned || EMPTY_PAGE;
    for (let at = 0; at < body.length; at += 1600) {
      const id = `p${blocks.length + 1}`; pageByAnchor[id] = i + 1;
      blocks.push(`[${id}] PDF page ${i + 1}: ${body.slice(at, at + 1600)}`);
    }
    const visual = visuals[i];
    return { page: i + 1, chars: cleaned.length, hasText, hasImages: !!visual?.hasImages };
  });
  const content = blocks.join('\n\n');
  if (content.length > PDF_MAX_CHARS) throw new Error(`PDF text exceeds ${PDF_MAX_CHARS.toLocaleString()} characters. Nothing was summarized; use a smaller document.`);
  return { title, bytes, pages, content, pageByAnchor, emptyPages, catalog };
}
/** A compact catalog so the agent can decide which pages to render. Never includes image bytes. */
export function formatPdfPageCatalog(catalog: readonly PdfPageInfo[], inspectBudget: number): string {
  const lines = catalog.map((p) => {
    const flags = [
      p.hasText ? `${p.chars} chars of selectable text` : 'no selectable text',
      p.hasImages ? 'contains images or painted figures; inspect first' : 'no image paint operators detected; vector charts, diagrams or layout may still exist only in the page image — do not skip inspect_pdf_page because of this flag',
      pageNeedsVisualInspection(p) ? 'inspect first' : 'still inspect if a chart, diagram, table or layout could matter',
    ];
    return `${p.page}: ${flags.join('; ')}`;
  });
  return `Every page of this PDF is available. The text layer can omit charts, figures, photos, vector drawings and scanned wording. hasImages false only means no image paint operators were detected; it is not a reason to skip visualization. Prefer pages marked "inspect first", then any page a question, chart, diagram or layout depends on. Open a page with inspect_pdf_page({page: N}) (one page per call). This run can inspect at most ${inspectBudget} distinct pages; that cap is not renewable mid-run. If the budget is reached, say which pages were and were not inspected, and do not claim uninspected pages were visually read or that the whole document was visually covered. A later summarize or chat run can inspect other pages. Cite answers with the existing block id for that page (the [pN] marker whose line says "PDF page N"). If inspect_pdf_page reports that this model cannot accept images, say so clearly and do not invent chart or scanned values.
<pdf_pages>
${lines.join('\n')}
</pdf_pages>`;
}
/** Streaming cap includes a lying/missing Content-Length. No range requests, redirects, cookies or automatic retries. */
export async function readPdfBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}. Unable to read PDF; no retry or alternate request was made.`); }
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf') { await response.body?.cancel(); throw new Error('This document is not application/pdf. If this is a normal webpage, refresh it and use the floating panel.'); }
  if (Number(response.headers.get('content-length')) > PDF_MAX_BYTES) { await response.body?.cancel(); throw new Error('PDF exceeds the 64 MiB download limit.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty PDF response.');
  const chunks: Uint8Array[] = []; let size = 0;
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const r = await reader.read(); signal.throwIfAborted(); if (r.done) break;
      size += r.value.length; if (size > PDF_MAX_BYTES) throw new Error('PDF exceeds the 64 MiB download limit.');
      chunks.push(r.value);
    }
  } finally { signal.removeEventListener('abort', stop); await reader.cancel(); }
  const bytes = new Uint8Array(size); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Invalid PDF signature.');
  return bytes;
}

/** A glyph run from PDF.js (`TextItem`). Marked-content objects are ignored. */
export interface PdfGlyphRun { str: string; width: number; height: number; hasEOL: boolean; transform: number[] }
/** PDF.js already inserts in-run spaces at >= 0.102em (`SPACE_IN_FLOW_MIN_FACTOR`).
 * After a mid-word flush (font change, vertical shift) the same rule is applied at the item boundary.
 * Gaps at or below this are kerning/tracking, not a word space. Not a dictionary merge. */
export const PDF_WORD_SPACE_EM = 0.102;

export function isPdfGlyphRun(v: unknown): v is PdfGlyphRun {
  if (!v || typeof v !== 'object' || !('str' in v) || typeof v.str !== 'string') return false;
  if (!('width' in v) || typeof v.width !== 'number' || !Number.isFinite(v.width)) return false;
  if (!('height' in v) || typeof v.height !== 'number' || !Number.isFinite(v.height)) return false;
  if (!('hasEOL' in v) || typeof v.hasEOL !== 'boolean' || !('transform' in v) || !Array.isArray(v.transform) || v.transform.length < 6) return false;
  return v.transform.slice(0, 6).every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Join PDF.js text items. Trust spaces already in `str` (and whitespace items); insert a space or newline only from geometry. */
export function joinPdfTextItems(items: readonly unknown[]): string {
  let out = '';
  let prev: { endX: number; endY: number; ax: number; ay: number; em: number; hasEOL: boolean } | null = null;
  for (const raw of items) {
    if (!isPdfGlyphRun(raw)) continue;
    const a = raw.transform[0], b = raw.transform[1], x = raw.transform[4], y = raw.transform[5];
    if (a === undefined || b === undefined || x === undefined || y === undefined) continue;
    const scale = Math.hypot(a, b) || raw.height || 0;
    const ax = scale ? a / scale : 1, ay = scale ? b / scale : 0;
    const em = scale || raw.height || 1;
    if (prev) {
      if (!prev.hasEOL) {
        const dx = x - prev.endX, dy = y - prev.endY;
        const along = dx * prev.ax + dy * prev.ay;
        const across = Math.abs(dx * -prev.ay + dy * prev.ax);
        if (across > Math.max(prev.em, em) * 0.5) {
          if (!out.endsWith('\n')) out += '\n';
        } else if (along > Math.max(prev.em, em) * PDF_WORD_SPACE_EM && !/\s$/.test(out) && !/^\s/.test(raw.str)) {
          out += ' ';
        }
      }
    }
    out += raw.str;
    if (raw.hasEOL && !out.endsWith('\n')) out += '\n';
    prev = { endX: x + raw.width * ax, endY: y + raw.width * ay, ax, ay, em, hasEOL: raw.hasEOL };
  }
  return out.trim();
}
