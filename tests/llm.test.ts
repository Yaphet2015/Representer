import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTurn } from '../lib/llm';

let server: Server; let base = ''; const bodies: any[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Cannot POST ' + (req.url ?? '')); return; }
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const body = JSON.parse(raw); bodies.push({ body, auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (o: any) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [o] })}\n\n`);
      for (const t of ['Hello', ', ', 'world']) chunk({ index: 0, delta: { content: t }, finish_reason: null });
      chunk({ index: 0, delta: {}, finish_reason: 'stop' });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
});
afterAll(() => server.close());

describe('pi durable LLM layer (fake OpenAI-compatible server)', () => {
  it('streams deltas, sends instructions + seeded history + BYOK key', async () => {
    const deltas: string[] = [];
    const out = await runTurn({ baseUrl: base, apiKey: 'sk-test', model: 'm1', mock: false },
      'SYS-INSTR', [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }], 'new q', (d) => deltas.push(d));
    expect(out).toBe('Hello, world');
    expect(deltas.join('')).toBe('Hello, world');
    const { body, auth } = bodies.at(-1);
    expect(auth).toBe('Bearer sk-test');
    expect(body.model).toBe('m1');
    const flat = JSON.stringify(body.messages);
    for (const s of ['SYS-INSTR', 'earlier q', 'earlier a', 'new q']) expect(flat).toContain(s);
  });
});

describe('keyless local server', () => {
  it('works without an API key (e.g. Ollama)', async () => {
    const out = await runTurn({ baseUrl: base, apiKey: '', model: 'm', mock: false }, 'S', [], 'q');
    expect(out).toBe('Hello, world');
  });
});
