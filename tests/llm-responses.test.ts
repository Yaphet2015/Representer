import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { runTurn, resetLlmApiCache } from '../lib/llm';
import { testConnection } from '../lib/models';
import type { Settings } from '../lib/types';

type Hit = { path: string; body: any; auth?: string };

function sse(res: ServerResponse, events: Array<{ event?: string; data: unknown }>) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const e of events) {
    if (e.event) res.write(`event: ${e.event}\n`);
    res.write(`data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`);
  }
  res.end();
}

function writeCompletions(res: ServerResponse, model: string, text: string) {
  const chunk = (o: any) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model, choices: [o] })}\n\n`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const part of text.match(/\S+|\s+/g) ?? [text]) chunk({ index: 0, delta: { content: part }, finish_reason: null });
  chunk({ index: 0, delta: {}, finish_reason: 'stop' });
  res.end('data: [DONE]\n\n');
}

function writeResponses(res: ServerResponse, text: string) {
  const id = 'resp_test';
  const msgId = 'msg_test';
  const message = {
    type: 'message', id: msgId, role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  sse(res, [
    { event: 'response.created', data: { type: 'response.created', response: { id, status: 'in_progress', output: [] } } },
    { event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: msgId, role: 'assistant', status: 'in_progress', content: [] } } },
    { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text } },
    { event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: 0, item: message } },
    { event: 'response.completed', data: { type: 'response.completed', response: { id, status: 'completed', output: [message], usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } } } },
  ]);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => resolve(raw)); });
}

type Mode = 'responses' | 'completions' | 'both';
type Hook = (req: IncomingMessage, res: ServerResponse, path: string, body: any) => boolean | void;

async function listen(mode: Mode, hook?: Hook): Promise<{ server: Server; base: string; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const path = req.url ?? '';
      const raw = req.method === 'POST' ? await readBody(req) : '';
      const body = raw ? JSON.parse(raw) : undefined;
      hits.push({ path, body, auth: req.headers.authorization });
      if (hook?.(req, res, path, body)) return;
      if (path.includes('/responses')) {
        if (mode === 'completions') { json(res, 404, 'Cannot POST /v1/responses'); return; }
        writeResponses(res, 'Hello, world');
        return;
      }
      if (path.includes('/chat/completions')) {
        if (mode === 'responses') { json(res, 404, 'Cannot POST /v1/chat/completions'); return; }
        writeCompletions(res, body?.model ?? 'm', 'Hello, world');
        return;
      }
      json(res, 404, 'not found');
    })().catch(() => { if (!res.headersSent) json(res, 500, 'hook failed'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  return { server, base, hits };
}

const settings = (baseUrl: string): Settings => ({ baseUrl, apiKey: 'sk-test', model: 'gpt-6.1-terra', mock: false });

const pageTools = defineExtension({
  name: 'page',
  tools: [defineTool({
    name: 'read_page',
    description: 'Read part of the attached page',
    parameters: Type.Object({ offset: Type.Optional(Type.Number()) }),
    replay: 'safe',
    execute: async () => ({ output: [{ type: 'text' as const, text: 'ok' }] }),
  })],
});

describe('Responses path and silent completions fallback', () => {
  const servers: Server[] = [];
  beforeEach(() => { resetLlmApiCache(); });
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r, j) => s.close((e) => e ? j(e) : r())))); });

  async function start(mode: Mode, hook?: Hook) {
    const ctx = await listen(mode, hook);
    servers.push(ctx.server);
    return ctx;
  }

  it('sends the turn to /responses when the server supports it, without touching completions or settings', async () => {
    const { base, hits } = await start('responses');
    const s = settings(base + '/'); // trailing slash, same as many saved baseUrl values
    const deltas: string[] = [];
    const out = await runTurn(s, 'SYS', [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }], 'new q', (d) => deltas.push(d));
    expect(out).toBe('Hello, world');
    expect(deltas.join('')).toBe('Hello, world');
    expect(hits.every((h) => h.path.includes('/responses'))).toBe(true);
    expect(hits.some((h) => h.path.includes('/chat/completions'))).toBe(false);
    expect(hits.at(-1)?.auth).toBe('Bearer sk-test');
    const body = hits.at(-1)?.body;
    expect(body.model).toBe('gpt-6.1-terra');
    const flat = JSON.stringify(body.input ?? body.messages ?? body);
    for (const part of ['SYS', 'earlier q', 'earlier a', 'new q']) expect(flat).toContain(part);
    expect(s).toEqual(settings(base + '/'));
  });

  it('retries a missing /responses route on /chat/completions without surfacing the first attempt', async () => {
    for (const missing of [
      (res: ServerResponse) => json(res, 404, 'Cannot POST /v1/responses'),
      (res: ServerResponse) => { res.writeHead(404); res.end(); },
      (res: ServerResponse) => json(res, 405, { error: { message: 'Method Not Allowed' } }),
      (res: ServerResponse) => json(res, 404, { error: { message: 'unknown route' } }),
    ] as Array<(res: ServerResponse) => void>) {
      resetLlmApiCache();
      const { base, hits } = await start('both', (_req, res, path) => {
        if (path.includes('/responses')) { missing(res); return true; }
      });
      const deltas: string[] = [];
      const out = await runTurn(settings(base), 'SYS', [], 'q', (d) => deltas.push(d));
      expect(out).toBe('Hello, world');
      expect(deltas.join('')).toBe('Hello, world');
      expect(hits.some((h) => h.path.includes('/responses'))).toBe(true);
      expect(hits.some((h) => h.path.includes('/chat/completions'))).toBe(true);
    }
  });

  it('does not retry /chat/completions after a 401 or a model-not-found 404 on /responses', async () => {
    const { base: unauthorized, hits: authHits } = await start('both', (_req, res, path) => {
      if (path.includes('/responses')) { json(res, 401, { error: { message: 'invalid api key', type: 'invalid_request_error' } }); return true; }
    });
    await expect(runTurn(settings(unauthorized), 'S', [], 'q')).rejects.toThrow(/401|invalid api key/i);
    expect(authHits.some((h) => h.path.includes('/chat/completions'))).toBe(false);

    resetLlmApiCache();
    const { base: missingModel, hits: modelHits } = await start('both', (_req, res, path) => {
      if (path.includes('/responses')) {
        json(res, 404, { error: { message: "The model 'gpt-6.1-terra' does not exist or you do not have access to it.", type: 'invalid_request_error', param: 'model', code: 'model_not_found' } });
        return true;
      }
    });
    await expect(runTurn(settings(missingModel), 'S', [], 'q')).rejects.toThrow(/model/i);
    expect(modelHits.some((h) => h.path.includes('/chat/completions'))).toBe(false);
  });

  it('keeps tools and reasoning together on /responses', async () => {
    const { base, hits } = await start('responses');
    const out = await runTurn(settings(base), 'S', [], 'q', undefined, undefined, pageTools, undefined, { reasoning: 'low' });
    expect(out).toBe('Hello, world');
    expect(hits.some((h) => h.path.includes('/chat/completions'))).toBe(false);
    const body = hits.find((h) => h.path.includes('/responses'))?.body;
    expect(body.tools?.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.tools)).toContain('read_page');
    expect(body.reasoning?.effort).toBe('low');
  });

  it('turns reasoning off on the completions fallback when the request includes tools', async () => {
    const { base, hits } = await start('completions');
    const out = await runTurn(settings(base), 'S', [], 'q', undefined, undefined, pageTools, undefined, { reasoning: 'low' });
    expect(out).toBe('Hello, world');
    const body = hits.find((h) => h.path.includes('/chat/completions'))?.body;
    expect(body.tools?.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.tools)).toContain('read_page');
    expect(body.reasoning_effort).toBe('none');
  });

  it('caches a completions miss so the next turn skips /responses, then re-probes after a cache reset', async () => {
    const { base, hits } = await start('completions');
    await runTurn(settings(base), 'S', [], 'first');
    const afterFirst = hits.filter((h) => h.path.includes('/responses')).length;
    expect(afterFirst).toBeGreaterThan(0);
    await runTurn(settings(base), 'S', [], 'second');
    expect(hits.filter((h) => h.path.includes('/responses')).length).toBe(afterFirst);
    expect(hits.filter((h) => h.path.includes('/chat/completions')).length).toBe(2);

    resetLlmApiCache();
    await runTurn(settings(base), 'S', [], 'third');
    expect(hits.filter((h) => h.path.includes('/responses')).length).toBeGreaterThan(afterFirst);
  });

  it('tests the connection through /responses or a silent fallback, with the same settings shape', async () => {
    const a = await start('responses', (_req, res, path) => {
      if (path.includes('/responses')) { writeResponses(res, 'pong'); return true; }
    });
    const viaResponses = await testConnection(settings(a.base));
    expect(viaResponses.ok).toBe(true);
    expect(viaResponses.reply).toBe('pong');
    expect(a.hits.some((h) => h.path.includes('/responses'))).toBe(true);

    resetLlmApiCache();
    const b = await start('completions', (_req, res, path) => {
      if (path.includes('/chat/completions')) { writeCompletions(res, 'gpt-6.1-terra', 'pong'); return true; }
    });
    const viaFallback = await testConnection(settings(b.base));
    expect(viaFallback.ok).toBe(true);
    expect(viaFallback.reply).toBe('pong');
    expect(b.hits.some((h) => h.path.includes('/responses'))).toBe(true);
    expect(b.hits.some((h) => h.path.includes('/chat/completions'))).toBe(true);
  });
});
