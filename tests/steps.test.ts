import { describe, expect, it, vi } from 'vitest';
import { detectSteps, missingSteps, summarizeWithSteps } from '../lib/steps';
import type { Summary } from '../lib/types';

const page = (titles: string[]) => titles.map((t, i) => `[p${i * 2 + 1}] ${t}\n\n[p${i * 2 + 2}] Supporting explanation.`).join('\n\n');
const content = page(['## Step 1. Prepare', '## Step 2. Run', '## Step 3. Verify']);
const summary = (...anchors: string[]): Summary => ({ overview: 'o', sections: [{ title: 's', icon: 'list', bullets: anchors.map(() => 'b'), anchors }] });
const raw = (...anchors: string[]) => JSON.stringify({ overview: anchors.join(',') || 'none', sections: [{ title: 's', bullets: anchors.map((anchor) => ({ text: 'b', anchor })) }] });

describe('step sequences', () => {
  it.each([
    ['Step 1. Prepare', 'Step 2. Run', 'Step 3. Verify'],
    ['第1步：准备', '第2步：执行', '第3步：验证'],
    ['步骤1 准备', '步骤2 执行', '步骤3 验证'],
    ['第1章 准备', '第2章 执行', '第3章 验证'],
    ['## 1. Prepare', '## 2. Run', '## 3. Verify'],
    ['1) Prepare', '2) Run', '3) Verify'],
    ['1、准备', '2、执行', '3、验证'],
    ['Phase 0: Prepare', 'Phase 1: Run', 'Phase 2: Verify'],
    ['Part 1: Prepare', 'Part 2: Run', 'Part 3: Verify'],
  ])('detects %s', (...titles) => {
    const s = detectSteps(page(titles));
    expect(s).toHaveLength(3);
    expect(s.map(({ start, end }) => [start, end])).toEqual([[1, 3], [3, 5], [5, 7]]);
  });
  it('supports headings before markers, and nested numbered lists', () => {
    expect(detectSteps('## [p1] Step 1. A\n\n[p2] 1. Inner\n\n## [p3] Step 2. B\n\n## [p4] Step 3. C')).toHaveLength(3);
  });
  it.each([
    ['1. [A](#a)', '2. [B](#b)', '3. [C](#c)'],
    ['[^1]: Footnote', '[^2]: Footnote', '[^3]: Footnote'],
    ['1. Author (2020). Paper', '2. Author (2021). Paper', '3. Author (2022). Paper'],
    ['Step 1. A', 'Step 2. B', 'Step 4. D'],
    ['Step 1. A', 'Step 2. B', 'Step 3. C', 'Step 5. E'],
    ['Step 2. B', 'Step 3. C', 'Step 4. D'],
    ['Step 1. A', 'Step 2. B'],
  ])('rejects unreliable sequences %s', (...titles) => expect(detectSteps(page(titles))).toEqual([]));
  it('skips reference sections and code samples', () => {
    expect(detectSteps('[p1] ## References\n\n' + page(['1. Alpha', '2. Beta', '3. Gamma']).replace(/p(\d+)/g, (_, n) => `p${Number(n) + 1}`))).toEqual([]);
    expect(detectSteps('```md\n' + content + '\n```')).toEqual([]);
  });
  it('chooses longest, then earliest independent sequence', () => {
    const short = page(['Step 1. A', 'Step 2. B', 'Step 3. C']);
    const long = page(['Part 1. A', 'Part 2. B', 'Part 3. C', 'Part 4. D']).replace(/p(\d+)/g, (_, n) => `p${Number(n) + 6}`);
    expect(detectSteps(short + '\n\n' + long)[0]?.title).toBe('Part 1. A');
    expect(detectSteps(short + '\n\n' + page(['Part 1. A', 'Part 2. B', 'Part 3. C']).replace(/p(\d+)/g, (_, n) => `p${Number(n) + 6}`))[0]?.start).toBe(1);
  });
});

