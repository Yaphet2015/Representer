/** Loaded only by the PDF side panel, after the reader clicks Read PDF. Never imported by the webpage bundle. */
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDF_MAX_CHARS, PDF_MAX_PAGES, joinPdfTextItems, pdfTextDocument, readPdfBytes, type PdfText } from './pdf-text';
GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(url: string, outer: AbortSignal, progress: (page: number, total: number) => void): Promise<PdfText> {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(90_000)]);
  signal.throwIfAborted();
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  const bytes = await readPdfBytes(response, signal); signal.throwIfAborted();
  const size = bytes.length;
  const task = getDocument({ data: bytes, useSystemFonts: false, cMapUrl: chrome.runtime.getURL('/pdf-assets/cmaps/'), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL('/pdf-assets/standard_fonts/') });
  let password = false;
  task.onPassword = () => { password = true; void task.destroy().catch(() => {}); };
  const stop = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    signal.throwIfAborted();
    const pdf = await task.promise;
    if (pdf.numPages > PDF_MAX_PAGES) throw new Error(`PDF has ${pdf.numPages} pages; limit is ${PDF_MAX_PAGES}. Nothing was summarized.`);
    const pages: string[] = []; let chars = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted(); progress(n, pdf.numPages);
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        const text = joinPdfTextItems(content.items);
        chars += text.length + 1;
        if (chars > PDF_MAX_CHARS) throw new Error(`PDF text exceeds ${PDF_MAX_CHARS.toLocaleString()} characters. Nothing was summarized; use a smaller document.`);
        pages.push(text);
      } finally { page.cleanup(); }
    }
    signal.throwIfAborted();
    let title = new URL(url).pathname.split('/').pop() || 'PDF';
    try { title = decodeURIComponent(title); } catch { /* a literal '%' is a valid filename */ }
    return pdfTextDocument(pages, size, title);
  } catch (e) {
    if (password) throw new Error('Password-protected PDFs are not supported. No password was requested or saved.');
    signal.throwIfAborted(); throw e;
  } finally { signal.removeEventListener('abort', stop); await task.destroy(); }
}
