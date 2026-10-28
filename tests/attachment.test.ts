import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AbortError, isAbort, raceAbort } from '../lib/abort';
import { attachmentPrompt, INLINE_MAX, outline, readPage, READ_MAX, searchPage } from '../lib/attachment';
import { runTurn } from '../lib/llm';
import { pageTools } from '../lib/page-tools';
import { chatSystem } from '../lib/prompts';
import type { Summary } from '../lib/types';

/** a page of 150 blocks: [p1] title, then sections with headings every 10 blocks */
const block = (i: number) => (i === 1 ? `# [p1] Widgets in depth` : i % 10 === 2 ? `## [p${i}] Part ${Math.floor(i / 10) + 1}` : `[p${i}] Paragraph ${i} about ${i % 7 === 0 ? 'zebra crossings' : 'ordinary things'}. ${'lorem ipsum '.repeat(8)}`);
const LONG = Array.from({ length: 150 }, (_, i) => block(i + 1)).join('\n\n');
const SHORT = '# [p1] Tiny\n\n[p2] Just a few words about cats.';
const summary: Summary = { overview: 'An overview.', sections: [{ title: 'S', icon: 'list', bullets: ['b'] }] };

describe('outline', () => {
  it('reports size, block ids and headings with their block', () => {
    const o = outline(LONG);
    expect(o.blocks).toBe(150); expect(o.first).toBe(1); expect(o.last).toBe(150); expect(o.chars).toBe(LONG.length);
    expect(o.headings[0]).toBe('Widgets in depth [p1]');
    expect(o.headings).toContain('  Part 2 [p12]');
  });
});

describe('readPage', () => {
  it('reads an inclusive block range and says how big the page is', () => {
    const r = readPage(LONG, { blocks: 'p3-p4' });
    expect(r).toMatch(/^\[page\.md · characters \d+-\d+ of \d+\]/);
    expect(r).toContain('[p3] Paragraph 3'); expect(r).toContain('[p4] Paragraph 4'); expect(r).not.toContain('[p5]'); expect(r).not.toContain('[p2]');
    expect(readPage(LONG, { blocks: '7' })).toContain('[p7] Paragraph 7');
  });
  it('reads a character window and says where to continue', () => {
    const a = readPage(LONG, { offset: 0, limit: 500 });
    expect(a).toContain('continue with offset=500');
    const b = readPage(LONG, { offset: 500, limit: 500 });
    expect(b).toContain('characters 500-1000'); expect(a.split('\n').slice(1).join('\n') + b.split('\n').slice(1).join('\n')).toBe(LONG.slice(0, 1000));
    expect(readPage(LONG, { offset: LONG.length - 10, limit: 100 })).toContain('end of page');
    expect(readPage(LONG, { offset: LONG.length + 5 })).toContain('end of page');
  });
  it('caps one read, truncated block ranges say where to continue, and bad input gets a message', () => {
    expect(readPage(LONG, { offset: 0, limit: 10 ** 9 }).length).toBeLessThanOrEqual(READ_MAX + 200);
    expect(readPage(LONG, { blocks: "p1-p150", limit: 300 })).toMatch(/truncated, continue with offset=\d+/);
    expect(readPage(LONG, { blocks: 'nonsense' })).toMatch(/^Error: blocks must look like/);
    expect(readPage(LONG, { blocks: 'p900' })).toMatch(/No blocks in range/);
  });
});

describe('searchPage', () => {
  it('lists matching blocks with ids and snippets, case-insensitively, all words required', () => {
    const r = searchPage(LONG, 'ZEBRA crossings');
    expect(r).toMatch(/block\(s\) match/); expect(r).toContain('[p7] '); expect(r).toContain('[p14] ');
    expect(r).toMatch(/showing the first 8/);
    expect(searchPage(LONG, 'zebra giraffe')).toMatch(/^No block contains/);
    expect(searchPage(LONG, '  ')).toMatch(/^Error/);
  });
});

