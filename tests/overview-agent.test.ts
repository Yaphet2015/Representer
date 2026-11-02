import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { checkMarks, createOverviewDraft, overviewInput, overviewTools, runOverviewAgent, ToolsUnsupported, OVERVIEW_INLINE_MAX, type AgentDeps } from '../lib/overview-agent';
import { parseSummary } from '../lib/parse';
import { maxOutputFor, OutputTruncated, SAFE_MAX_OUTPUT } from '../lib/budget';
import type { Summary } from '../lib/types';

const page = (n: number, words = 'Some sentence about the topic of this block, with enough words to read.') =>
  Array.from({ length: n }, (_, i) => `[p${i + 1}] ${i % 10 === 0 ? `## Part ${i / 10 + 1}\n` : ''}${words} Block ${i + 1}.`).join('\n\n');
const content = page(30);

const callTool = (ext: ReturnType<typeof overviewTools>, name: string, args: any = {}) =>
  (ext as any).tools.find((t: any) => t.name === name).execute(args).then((r: any) => r.output[0].text as string);

describe('checkMarks', () => {
  it('accepts well-formed marks and a spaced ==', () => {
    expect(checkMarks('Plain [[Acme CLI]] and ==cold builds drop to 12s==; a == b')).toBeNull();
  });
  it('names the problem and where it is', () => {
    expect(checkMarks('the ==key phrase never closes')).toMatch(/never closed.*key phrase never/);
    expect(checkMarks('a [[term without end')).toMatch(/"\[\[" is never closed/);
    expect(checkMarks('stray ]] here')).toMatch(/no opening/);
    expect(checkMarks('==outer [[inner]] phrase==')).toMatch(/must not nest/);
    expect(checkMarks('[[a ==b== c]]')).toMatch(/must not nest/);
  });
});

describe('overview draft tools', () => {
  it('rejects bad input with the exact error, then accepts the fix', () => {
    const d = createOverviewDraft(content);
    expect(d.submitOverview({ text: '' })).toMatchObject({ ok: false });
    expect(d.submitOverview({ text: 'An ==unclosed phrase.' })).toMatchObject({ ok: false, error: expect.stringMatching(/never closed/) });
    expect(d.submitOverview({ text: 'An ==closed phrase==.' }).ok).toBe(true);
    const bad = d.addSection({ title: 'One', anchor: 'p99', icon: 'list', bullets: [{ text: 'x', anchor: 'p1' }] });
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/"p99" is not a block id of this page \(valid: p1-p30/) });
    expect(d.addSection({ title: 'One', anchor: 'p1', icon: 'rocket', bullets: [{ text: 'x', anchor: 'p1' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/"icon" must be one of/) });
    expect(d.addSection({ title: 'One', anchor: 'p1', icon: 'list', bullets: [{ text: 'x [[term', anchor: 'p1' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/bullet 1: .*never closed/) });
    expect(d.addSection({ title: 'One', anchor: 'p1', icon: 'list', bullets: [] })).toMatchObject({ ok: false });
    expect(d.addSection({ title: 'One', anchor: 'p1', icon: 'list', bullets: [{ text: 'first', anchor: 'p2' }] }).ok).toBe(true);
    // same title replaces
    expect(d.addSection({ title: 'One', anchor: 'p1', icon: 'list', bullets: [{ text: 'first, fixed', anchor: '[p2]' }] })).toMatchObject({ ok: true, message: expect.stringMatching(/replaced/) });
    expect(d.sectionCount).toBe(1);
    expect(d.setQuote({ text: 'not on the page at all, really', anchor: 'p3' })).toMatchObject({ ok: false });
    expect(d.setQuote({ text: 'Some sentence about the topic of this block', anchor: 'p3' }).ok).toBe(true);
    expect(d.finish().ok).toBe(true);
    expect(d.summary()!.sections[0]!.bullets).toEqual(['first, fixed']);
    expect(d.summary()!.quote).toEqual({ text: 'Some sentence about the topic of this block', anchor: 'p3' });
  });

  it('takes the first id of a range or list as the anchor', () => {
    const d = createOverviewDraft(content);
    expect(d.addSection({ title: 'R', anchor: 'p3-p5', icon: 'list', bullets: [{ text: 'x', anchor: 'p4, p6' }] }).ok).toBe(true);
    d.submitOverview({ text: 'O.' });
    expect(d.summary()!.sections[0]).toMatchObject({ anchor: 'p3', anchors: ['p4'] });
  });

  it('finish needs an overview and a section, and reminds once about uncovered steps', () => {
    const steps = ['[p1] # Guide', ...[1, 2, 3, 4].map((n) => `[p${n + 1}] ## Step ${n}: do thing ${n}\n[p${n + 10}] Details of thing ${n}.`)].join('\n\n');
    const d = createOverviewDraft(steps);
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/no overview/) });
    d.submitOverview({ text: 'Four steps.' });
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/no sections/) });
    d.addSection({ title: 'Start', anchor: 'p2', icon: 'list', bullets: [{ text: 'step one', anchor: 'p2' }] });
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/not covered/) });
    expect(d.finish().ok).toBe(true); // the reminder comes once
  });

  it('builds exactly the Summary (and so the cache entry) the JSON path would', () => {
    const d = createOverviewDraft(content);
    d.submitOverview({ text: '[[Acme]] ships ==cold builds in 12s==. More [[Acme]] text.' });
    d.addSection({ title: 'Later', anchor: 'p20', icon: 'chart', bullets: [{ text: 'b20', anchor: 'p20' }, { text: 'b18', anchor: 'p18' }] });
    d.addSection({ title: 'Early', anchor: 'p2', icon: 'list', bullets: [{ text: 'b2 ==core point==', anchor: 'p2' }] });
    d.setQuote({ text: 'Some sentence about the topic of this block', anchor: 'p5' });
    const viaTools = d.summary();
    const viaJson = parseSummary(JSON.stringify({
      overview: '[[Acme]] ships ==cold builds in 12s==. More [[Acme]] text.',
      sections: [
        { title: 'Later', anchor: 'p20', icon: 'chart', bullets: [{ text: 'b20', anchor: 'p20' }, { text: 'b18', anchor: 'p18' }] },
        { title: 'Early', anchor: 'p2', icon: 'list', bullets: [{ text: 'b2 ==core point==', anchor: 'p2' }] },
      ],
      quote: { text: 'Some sentence about the topic of this block', anchor: 'p5' },
    }), content);
    expect(viaTools).toEqual(viaJson);
    expect(parseSummary(d.json(), content)).toEqual(viaTools);
    expect(viaTools!.sections.map((s) => s.title)).toEqual(['Early', 'Later']);
  });
});

