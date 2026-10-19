import { describe, expect, it, vi } from 'vitest';
import { buildMockSummary, MOCK_DELAY_MS, mockReplyText, mockStream, mockSummary, useMock } from '../lib/mock';
import { isSummary } from '../lib/parse';

const base = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'm', mock: false };

describe('mock provider', () => {
  it('is used when toggled on or when no API key (except local servers)', () => {
    expect(useMock(base)).toBe(false);
    expect(useMock({ ...base, mock: true })).toBe(true);
    expect(useMock({ ...base, apiKey: '' })).toBe(true);
    expect(useMock({ ...base, apiKey: '', baseUrl: 'http://localhost:11434/v1' })).toBe(false);
  });
  it('returns a schema-valid summary with 3 sections after ~1.2s', async () => {
    vi.useFakeTimers();
    let done = false;
    const p = mockSummary('Title').then((s) => { done = true; return s; });
    await vi.advanceTimersByTimeAsync(MOCK_DELAY_MS - 50); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    const s = await p; vi.useRealTimers();
    expect(isSummary(s)).toBe(true); expect(s.sections).toHaveLength(3);
    for (const t of s.keyTerms) expect(s.overview).toContain(t);
    expect(buildMockSummary('X').sections.every((x) => x.bullets.length >= 2)).toBe(true);
  });
  it('points its sections and bullets at block ids of the page content', () => {
    const md = '[p1] # Title\n\n## [p2] History\n\n' + Array.from({ length: 6 }, (_, i) => `[p${i + 3}] Paragraph ${i} talks about printing and movable type in some depth here.`).join('\n\n');
    const s = buildMockSummary('T', 'en', md);
    expect(isSummary(s)).toBe(true);
    for (const sec of s.sections) {
      expect(sec.anchor).toBe('p2');
      expect(sec.anchors).toHaveLength(sec.bullets.length);
      for (const a of sec.anchors!) expect(md).toContain(`[${a}] Paragraph`);
    }
    expect(buildMockSummary('T', 'en').sections[0]!.anchors).toBeUndefined();
  });
  it('streams the reply token by token', async () => {
    const parts: string[] = [];
    const out = await mockStream('hi', (d) => parts.push(d), undefined, 0);
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.join('')).toBe(out);
    expect(out).toBe(mockReplyText('hi'));
  });
});
