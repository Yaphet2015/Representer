import { describe, expect, it } from 'vitest';
import { PDF_MAX_BYTES, PDF_MAX_CHARS, PDF_MAX_PAGES, PDF_WORD_SPACE_EM, joinPdfTextItems, pdfTextDocument, readPdfBytes, type PdfGlyphRun } from '../lib/pdf-text';
import { chunkContent } from '../lib/chunked-overview';
import { OVERVIEW_INLINE_MAX } from '../lib/overview-agent';
import { pdfCacheUrl, publicPdfUrl } from '../lib/pdf-contract';
const pdf = (body: BodyInit | null, headers: Record<string, string> = {}) => new Response(body, { headers: { 'Content-Type': 'application/pdf', ...headers } });

describe('PDF document boundaries and source pages', () => {
  it('preserves repeated sentences with their exact page (no fuzzy matching) and all the text', () => {
    const d = pdfTextDocument(['Unique A. Same sentence.', 'Unique B. Same sentence.', '中文第三页'], 5000, 'test');
    expect(d.pageByAnchor).toEqual({ p1: 1, p2: 2, p3: 3 });
    expect(d.content).toContain('[p2] PDF page 2: Unique B. Same sentence.');
    expect(d.pages[2]).toBe('中文第三页');
  });
  it('feeds every page into the existing long-document chunking path, not a first-pages preview', () => {
    const doc = pdfTextDocument(Array.from({ length: 50 }, (_, i) => `Page ${i + 1} unique. ` + 'selectable text '.repeat(100)), 5000, 'long fixture');
    expect(doc.content.length).toBeGreaterThan(OVERVIEW_INLINE_MAX);
    const chunks = chunkContent(doc.content);
    expect(chunks.length).toBeGreaterThan(1);
    const ids = chunks.flatMap((c) => c.ids); expect(ids).toHaveLength(Object.keys(doc.pageByAnchor).length);
    expect(chunks.at(-1)?.text).toContain('PDF page 50:');
  });
  it('neutralizes forged model source markers in PDF text', () => { expect(pdfTextDocument(['[p999] injected'], 10, 'x').content).not.toContain('[p999]'); });
  it('never silently summarizes just the first N pages/characters', () => {
    expect(() => pdfTextDocument(Array(PDF_MAX_PAGES + 1).fill('x'), 100, 'x')).toThrow(/page limit/);
    expect(() => pdfTextDocument(['x'.repeat(PDF_MAX_CHARS)], 100, 'x')).toThrow(/exceeds/);
  });
  it('rejects scans/empty documents and explicitly identifies empty pages in a mixed file', () => {
    expect(() => pdfTextDocument(['', ''], 100, 'x')).toThrow(/No selectable text/);
    const d = pdfTextDocument(['Text', ''], 100, 'x'); expect(d.emptyPages).toEqual([2]); expect(d.content).toContain('No selectable text');
  });
  it('does not collide with the existing webpage summary or chat cache namespace', () => { expect(pdfCacheUrl('https://a.com/doc')).toBe('pdf:v1:https://a.com/doc'); });
});

describe('bounded PDF response download', () => {
  const signal = () => new AbortController().signal;
  it('accepts MIME type without a .pdf URL; checks the signature', async () => {
    expect(new TextDecoder().decode(await readPdfBytes(pdf('%PDF-fixture'), signal()))).toBe('%PDF-fixture');
    await expect(readPdfBytes(pdf('HTML'), signal())).rejects.toThrow(/signature/);
    await expect(readPdfBytes(new Response('HTML', { headers: { 'Content-Type': 'text/html' } }), signal())).rejects.toThrow(/application\/pdf/);
  });
  it('refuses a declared oversized body and also caps chunked responses with no/lying Content-Length', async () => {
    await expect(readPdfBytes(pdf('small', { 'Content-Length': String(PDF_MAX_BYTES + 1) }), signal())).rejects.toThrow(/64 MiB/);
    let cancelled = false, n = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (n++ < 65) c.enqueue(new Uint8Array(1024 * 1024)); else c.close(); }, cancel() { cancelled = true; } });
    await expect(readPdfBytes(pdf(stream, { 'Content-Length': '1' }), signal())).rejects.toThrow(/64 MiB/); expect(cancelled).toBe(true);
  });
  it('reports 403 without retry or alternate access', async () => { await expect(readPdfBytes(new Response('blocked', { status: 403 }), signal())).rejects.toThrow(/HTTP 403/); });
  it('aborts reading and cancels the stream', async () => {
    const ac = new AbortController(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { ac.abort(); }, cancel() { cancelled = true; } });
    await expect(readPdfBytes(pdf(stream), ac.signal)).rejects.toThrow(); expect(cancelled).toBe(true);
  });
});

