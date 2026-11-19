/** Real PDF.js against small fixtures; no browser, remote request, model call or user storage. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPdf } from '../lib/pdf-read';
const root = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url));
GlobalWorkerOptions.workerSrc = root + 'legacy/build/pdf.worker.mjs';
afterEach(() => vi.unstubAllGlobals());
function fixture(name: string) {
  const bytes = readFileSync(new URL('./fixtures/' + name, import.meta.url));
  vi.stubGlobal('chrome', { runtime: { getURL: (p: string) => root + p.replace('/pdf-assets/', '') } });
  const fetcher = vi.fn(async () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } })); vi.stubGlobal('fetch', fetcher); return fetcher;
}
describe('PDF.js full text extraction', () => {
  it('reads all three pages including Chinese, repeat phrases and both columns, using local worker/CMaps', async () => {
    const f = fixture('pdf-demo.pdf'); const progress: number[] = [];
    const doc = await readPdf('https://files.example.org/no-extension', new AbortController().signal, (p) => progress.push(p));
    expect(doc.pages).toHaveLength(3); expect(progress).toEqual([1, 2, 3]); expect(doc.bytes).toBe(4742);
    expect(doc.pages[0]).toContain('PDF-ALPHA-173'); expect(doc.pages[1]).toContain('PDF-BETA-284'); expect(doc.pages[2]).toContain('PDF-GAMMA-395');
    expect(doc.pages[0]).toContain('青竹计划'); expect(doc.pages[2]).toContain('丹桂计划');
    expect(doc.pages[1]).toContain('L9:'); expect(doc.pages[1]).toContain('R9:');
    expect(f).toHaveBeenCalledTimes(1); expect(f.mock.calls[0]).toBeDefined();
  });
  it('accepts a blank file as an image-only document instead of refusing the read', async () => {
    fixture('pdf-blank.pdf');
    const doc = await readPdf('https://a.com/x', new AbortController().signal, () => {});
    expect(doc.pages).toHaveLength(1);
    expect(doc.emptyPages).toEqual([1]);
    expect(doc.catalog[0]).toMatchObject({ page: 1, hasText: false });
    expect(doc.data.byteLength).toBeGreaterThan(0);
  });
  it('keeps a pixel-only chart page and does not put the visual fact in the text layer', async () => {
    fixture('pdf-visual.pdf');
    const doc = await readPdf('https://files.example.org/visual', new AbortController().signal, () => {});
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]).toContain('sales code is not written in the text layer');
    expect(doc.pages[1]?.trim() ?? '').toBe('');
    expect(doc.content).not.toContain('ORBIT-SALES-904');
    expect(doc.pages.join('\n')).not.toContain('ORBIT-SALES-904');
    expect(doc.catalog[1]).toMatchObject({ page: 2, hasText: false, hasImages: true });
    expect(doc.pageByAnchor['p2']).toBe(2);
  });
  it('rejects password protection without prompting or hanging', async () => { fixture('pdf-password.pdf'); await expect(readPdf('https://a.com/x', new AbortController().signal, () => {})).rejects.toThrow(/Password-protected/); });
  it('joins mid-word font-change fragments and keeps typographic word/column spaces, without dictionary merging', async () => {
    fixture('pdf-spacing.pdf');
    const doc = await readPdf('https://files.example.org/spacing', new AbortController().signal, () => {});
    expect(doc.pages).toHaveLength(1);
    const page = doc.pages[0]!;
    expect(page).toContain('trademarks MARK-KERN');
    expect(page).not.toContain('tradema rks');
    expect(page).toContain('respective tradenames MARK-WORD');
    expect(page).not.toMatch(/re\s+sp\s+ective/);
    expect(page).not.toContain('trade na mes');
    expect(page).toContain('already spaced words MARK-PRESERVE');
    expect(page).toContain('L9: method A');
    expect(page).toContain('R9: result 27 MARK-COLS');
  });
});