describe('step coverage', () => {
  const steps = detectSteps(content);
  it.each([
    '[p7] ## References',
    '## [p7] References',
    '[p7] References',
    '[p7] ## Appendix',
    '[p7] # Appendix',
    '## Appendix\n\n[p7] Appendix introduction.',
    '[p7] ### References',
  ])('does not count a following independent section: %s', (heading) => {
    const detected = detectSteps(`${content}\n\n${heading}\n\n[p8] Further reading.`);
    expect(detected.map(({ start, end }) => [start, end])).toEqual([[1, 3], [3, 5], [5, 7]]);
    expect(missingSteps(detected, summary('p1', 'p3', 'p8'))).toEqual([detected[2]]);
    expect(missingSteps(detected, summary('p1', 'p3', 'p7'))).toEqual([detected[2]]);
    expect(missingSteps(detected, summary('p1', 'p3'))).toEqual([detected[2]]);
    expect(missingSteps(detected, summary('p2', 'p4', 'p6', 'p8'))).toEqual([]);
  });
  it('retains nested step content but stops at an unnumbered peer heading', () => {
    const detected = detectSteps(`${content}\n\n[p7] ### Troubleshooting\n\n[p8] Retry verification.\n\n[p9] ## Appendix\n\n[p10] Further reading.`);
    expect(detected[2]!.end).toBe(9);
    expect(missingSteps(detected, summary('p1', 'p3', 'p8'))).toEqual([]);
    expect(missingSteps(detected, summary('p1', 'p3', 'p10'))).toEqual([detected[2]]);
  });
  it('uses heading levels when Markdown places headings before markers', () => {
    const detected = detectSteps(`${content.replace(/\[p(\d+)\] ##/g, '## [p$1]')}\n\n### [p7] Details\n\n[p8] Verification details.\n\n## [p9] Appendix\n\n[p10] Aside.`);
    expect(detected[2]!.end).toBe(9);
    expect(missingSteps(detected, summary('p1', 'p3', 'p8'))).toEqual([]);
    expect(missingSteps(detected, summary('p1', 'p3', 'p10'))).toEqual([detected[2]]);
  });
  it('bounds earlier steps too, without changing conservative sequence detection', () => {
    const detected = detectSteps('[p1] ## Step 1. A\n\n[p2] Body\n\n[p3] ## Background\n\n[p4] Aside\n\n[p5] ## Step 2. B\n\n[p6] Body\n\n[p7] ## Step 3. C\n\n[p8] Body');
    expect(detected.map(({ start, end }) => [start, end])).toEqual([[1, 3], [5, 7], [7, 9]]);
    expect(missingSteps(detected, summary('p4', 'p6', 'p8'))).toEqual([detected[0]]);
  });
  it('ignores heading boundaries inside fenced examples', () => {
    const detected = detectSteps(`${content}\n\n\`\`\`md\n[p7] ## Appendix\n\`\`\`\n\n[p8] More verification details.`);
    expect(detected[2]!.end).toBe(9);
    expect(missingSteps(detected, summary('p1', 'p3', 'p8'))).toEqual([]);
  });
  it('uses half-open ranges and section or bullet anchors', () => {
    const s = summary('p2', 'p5'); s.sections[0]!.anchor = 'p3';
    expect(missingSteps(steps, s)).toEqual([]);
    expect(missingSteps(steps, summary('p3'))).toEqual([steps[0], steps[2]]);
  });
  it('does not count excerpt, overview, invalid anchors or orphan array entries', () => {
    const s = summary(); s.quote = { text: 'q', anchor: 'p1' }; s.overview = '[p3]';
    s.sections[0]!.anchors = ['p5'];
    expect(missingSteps(steps, s)).toHaveLength(3);
    expect(missingSteps(steps.slice(0, 2), s)).toEqual([]);
  });
});

describe('one quality retry', () => {
  it('retries once when references substitute for the last step, even if still incomplete', async () => {
    const withReferences = `${content}\n\n[p7] ## References\n\n[p8] Further reading.`;
    const generate = vi.fn().mockResolvedValue(raw('p1', 'p3', 'p8'));
    const result = await summarizeWithSteps(withReferences, generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0]).toContain('Step 3. Verify [p5]');
    expect(missingSteps(detectSteps(withReferences), result).map((s) => s.number)).toEqual([3]);
  });
  it.each([
    [['p1'], ['p1', 'p3', 'p5'], 'p1,p3,p5'],
    [['p1', 'p3'], ['p1'], 'p1,p3'],
    [['p1'], ['p3'], 'p3'],
  ])('keeps fewer missing steps and prefers second on ties', async (first, second, expected) => {
    const generate = vi.fn().mockResolvedValueOnce(raw(...first)).mockResolvedValueOnce(raw(...second));
    expect((await summarizeWithSteps(content, generate)).overview).toBe(expected);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]![0]).toContain('Step 3. Verify [p5]');
  });
  it('does not retry a complete response or an undetected page', async () => {
    const generate = vi.fn().mockResolvedValue(raw('p1', 'p3', 'p5'));
    await summarizeWithSteps(content, generate); expect(generate).toHaveBeenCalledTimes(1);
    generate.mockClear(); await summarizeWithSteps('plain', generate); expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each(['invalid JSON', new Error('timeout'), new Error('aborted')])('falls back when retry fails: %s', async (failure) => {
    const generate = vi.fn().mockResolvedValueOnce(raw('p1'));
    if (typeof failure === 'string') generate.mockResolvedValueOnce(failure); else generate.mockRejectedValueOnce(failure);
    expect((await summarizeWithSteps(content, generate)).overview).toBe('p1');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('bounds retry time even if the injected transport hangs', async () => {
    vi.useFakeTimers();
    try {
      const generate = vi.fn().mockResolvedValueOnce(raw('p1')).mockImplementationOnce(() => new Promise(() => {}));
      const result = summarizeWithSteps(content, generate);
      await vi.advanceTimersByTimeAsync(90_000);
      expect((await result).overview).toBe('p1');
      expect(generate.mock.calls[1]![1].aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('propagates cancellation to an active retry and retains first response', async () => {
    const ac = new AbortController();
    const generate = vi.fn().mockResolvedValueOnce(raw('p1')).mockImplementationOnce((_feedback, signal) => {
      expect(signal.aborted).toBe(false); ac.abort(); expect(signal.aborted).toBe(true);
      return new Promise(() => {});
    });
    expect((await summarizeWithSteps(content, generate, ac.signal)).overview).toBe('p1');
  });
  it('does not begin a retry after cancellation', async () => {
    const ac = new AbortController();
    const generate = vi.fn(async () => { ac.abort(); return raw('p1'); });
    await summarizeWithSteps(content, generate, ac.signal); expect(generate).toHaveBeenCalledTimes(1);
  });
});
