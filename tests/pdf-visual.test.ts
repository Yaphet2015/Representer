/** On-demand page images, catalog flags, budget/cleanup and the long-document tool path. No live model. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { OVERVIEW_INLINE_MAX, overviewInput, overviewTools, runOverviewAgent, createOverviewDraft } from '../lib/overview-agent';
import { chunkContent } from '../lib/chunked-overview';
import { firstBlockIdForPage, inspectCaption, inspectPdfPageTools, isImageInputRejected, createPdfVisualSession, PDF_INSPECT_MAX_PAGES, VISION_UNSUPPORTED } from '../lib/pdf-visual';
import { createPdfRenderBackend } from '../lib/pdf-render';
import { pdfTextDocument } from '../lib/pdf-text';
import { buildModels } from '../lib/llm';
import { nodeCanvasFactory } from './pdf-canvas';

const root = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url));
GlobalWorkerOptions.workerSrc = root + 'legacy/build/pdf.worker.mjs';
const visualBytes = readFileSync(new URL('./fixtures/pdf-visual.pdf', import.meta.url));

afterEach(() => vi.unstubAllGlobals());

function backendFor(data: Uint8Array) {
  return createPdfRenderBackend({
    data, cMapUrl: root + 'cmaps/', standardFontDataUrl: root + 'standard_fonts/', canvasFactory: nodeCanvasFactory(),
  });
}

describe('PDF visual catalog and inspect tool', () => {
  it('renders the pixel-only page on demand and never puts the visual fact in the tool caption', async () => {
    const doc = pdfTextDocument(['The sales code is not written in the text layer.', ''], visualBytes.byteLength, 'visual', [{ hasImages: false }, { hasImages: true }]);
    const session = createPdfVisualSession({ catalog: doc.catalog, pageByAnchor: doc.pageByAnchor, backend: backendFor(new Uint8Array(visualBytes)) });
    const item = await session.inspect(2);
    expect(item.page).toBe(2);
    expect(item.mimeType === 'image/png' || item.mimeType === 'image/jpeg').toBe(true);
    expect(item.data.length).toBeGreaterThan(100);
    expect(item.blockId).toBe(firstBlockIdForPage(doc.pageByAnchor, 2));
    expect(item.data.includes('ORBIT') || inspectCaption(item).includes('ORBIT-SALES-904')).toBe(false);
    expect(inspectCaption(item)).toContain('PDF page 2');
    expect(inspectCaption(item)).toContain(item.blockId);
    const [tool] = inspectPdfPageTools(session);
    const result = await (tool as any).execute({ page: 2 });
    expect(result.isError).toBeFalsy();
    const out = result.output;
    expect(Array.isArray(out)).toBe(true);
    if (!Array.isArray(out)) throw new Error('expected multimodal output');
    expect(out[0]).toMatchObject({ type: 'text' });
    expect(out[1]).toMatchObject({ type: 'image', mimeType: item.mimeType });
    if (out[1]?.type === 'image') expect(out[1].data).toBe(item.data);
    await session.close();
    await expect(session.inspect(1)).rejects.toThrow(/closed/);
  });

  it('caps distinct page inspections and evicts raw renders without forgetting the budget list', async () => {
    const catalog = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, chars: 0, hasText: false, hasImages: true }));
    const pageByAnchor = Object.fromEntries(catalog.map((p) => [`p${p.page}`, p.page]));
    let renders = 0;
    const session = createPdfVisualSession({
      catalog, pageByAnchor, inspectBudget: 3,
      backend: {
        async render(page) { renders++; return { page, width: 2, height: 2, mimeType: 'image/png', bytes: new Uint8Array([page, 9, 8, 7]) }; },
        async close() {},
      },
    });
    await session.inspect(1); await session.inspect(2); await session.inspect(3);
    await expect(session.inspect(4)).rejects.toThrow(/budget/);
    const again = await session.inspect(1); // already counted, even if evicted from the LRU
    expect(again.page).toBe(1);
    expect(session.inspected()).toEqual([1, 2, 3]);
    expect(renders).toBeGreaterThanOrEqual(3);
    session.markUnsupported(VISION_UNSUPPORTED);
    await expect(session.inspect(2)).rejects.toThrow(/cannot accept page images|did not accept page images/);
  });

  it('names a rejected image payload without treating generic errors as a vision failure', () => {
    expect(isImageInputRejected(new Error('400 invalid image_url'))).toBe(true);
    expect(isImageInputRejected(new Error('This model does not support images'))).toBe(true);
    expect(isImageInputRejected(new Error('500 server error'))).toBe(false);
    expect(isImageInputRejected(new Error('No API key'))).toBe(false);
  });

  it('advertises image input only when asked, so webpage turns stay text-only', () => {
    const s = { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', lang: 'en' as const, systemPrompt: '', mock: false };
    expect(buildModels(s).getModel('byok', 'm')?.input).toEqual(['text']);
    expect(buildModels(s, undefined, undefined, ['text', 'image']).getModel('byok', 'm')?.input).toEqual(['text', 'image']);
  });
});

describe('overview and long-document visual path', () => {
  it('adds inspect_pdf_page to the overview tools and keeps a long document on the chunked path', () => {
    const pages = Array.from({ length: 50 }, (_, i) => (i === 49 ? '' : `Page ${i + 1} unique. ` + 'selectable text '.repeat(120)));
    const doc = pdfTextDocument(pages, 5000, 'long fixture', pages.map((_, i) => ({ hasImages: i === 49 })));
    expect(doc.content.length).toBeGreaterThan(OVERVIEW_INLINE_MAX);
    expect(chunkContent(doc.content).length).toBeGreaterThan(1);
    const session = createPdfVisualSession({
      catalog: doc.catalog, pageByAnchor: doc.pageByAnchor,
      backend: { render: async (page) => ({ page, width: 1, height: 1, mimeType: 'image/png', bytes: new Uint8Array([1]) }), close: async () => {} },
    });
    const tools = overviewTools(createOverviewDraft(doc.content), doc.content, true, { visual: session });
    const names = ((tools as any).tools as { name: string }[]).map((x) => x.name);
    expect(names).toContain('inspect_pdf_page');
    expect(names).toContain('read_page');
    expect(names).toContain('submit_summary');
    const inline = overviewInput('t', 'https://a.com/x', 'short page');
    expect(inline.withRead).toBe(false);
  });

  it('lets the agent inspect a flagged last page of a long document and cite that source page', async () => {
    const pages = Array.from({ length: 50 }, (_, i) => (i === 49 ? '' : `Page ${i + 1} unique. ` + 'selectable text '.repeat(120)));
    const doc = pdfTextDocument(pages, 5000, 'long fixture', pages.map((_, i) => ({ hasImages: i === 49 })));
    const inspected: number[] = [];
    const session = createPdfVisualSession({
      catalog: doc.catalog, pageByAnchor: doc.pageByAnchor,
      backend: {
        async render(page) { inspected.push(page); return { page, width: 3, height: 3, mimeType: 'image/png', bytes: new Uint8Array([2, 3, 4]) }; },
        async close() {},
      },
    });
    const anchor = firstBlockIdForPage(doc.pageByAnchor, 50)!;
    const summary = await runOverviewAgent({
      instructions: 'Summarize', title: 'long', url: 'https://files.example.org/long', content: doc.content, model: 'test-model',
      input: `Notes of a long document.\nThe last part has no selectable text.`,
      visual: session, maxTurns: 2, maxToolCalls: 10,
    }, {
      async turn(_instructions, input, tools, _signal, _max, onStop) {
        expect(input).toContain('inspect_pdf_page');
        expect(input).toContain('50:');
        expect(input).toContain('contains images or painted figures');
        const call = (name: string, args: unknown) => (tools as any).tools.find((t: { name: string }) => t.name === name).execute(args);
        await call('inspect_pdf_page', { page: 50 });
        await call('submit_summary', {
          overview: 'The last page is a figure.',
          sections: [{ title: 'Figure', anchor, icon: 'list', bullets: [{ text: 'A visual page', anchor }] }],
          quote: null,
        });
        await call('finish', {});
        onStop('stop');
        return '';
      },
    });
    expect(inspected).toEqual([50]);
    const cited = summary.sections[0]?.anchor;
    expect(cited).toBe(anchor);
    expect(cited ? doc.pageByAnchor[cited] : undefined).toBe(50);
  });
});