describe('submit_summary', () => {
  it('keeps the valid parts and names each invalid one', () => {
    const d = createOverviewDraft(content);
    const r = d.submitSummary({ overview: 'Fine ==phrase==.', sections: [sec('A', 2), sec('B', 99), { ...sec('C', 5), icon: 'nope' }], quote: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/1 section\(s\)[\s\S]*section 2 "B": section anchor "p99"[\s\S]*section 3 "C": "icon" must be one of/);
    expect(d.titles()).toEqual(['A']);
    expect(d.finished).toBe(false);
    // the repair: only the broken pieces, then finish; a piece left out gets one reminder
    expect(d.addSection(sec('B', 9)).ok).toBe(true);
    expect(d.finish()).toMatchObject({ ok: false, error: expect.stringMatching(/not added again: "C"/) });
    expect(d.finish().ok).toBe(true);
    expect(d.summary()!.sections.map((x) => x.title)).toEqual(['A', 'B']);
  });
  it('finishes in one call when all is valid; an unfound quote is dropped instead of costing a round', () => {
    const d = createOverviewDraft(content);
    const r = d.submitSummary({ overview: 'O.', sections: [sec('A', 2), sec('B', 9)], quote: { text: 'words that are not on this page anywhere', anchor: 'p2' } });
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/^Done \(the quote was not found/) });
    expect(d.finished).toBe(true);
    expect(d.summary()!.quote).toBeUndefined();
  });
  it('moves a quote anchored on the heading just before it to the block it is in', () => {
    const d = createOverviewDraft('[p1] ## Heading\n\n[p2] The quoted sentence lives in this paragraph, not the heading.');
    expect(d.setQuote({ text: 'The quoted sentence lives in this paragraph', anchor: 'p1' }).ok).toBe(true);
    d.submitOverview({ text: 'O.' }); d.addSection({ title: 'A', anchor: 'p1', icon: 'list', bullets: [{ text: 'x', anchor: 'p2' }] });
    expect(d.summary()!.quote!.anchor).toBe('p2');
  });
});