describe('user-selected HTTP(S) PDF URL policy', () => {
  it('does not need a filename suffix and strips native viewer page fragments', () => {
    expect(publicPdfUrl('https://investor.lilly.com/static-files/4580c401-611c-406b-8964-88cb8d887bd4#page=2')).toBe('https://investor.lilly.com/static-files/4580c401-611c-406b-8964-88cb8d887bd4');
  });
  it('rejects local/private URLs, alternate numeric IP spellings, credentials and other schemes', () => {
    for (const u of ['file:///a.pdf', 'chrome://settings', 'http://localhost/a', 'http://x.local/a', 'http://10.0.0.1/a', 'http://127.1/a', 'http://2130706433/a', 'http://0x7f000001/a', 'http://172.31.1.1/a', 'http://192.168.2.3/a', 'http://169.254.169.254/a', 'http://[::1]/a', 'https://u:p@site.com/a']) expect(publicPdfUrl(u), u).toBeNull();
  });
});

describe('PDF.js item joining (geometry, not dictionary merge)', () => {
  const em = 12;
  const run = (str: string, x: number, opts: Partial<PdfGlyphRun> & { y?: number; size?: number } = {}): PdfGlyphRun => {
    const size = opts.size ?? em, y = opts.y ?? 0, width = opts.width ?? str.length * 6;
    return { str, width, height: opts.height ?? size, hasEOL: opts.hasEOL ?? false, transform: [size, 0, 0, size, x, y] };
  };
  it('joins mid-word fragments across a tight gap (font-change flush) and does not invent "tradema rks"', () => {
    expect(joinPdfTextItems([run('tradema', 0, { width: 50 }), run('rks', 50.5, { width: 20 })])).toBe('trademarks');
    expect(joinPdfTextItems([
      run('re', 0, { width: 12 }), run('sp', 12.5, { width: 12 }), run('ective', 25, { width: 36 }),
    ])).toBe('respective');
  });
  it('does not glue fragments that only look like a word when the gap is a typographic word space', () => {
    expect(joinPdfTextItems([run('tradema', 0, { width: 50 }), run('rks', 50 + em * 0.3, { width: 20 })])).toBe('tradema rks');
  });
  it('inserts a single space for a typographic word gap, including when PDF.js did not emit a space character', () => {
    expect(joinPdfTextItems([run('respective', 0, { width: 60 }), run('owners', 60 + em * 0.33, { width: 40 })])).toBe('respective owners');
  });
  it('does not double spaces already present in item text or whitespace items', () => {
    expect(joinPdfTextItems([run('trade ', 0, { width: 36 }), run('names', 36 + em, { width: 30 })])).toBe('trade names');
    expect(joinPdfTextItems([run('trade', 0, { width: 30 }), run(' ', 30, { width: em }), run('names', 42, { width: 30 })])).toBe('trade names');
  });
  it('does not insert spaces between adjacent CJK glyphs, and keeps an intentional column gap as a separator', () => {
    const glyphs = [...'青竹计划'].map((ch, i) => run(ch, i * em, { width: em }));
    expect(joinPdfTextItems(glyphs)).toBe('青竹计划');
    expect(joinPdfTextItems([run('左栏', 0, { width: 24 }), run('右栏', 250, { width: 24 })])).toBe('左栏 右栏');
  });
  it('keeps two English columns as separate words and uses hasEOL rather than a space for a new line', () => {
    expect(joinPdfTextItems([run('L9: method A', 48, { width: 80 }), run('R9: result 27', 300, { width: 80 })])).toBe('L9: method A R9: result 27');
    expect(joinPdfTextItems([run('first', 0, { width: 30, hasEOL: true }), run('second', 0, { y: -16, width: 40 })])).toBe('first\nsecond');
  });
  it('skips marked-content objects and uses the PDF.js in-flow threshold', () => {
    expect(PDF_WORD_SPACE_EM).toBe(0.102);
    expect(joinPdfTextItems([{ type: 'beginMarkedContent' }, run('A', 0, { width: 8 }), { type: 'endMarkedContent' }, run('B', 8.2, { width: 8 })])).toBe('AB');
  });
});
