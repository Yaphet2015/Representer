/** Loaded only by the PDF side panel after the user opens an authorized sidebar. Never imported by the webpage bundle. */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { operatorListHasImages } from './pdf-render';
import { currentLang, messages, type Lang } from './i18n';
import { PDF_MAX_CHARS, PDF_MAX_PAGES, joinPdfTextItems, pdfTextDocument, readPdfBytes, type PdfText } from './pdf-text';
GlobalWorkerOptions.workerSrc = workerUrl;

export type ReadPdfResult = PdfText & { data: Uint8Array };
export async function readPdf(url: string, outer: AbortSignal, progress: (page: number, total: number) => void, lang: Lang = currentLang()): Promise<ReadPdfResult> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(90_000)]);
  signal.throwIfAborted();
  const t = messages(lang);
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  const bytes = await readPdfBytes(response, signal, lang); signal.throwIfAborted();
  const size = bytes.length;
  // PDF.js may detach the input buffer. Keep a copy so a later visual session can reopen the document.
  const kept = bytes.slice();
  const task = getDocument({ data: bytes, useSystemFonts: false, cMapUrl: chrome.runtime.getURL('/pdf-assets/cmaps/'), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL('/pdf-assets/standard_fonts/') });
  let password = false;
  task.onPassword = () => { password = true; void task.destroy().catch(() => {}); };
  const stop = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > PDF_MAX_PAGES) throw new Error(t.pdfTooManyPages(pdf.numPages, PDF_MAX_PAGES));
    const pages: string[] = []; const visuals: { hasImages: boolean }[] = []; let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted(); progress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        const ops = await page.getOperatorList();
        const text = joinPdfTextItems(content.items);
        chars += text.length + 1;
        if (chars > PDF_MAX_CHARS) throw new Error(t.pdfTextTooLong(PDF_MAX_CHARS.toLocaleString(lang === 'zh-CN' ? 'zh-CN' : 'en')));
        pages.push(text);
        visuals.push({ hasImages: operatorListHasImages(ops.fnArray) });
      } finally { page.cleanup(); }
    }
    signal.throwIfAborted();
    let title = new URL(url).pathname.split('/').pop() || 'PDF';
    try { title = decodeURIComponent(title); } catch { /* a literal '%' is a valid filename */ }
    return { ...pdfTextDocument(pages, size, title, visuals, lang), data: kept };
  } catch (e) {
    if (password) throw new Error(t.pdfPasswordProtected);
    signal.throwIfAborted(); throw e;
  } finally { signal.removeEventListener('abort', stop); await task.destroy(); }
}
