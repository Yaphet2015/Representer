import { describe, expect, it, vi } from 'vitest';
import { createFrameRelay } from '../lib/frame-relay';
import { FRAME_ACK, FRAME_BYE, FRAME_COLLECT, FRAME_EXTRACT, FRAME_HELLO, FRAME_LOCATE, FRAME_PING } from '../lib/frame-protocol';

function mockTabs(handlers: Record<number, (msg: any) => any> = {}) {
  const sent: Array<{ tabId: number; frameId: number; msg: any }> = [];
  return {
    sent,
    api: {
      sendMessage: vi.fn(async (tabId: number, msg: object, opts: { frameId: number }) => {
        sent.push({ tabId, frameId: opts.frameId, msg });
        const h = handlers[opts.frameId];
        if (!h) throw new Error('no receiver');
        return h(msg);
      }),
    },
  };
}

function replyOf(handle: (msg: any, sender: any, reply: (r: object) => void) => boolean, msg: any, sender: any): Promise<any> {
  return new Promise((resolve) => {
    const handled = handle(msg, sender, resolve);
    if (!handled) resolve({ ok: false, error: 'unhandled' });
  });
}

describe('frame relay security + collect targeting', () => {
  it('hello trusts sender.frameId/url, not payload isTop/href', async () => {
    const { api } = mockTabs();
    const relay = createFrameRelay(api);
    await replyOf(relay.handle, { type: FRAME_HELLO, href: 'https://evil.example/', isTop: true }, {
      tabId: 1, frameId: 7, url: 'https://real.example/app',
    });
    const info = relay._frames.get(1)!.get(7)!;
    expect(info.isTop).toBe(false);
    expect(info.href).toBe('https://real.example/app');
  });

  it('rejects COLLECT / LOCATE / PING from non-top frames', async () => {
    const { api, sent } = mockTabs({
      3: () => ({ ok: true, href: 'https://x', title: '', content: 'hi', anchors: {}, nestedContentFrames: 0, docSig: 's' }),
    });
    const relay = createFrameRelay(api);
    await replyOf(relay.handle, { type: FRAME_HELLO }, { tabId: 1, frameId: 3, url: 'https://x/' });

    const child = { tabId: 1, frameId: 3, url: 'https://x/' };
    expect((await replyOf(relay.handle, { type: FRAME_COLLECT, frameIds: [3], timeoutMs: 500 }, child)).error).toMatch(/top frame only/);
    expect((await replyOf(relay.handle, { type: FRAME_LOCATE, frameId: 3, fingerprint: { h: 'a', n: 12, head: 'x', o: 0 } }, child)).error).toMatch(/top frame only/);
    expect((await replyOf(relay.handle, { type: FRAME_PING, frameId: 3 }, child)).error).toMatch(/top frame only/);
    expect(sent).toHaveLength(0);
  });

  it('COLLECT only sends EXTRACT to listed frameIds, never every hello frame', async () => {
    const extracted: number[] = [];
    const { api } = mockTabs({
      2: (msg) => { if (msg.type === FRAME_EXTRACT) extracted.push(2); return { ok: true, href: 'https://app.example/', title: 'A', content: '[p1] article body with enough letters here', anchors: { p1: { h: '1', n: 20, head: 'article', o: 0 } }, nestedContentFrames: 0, docSig: 'd2' }; },
      5: (msg) => { if (msg.type === FRAME_EXTRACT) extracted.push(5); return { ok: true, href: 'https://login.example/', title: 'Login', content: '[p1] password form secrets', anchors: {}, nestedContentFrames: 0, docSig: 'd5' }; },
      8: (msg) => { if (msg.type === FRAME_EXTRACT) extracted.push(8); return { ok: true, href: 'https://chat.example/', title: 'Chat', content: '[p1] chat widget', anchors: {}, nestedContentFrames: 0, docSig: 'd8' }; },
    });
    const relay = createFrameRelay(api);
    const top = { tabId: 9, frameId: 0, url: 'https://host.example/' };
    for (const [frameId, url] of [[2, 'https://app.example/'], [5, 'https://login.example/'], [8, 'https://chat.example/']] as const) {
      await replyOf(relay.handle, { type: FRAME_HELLO }, { tabId: 9, frameId, url });
    }

    const r = await replyOf(relay.handle, { type: FRAME_COLLECT, frameIds: [2], timeoutMs: 800 }, top);
    expect(r.ok).toBe(true);
    expect(extracted).toEqual([2]);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].frameId).toBe(2);
    expect(r.frames[0].content).toMatch(/article body/);
  });

  it('does not EXTRACT an unknown or unlisted same-src hidden frame', async () => {
    const extracted: number[] = [];
    const { api } = mockTabs({
      2: (msg) => { if (msg.type === FRAME_EXTRACT) extracted.push(2); return { ok: true, href: 'https://same.example/', title: 'vis', content: '[p1] visible article text for readers here', anchors: {}, nestedContentFrames: 0, docSig: 'a' }; },
      4: (msg) => { if (msg.type === FRAME_EXTRACT) extracted.push(4); return { ok: true, href: 'https://same.example/', title: 'hid', content: '[p1] hidden login secrets', anchors: {}, nestedContentFrames: 0, docSig: 'b' }; },
    });
    const relay = createFrameRelay(api);
    await replyOf(relay.handle, { type: FRAME_HELLO }, { tabId: 1, frameId: 2, url: 'https://same.example/' });
    await replyOf(relay.handle, { type: FRAME_HELLO }, { tabId: 1, frameId: 4, url: 'https://same.example/' });
    const top = { tabId: 1, frameId: 0, url: 'https://host.example/' };
    // Top only probed frame 2 (visible candidate)
    const r = await replyOf(relay.handle, { type: FRAME_COLLECT, frameIds: [2], timeoutMs: 800 }, top);
    expect(extracted).toEqual([2]);
    expect(r.frames[0].content).toMatch(/visible article/);
  });

  it('ACK binds nonce to the acknowledging frameId for probe mapping', async () => {
    const { api } = mockTabs();
    const relay = createFrameRelay(api, { ackTimeoutMs: 500 });
    const top = { tabId: 3, frameId: 0, url: 'https://host/' };
    const waitP = replyOf(relay.handle, { type: 'rp-frame-wait-ack', nonce: 'abc' }, top);
    await replyOf(relay.handle, { type: FRAME_ACK, nonce: 'abc' }, { tabId: 3, frameId: 11, url: 'https://embed.example/' });
    const waited = await waitP;
    expect(waited).toEqual({ ok: true, frameId: 11, href: 'https://embed.example/' });
    expect(relay._frames.get(3)!.get(11)!.href).toBe('https://embed.example/');
  });

  it('BYE forgets a frame so later COLLECT reports unknown', async () => {
    const { api } = mockTabs();
    const relay = createFrameRelay(api);
    await replyOf(relay.handle, { type: FRAME_HELLO }, { tabId: 1, frameId: 2, url: 'https://x/' });
    await replyOf(relay.handle, { type: FRAME_BYE }, { tabId: 1, frameId: 2, url: 'https://x/' });
    const r = await replyOf(relay.handle, { type: FRAME_COLLECT, frameIds: [2], timeoutMs: 300 }, { tabId: 1, frameId: 0, url: 'https://host/' });
    expect(r.frames[0].error).toMatch(/unknown frame/);
  });
});
