import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTurn } from '../lib/llm';

const TEXT = '给设计师的三条建议：\n\n1. 让过程可见。\n2. 让用户随时接管。\n3. 先摘要后细节。';
let server: Server; let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Cannot POST ' + (req.url ?? '')); return; }
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', async () => {
      const body = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o: any) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [o] })}\n\n`);
      for (let i = 0; i < TEXT.length; i += 3) { chunk({ index: 0, delta: { content: TEXT.slice(i, i + 3) }, finish_reason: null }); await new Promise((r) => setTimeout(r, 25)); }
      chunk({ index: 0, delta: {}, finish_reason: 'stop' });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
});
afterAll(() => server.close());

describe('streaming with seeded history', () => {
  it('delivers every delta, including the first ones, when history is present', async () => {
    const history = [
      { role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'q2' }, { role: 'assistant' as const, content: 'a2' },
    ];
    for (const h of [[], history]) {
      const deltas: string[] = [];
      const out = await runTurn({ baseUrl: base, apiKey: 'k', model: 'm', mock: false }, 'S', h, 'q', (d) => deltas.push(d));
      expect(out).toBe(TEXT);
      expect(deltas.join('')).toBe(TEXT);
    }
  });
});
