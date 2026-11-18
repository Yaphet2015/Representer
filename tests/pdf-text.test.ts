import { describe, expect, it } from 'vitest';
import { PDF_MAX_BYTES, PDF_MAX_CHARS, PDF_MAX_PAGES, pdfTextDocument, readPdfBytes } from '../lib/pdf-text';
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