describe('overview input', () => {
  it('embeds short pages and outlines long ones (block ids with previews)', () => {
    expect(overviewInput('T', 'u', content)).toMatchObject({ withRead: false });
    const long = page(1000);
    expect(long.length).toBeGreaterThan(OVERVIEW_INLINE_MAX);
    const { input, withRead } = overviewInput('T', 'u', long);
    expect(withRead).toBe(true);
    expect(input).toMatch(/1000 blocks and is NOT included/);
    expect(input).toMatch(/^p1 \(\d+\): ## Part 1 Some sentence/m);
    expect(input.length).toBeLessThan(long.length / 2);
  });
});

/** a scripted model: each turn runs some tool calls and reports a stop reason */
function scripted(turns: ((call: (n: string, a?: any) => Promise<string>, signal: AbortSignal, args: (n: string, a: unknown) => void) => Promise<string | void>)[], stops: string[] = []) {
  const seen: { input: string; maxTokens: number }[] = [];
  const deps: AgentDeps = {
    turn: async (_i, input, tools, signal, maxTokens, onStop, onToolArgs) => {
      const k = seen.length;
      seen.push({ input, maxTokens });
      const reply = await turns[k]!((n, a) => callTool(tools, n, a), signal, onToolArgs);
      onStop(stops[k] ?? 'stop');
      return reply ?? '';
    },
  };
  return { deps, seen };
}
const base = { instructions: 'x', title: 'T', url: 'u', content, model: 'deepseek/deepseek-v4.1-flash' };
const sec = (title: string, p: number) => ({ title, anchor: `p${p}`, icon: 'list', bullets: [{ text: `about ${p}`, anchor: `p${p}` }] });

describe('runOverviewAgent', () => {
  it('streams submit_summary while its arguments are written, then finishes in one call', async () => {
    const partials: Summary[] = [];
    const { deps, seen } = scripted([async (call, _s, args) => {
      args('submit_summary', { overview: 'Over' });
      await new Promise((r) => setTimeout(r, 100));
      args('submit_summary', { overview: 'Overview ==so', sections: [{ title: 'A', bullets: [{ text: 'fir' }] }] });
      await call('submit_summary', { overview: 'Overview ==sorted==.', sections: [sec('A', 2), sec('B', 9)], quote: null });
    }]);
    const s = await runOverviewAgent({ ...base, onPartial: (p) => partials.push(p) }, deps);
    expect(seen.length).toBe(1);
    expect(partials[0]).toEqual({ overview: 'Over', sections: [] });
    expect(partials[1]!.sections[0]).toMatchObject({ title: 'A', bullets: ['fir'] });
    expect(partials[1]!.overview).not.toContain('==');
    expect(partials.at(-1)).toEqual(s);
  });

  it('feeds tool errors back and the model repairs them; partials stream as pieces are accepted', async () => {
    const partials: Summary[] = [], statuses: unknown[] = [];
    const replies: string[] = [];
    const { deps } = scripted([async (call) => {
      await call('submit_overview', { text: 'Overview ==bad.' }).then((r) => replies.push(r));
      await call('submit_overview', { text: 'Overview ==good==.' }).then((r) => replies.push(r));
      await call('add_section', sec('A', 99)).then((r) => replies.push(r));
      await call('add_section', sec('A', 3));
      await call('add_section', sec('B', 9));
      await call('finish');
    }]);
    const s = await runOverviewAgent({ ...base, onPartial: (p) => partials.push(p), onStatus: (x) => statuses.push(x) }, deps);
    expect(replies[0]).toMatch(/^Error: overview: the key phrase "==" is never closed/);
    expect(replies[1]).toMatch(/^Overview saved/);
    expect(replies[2]).toMatch(/^Error: section anchor "p99"/);
    expect(statuses).toContain('repairing');
    expect(partials.map((p) => p.sections.length)).toEqual([0, 1, 2]);
    expect(s.sections.map((x) => x.title)).toEqual(['A', 'B']);
  });

  it('a turn cut off by the length limit keeps what was accepted and continues with a larger budget', async () => {
    const { deps, seen } = scripted([
      async (call) => { await call('submit_overview', { text: 'Overview.' }); await call('add_section', sec('A', 2)); },
      async (call) => { await call('add_section', sec('B', 8)); await call('finish'); },
    ], ['length']);
    const s = await runOverviewAgent(base, deps);
    expect(seen[1]!.maxTokens).toBe(2 * seen[0]!.maxTokens);
    expect(seen[0]!.maxTokens).toBe(maxOutputFor('deepseek/deepseek-v4.1-flash'));
    expect(seen[1]!.input).toMatch(/already submitted the overview and 1 section\(s\) \(A\)/);
    expect(s.sections.map((x) => x.title)).toEqual(['A', 'B']);
  });

  it('drops to the safe budget when the server refuses the larger cap', async () => {
    const { deps, seen } = scripted([
      async () => { throw new Error('400 max_tokens must be <= 8192'); },
      async (call) => { await call('submit_overview', { text: 'O.' }); await call('add_section', sec('A', 2)); await call('finish'); },
    ]);
    await runOverviewAgent(base, deps);
    expect(seen[1]!.maxTokens).toBe(SAFE_MAX_OUTPUT);
  });

  it('returns the best partial summary when time runs out', async () => {
    const { deps } = scripted([async (call, signal) => {
      await call('submit_overview', { text: 'Overview.' });
      await call('add_section', sec('A', 2));
      await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    }]);
    const s = await runOverviewAgent({ ...base, deadlineMs: 50 }, deps);
    expect(s.sections.map((x) => x.title)).toEqual(['A']);
  });

  it('bounds the repair rounds: a model that keeps failing ends with a readable error, never a JSON one', async () => {
    const bad = async (call: any) => { await call('submit_overview', { text: '==never' }); };
    const { deps, seen } = scripted([bad, bad, bad, bad, bad]);
    await expect(runOverviewAgent(base, deps)).rejects.toThrow('The model did not produce a complete overview');
    expect(seen.length).toBe(4);
  });

  it('accepts a model that ignored the tools but wrote complete JSON', async () => {
    const json = JSON.stringify({ overview: 'O.', sections: [{ title: 'A', icon: 'list', anchor: 'p2', bullets: [{ text: 't', anchor: 'p2' }] }], quote: null });
    const { deps } = scripted([async () => json]);
    expect((await runOverviewAgent(base, deps)).sections[0]!.title).toBe('A');
  });

  it('a first turn without any tool call (and no usable JSON) means no tool support', async () => {
    const { deps } = scripted([async () => 'Here is a summary in prose.']);
    await expect(runOverviewAgent(base, deps)).rejects.toBeInstanceOf(ToolsUnsupported);
  });
  it('reports tools-unsupported on the first turn so the caller can fall back', async () => {
    const { deps } = scripted([async () => { throw new Error('400 this model does not support tools'); }]);
    await expect(runOverviewAgent(base, deps)).rejects.toBeInstanceOf(ToolsUnsupported);
  });
});

// the single-call fallback, with the real truncated output that broke v0.1.10
const truncated = readFileSync(new URL('./fixtures/overview-truncated.txt', import.meta.url), 'utf8');
const runTurn = vi.hoisted(() => vi.fn());
vi.mock('../lib/llm', () => ({ runTurn }));

describe('fallback without tool calling', () => {
  const s: any = { baseUrl: 'http://x', model: 'some-model', apiKey: 'k', systemPrompt: '', mock: false };
  const art = page(90);
  it('never parses truncated output: retries with twice the budget', async () => {
    const { providerFor } = await import('../lib/provider');
    expect(() => parseSummary(truncated, art)).toThrow(/Expected ',' or ']'|JSON/);
    const budgets: number[] = [];
    runTurn.mockReset();
    runTurn.mockImplementationOnce(async () => { throw new Error('tools are not supported by this model'); });
    runTurn.mockImplementationOnce(async (...a: any[]) => { budgets.push(a[8].maxTokens); expect(a[8].failOnLength).toBe(true); throw new OutputTruncated(truncated, a[8].maxTokens); });
    runTurn.mockImplementationOnce(async (...a: any[]) => { budgets.push(a[8].maxTokens); return JSON.stringify({ overview: 'Done.', sections: [{ title: 'A', icon: 'list', anchor: 'p2', bullets: [{ text: 't', anchor: 'p2' }] }], quote: null }); });
    const sum = await providerFor(s, 'en').summarize('T', 'u', art);
    expect(sum.overview).toBe('Done.');
    expect(budgets).toEqual([maxOutputFor('some-model'), 2 * maxOutputFor('some-model')]);
  });
  it('a model that is always cut off ends with a friendly message', async () => {
    const { providerFor } = await import('../lib/provider');
    runTurn.mockReset();
    runTurn.mockImplementationOnce(async () => { throw new Error('tools are not supported by this model'); });
    runTurn.mockImplementation(async (...a: any[]) => { throw new OutputTruncated(truncated, a[8].maxTokens); });
    await expect(providerFor(s, 'en').summarize('T', 'u', art)).rejects.toThrow("The model didn't return a complete overview");
    expect(runTurn).toHaveBeenCalledTimes(4); // 1 tool turn + 3 single calls, budget 16k → 32k → 64k
  });
});

describe('summary port events from the agent', () => {
  it('client passes whole partials and status through, and settles on done', async () => {
    const { streamSummary } = await import('../lib/summary-client');
    let listener!: (e: any) => void;
    const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: (f: any) => { listener = f; } }, onDisconnect: { addListener: () => {} } };
    const partials: Summary[] = [], statuses: unknown[] = [];
    const st = streamSummary({ url: 'u', title: 'T', content: '' } as any, (p) => partials.push(p), () => port, undefined, (x) => statuses.push(x));
    const p1: Summary = { overview: 'O.', sections: [] };
    listener({ partial: p1 }); listener({ status: 'repairing' }); listener({ status: null });
    listener({ done: true, summary: p1 });
    expect(await st.done).toMatchObject({ done: true });
    expect(partials).toEqual([p1]);
    expect(statuses).toEqual(['repairing', null]);
  });
});