describe('chatSystem without a summary', () => {
  it('short pages are embedded as the page.md attachment, without block ids and without tools', () => {
    expect(SHORT.length).toBeLessThanOrEqual(INLINE_MAX);
    const p = chatSystem('Cats', null, SHORT);
    expect(p).toContain('<attachment name="page.md">'); expect(p).toContain('Just a few words about cats.');
    expect(p).not.toContain('[p2]'); expect(p).not.toContain('Summary (JSON)'); expect(p).not.toContain('read_page');
    expect(pageTools(SHORT)).toBeNull();
  });
  it('long pages are not embedded: the prompt names the attachment, the tools and an outline', () => {
    expect(LONG.length).toBeGreaterThan(INLINE_MAX);
    const p = chatSystem('Widgets', undefined, LONG);
    expect(p).toContain('attached as page.md'); expect(p).toContain('read_page'); expect(p).toContain('search_page');
    expect(p).toContain('<attachment_outline name="page.md">'); expect(p).toContain('Part 2 [p12]');
    expect(p).not.toContain('Paragraph 30'); expect(p).not.toContain('Summary (JSON)'); expect(p).not.toContain('<page_content>');
    expect(p).toContain('Never show the [pN] ids');
    expect(attachmentPrompt('W', LONG)).toContain("150 blocks");
  });
  it('carries the user instructions like the summary prompt does', () => {
    const p = chatSystem('W', null, SHORT, 'Reply in French');
    expect(p).toContain('<user_instructions>\nReply in French\n</user_instructions>');
    expect(p.match(/Reply in French/g)!.length).toBe(2);
  });
  it('with a summary the prompt is the one it always was (summary JSON + page content, no attachment)', () => {
    const p = chatSystem('Widgets', summary, LONG);
    expect(p).toContain('Summary (JSON): {"overview":"An overview."');
    expect(p).toContain('<page_content>'); expect(p).toContain('Paragraph 30'); expect(p).not.toContain('[p30]');
    expect(p).not.toContain('page.md'); expect(p).not.toContain('read_page');
  });
  it('offers the tools only for long pages', () => {
    const ext = pageTools(LONG)!;
    expect(ext.name).toBe('page'); expect(ext.tools!.map((t) => t.name)).toEqual(['read_page', 'search_page']);
  });
});

describe('raceAbort', () => {
  it('settles with the work when not aborted', async () => {
    expect(await raceAbort(Promise.resolve(7), new AbortController().signal)).toBe(7);
  });
  it('rejects with an AbortError as soon as the signal fires, even if the work never settles', async () => {
    const ac = new AbortController();
    const p = raceAbort(new Promise<never>(() => {}), ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
    await raceAbort(Promise.resolve(1), ac.signal).catch((e) => expect(isAbort(e)).toBe(true));
  });
});

// ── the model really reads the attachment through the tool, and a turn can be aborted ─────────────
let server: Server; let base = ''; const requests: any[] = [];
let mode: 'tools' | 'hang' = 'tools';
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', async () => {
      const body = JSON.parse(raw); requests.push(body);
      if (mode === 'hang') return; // never answers
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o: any) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [o] })}\n\n`);
      const toolMsg = [...body.messages].reverse().find((m: any) => m.role === 'tool');
      if (!toolMsg) {
        chunk({ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_page', arguments: '' } }] }, finish_reason: null });
        chunk({ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ blocks: 'p7' }) } }] }, finish_reason: null });
        chunk({ index: 0, delta: {}, finish_reason: 'tool_calls' });
      } else {
        const t = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
        chunk({ index: 0, delta: { content: t.includes('zebra crossings') ? 'ANSWER: it is about zebra crossings' : 'ANSWER: tool result missing' }, finish_reason: null });
        chunk({ index: 0, delta: {}, finish_reason: 'stop' });
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
});
afterAll(() => { server.closeAllConnections?.(); server.close(); });
const settings = () => ({ baseUrl: base, apiKey: 'k', model: 'm', mock: false });

describe('runTurn with the page tools', () => {
  it('the model reads a block through read_page and answers from the result', async () => {
    mode = 'tools'; requests.length = 0;
    const out = await runTurn(settings(), chatSystem('Widgets', null, LONG), [], 'What is paragraph 7 about?', undefined, undefined, pageTools(LONG));
    expect(out).toContain('ANSWER: it is about zebra crossings');
    const first = requests[0];
    expect(first.tools.map((t: any) => t.function.name).sort()).toEqual(['read_page', 'search_page']);
    expect(JSON.stringify(first.messages)).toContain('attached as page.md');
    expect(JSON.stringify(first.messages)).not.toContain('Paragraph 30');
  }, 20000);
  it('a turn without tools sends none (summary mode is unchanged)', async () => {
    mode = 'tools'; requests.length = 0;
    await runTurn(settings(), 'S', [], 'q', undefined, undefined, null).catch(() => {});
    expect(requests[0].tools).toBeUndefined();
  }, 20000);
  it('aborting stops a pending model call with an AbortError, and an already aborted signal never calls the model', async () => {
    mode = 'hang'; requests.length = 0;
    const ac = new AbortController();
    const p = runTurn(settings(), 'S', [], 'q', undefined, ac.signal);
    setTimeout(() => ac.abort(), 300);
    const t0 = Date.now();
    await expect(p).rejects.toSatisfy((e) => isAbort(e));
    expect(Date.now() - t0).toBeLessThan(5000);
    const done = new AbortController(); done.abort(); const n = requests.length;
    await expect(runTurn(settings(), 'S', [], 'q', undefined, done.signal)).rejects.toSatisfy((e) => isAbort(e));
    expect(requests.length).toBe(n);
  }, 20000);
});
