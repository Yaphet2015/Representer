/** Unsupported vision must fail clearly: no silent text-only success. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const runTurn = vi.hoisted(() => vi.fn());
vi.mock('../lib/llm', () => ({ runTurn: (...args: unknown[]) => runTurn(...args) }));

import { providerFor } from '../lib/provider';
import { createPdfVisualSession, formatVisualInspectReport, visualInspectReport, VisionUnsupportedError } from '../lib/pdf-visual';
import type { Settings } from '../lib/types';

const settings: Settings = { baseUrl: 'https://example.com/v1', apiKey: 'x', model: 'm', mock: false, systemPrompt: '', lang: 'en' };

function session(pages = 12) {
  return createPdfVisualSession({
    catalog: Array.from({ length: pages }, (_, i) => ({ page: i + 1, chars: 20, hasText: true, hasImages: i === 0 })),
    pageByAnchor: Object.fromEntries(Array.from({ length: pages }, (_, i) => [`p${i + 1}`, i + 1])),
    inspectBudget: 10,
    backend: { render: async (page) => ({ page, width: 1, height: 1, mimeType: 'image/png', bytes: new Uint8Array([1]) }), close: async () => {} },
  });
}

afterEach(() => { runTurn.mockReset(); });

describe('no silent text-only visual fallback', () => {
  it('fails summarize when the API rejects images, without a second text-only call', async () => {
    runTurn.mockRejectedValueOnce(new Error('400 invalid image_url'));
    const visual = session();
    const statuses: unknown[] = [];
    await expect(providerFor(settings, 'en').summarize('t', 'https://files.example.org/doc', 'Short PDF text.', undefined, undefined, undefined, { visual, onStatus: (s) => statuses.push(s) })).rejects.toBeInstanceOf(VisionUnsupportedError);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(visual.vision().kind).toBe('unsupported');
    expect(statuses.some((s) => s && typeof s === 'object' && 'vision' in s && s.vision === 'unsupported')).toBe(true);
  });

  it('fails chat the same way and does not return a text-only answer', async () => {
    runTurn.mockRejectedValueOnce(new Error('This model does not support images'));
    const visual = session();
    await expect(providerFor(settings, 'en').chat({ title: 't', summary: null, content: 'hi', visual }, [], 'What is in the chart?', () => {})).rejects.toThrow(/Choose a vision-capable/);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(visual.vision().kind).toBe('unsupported');
  });

  it('does not fall back to the JSON summary path when tools are unsupported on a visual run', async () => {
    runTurn.mockRejectedValueOnce(new Error('function calling is not supported'));
    const visual = session();
    await expect(providerFor(settings, 'en').summarize('t', 'https://files.example.org/doc', 'Short PDF text.', undefined, undefined, undefined, { visual })).rejects.toThrow(/cannot call tools/);
    expect(visual.vision().kind).toBe('unsupported');
  });
});

describe('inspect-budget transparency', () => {
  it('reports a partial visual run instead of implying the whole document was seen', async () => {
    const visual = session(59);
    for (let p = 1; p <= 10; p++) await visual.inspect(p);
    await expect(visual.inspect(11)).rejects.toThrow(/budget reached/);
    const report = visualInspectReport(visual);
    expect(report).toEqual({ inspected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], total: 59, budget: 10, remaining: 49 });
    const text = formatVisualInspectReport(report);
    expect(text).toContain('10 of 59');
    expect(text).toContain('not renewable mid-run');
    expect(text).toContain('not a full visual reading');
  });
});
