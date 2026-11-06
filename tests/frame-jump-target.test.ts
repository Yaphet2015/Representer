/**
 * The jump must land on the block whose text the model saw under that id — asserted on the highlighted
 * element's text, through the production entry points (extractPageWithFrames → jumpToFingerprintTraced,
 * and the child worker's FRAME_EXTRACT / FRAME_LOCATE handlers for the cross-origin route).
 */
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPageWithFrames, installFrameWorker, isTrustedProbe, jumpToFingerprintTraced, setLastMergedPage } from '../lib/frame-bridge';
import { FRAME_COLLECT, FRAME_EXTRACT, FRAME_LOCATE } from '../lib/frame-protocol';
import { markerChunks, markerReport } from '../lib/extract';
import { countNestedContentFrames, mergeFrameParts } from '../lib/frames';

const PARAS = [
  'Expert parallelism splits the experts across GPUs and needs an all-to-all exchange every layer.',
  'A practical readiness policy is 90% of the baseline bandwidth plus a passing correctness check.',
  'Set gpu-sniff-test-interval so the watchdog re-checks NCCL health between long training steps.',
  'Forcing even routing at init made the first thousand steps about 1.5x faster in our runs.',
];
const article = (tag: string) => `<article><h1>${tag} MoE handbook overview</h1>${PARAS.map((p) => `<p>${tag} ${p}</p>`).join('')}</article>`;

function makeDoc(body: string, href: string) {
  const { document, window } = parseHTML(`<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`);
  (document as any).URL = href;
  Object.defineProperty(document, 'defaultView', { value: window, configurable: true });
  (window.Element.prototype as any).getClientRects = function () { return [{}]; };
  (window.HTMLElement.prototype as any).getBoundingClientRect = function () {
    return { width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} };
  };
  (window.HTMLElement.prototype as any).scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', { configurable: true, get() { return false; } });
  return { document: document as unknown as Document, window };
}

function useGlobals(doc: Document, win: any, href: string) {
  (globalThis as any).document = doc; (globalThis as any).window = win;
  (globalThis as any).location = { href, ancestorOrigins: { length: 0 } };
}

/** The id whose text (as the model saw it) contains `needle`, and its fingerprint. */
function idWith(page: { content: string; anchors: Record<string, any> }, needle: string) {
  const id = [...markerChunks(page.content)].find(([, t]) => t.includes(needle))?.[0];
  expect(id, `an id carrying "${needle}"`).toBeTruthy();
  return page.anchors[id!]!;
}

afterEach(() => { setLastMergedPage(null); vi.restoreAllMocks(); });

describe('jump lands on the text the model saw under the id', () => {
  it('same-origin embed: each cited paragraph highlights itself, not a neighbour', async () => {
    const top = makeDoc(`<div>shell</div><iframe id="a" src="https://space.example/one"></iframe>`, 'https://hub.example/space');
    const child = makeDoc(article('S'), 'https://space.example/one');
    const f = top.document.getElementById('a')!;
    Object.defineProperty(f, 'contentDocument', { get: () => child.document, configurable: true });
    useGlobals(top.document, top.window, 'https://hub.example/space');
    (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(async () => ({ ok: false })) } };

    const page = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    expect(markerReport(page.content, page.anchors).mismatched).toEqual([]);
    for (const needle of ['90% of the baseline', 'gpu-sniff-test-interval', '1.5x faster']) {
      const t = await jumpToFingerprintTraced(idWith(page, needle));
      expect(t.route).toBe('same-origin');
      expect(t.result).toBe('ok');
      expect(t.matched).toContain(needle);
    }
  });

  it('cross-origin embed via the real worker: right paragraph, and a cached anchor survives a new frameId', async () => {
    const SRC = 'https://moe.hf.example/';
    const top = makeDoc(`<div>shell</div><iframe id="x" src="${SRC}"></iframe>`, 'https://hub.example/space');
    const child = makeDoc(article('X'), SRC);
    const f = top.document.getElementById('x')!;
    Object.defineProperty(f, 'contentDocument', { get: () => { throw new Error('cross-origin'); }, configurable: true });
    Object.defineProperty(f, 'contentWindow', { get: () => ({ postMessage() {} }), configurable: true });

    let frameId = 7;
    const workers: any[] = [];
    /** run a child-frame handler with the child's globals, like Chrome delivering to that frame */
    const inChild = (msg: any) => new Promise<any>((resolve) => {
      const saved = [(globalThis as any).document, (globalThis as any).window, (globalThis as any).location];
      useGlobals(child.document, child.window, SRC);
      try { for (const w of workers) w(msg, {}, resolve); } finally {
        [(globalThis as any).document, (globalThis as any).window, (globalThis as any).location] = saved;
      }
    });
    (globalThis as any).chrome = { runtime: {
      onMessage: { addListener: (fn: any) => workers.push(fn) },
      sendMessage: vi.fn(async (msg: any) => {
        if (msg.type === 'rp-frame-wait-ack') return { ok: true, frameId, href: SRC };
        if (msg.type === FRAME_COLLECT) {
          const r = await inChild({ type: FRAME_EXTRACT });
          return { ok: true, frames: [{ frameId, ...r }] };
        }
        if (msg.type === FRAME_LOCATE) {
          if (msg.frameId !== frameId) return { ok: false, error: 'no such frame' };
          return await inChild(msg);
        }
        return { ok: false };
      }),
    } };
    useGlobals(child.document, child.window, SRC); installFrameWorker();
    useGlobals(top.document, top.window, 'https://hub.example/space');

    const page = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const fp90 = idWith(page, '90% of the baseline');
    const t = await jumpToFingerprintTraced(fp90);
    expect(t).toMatchObject({ route: 'cross-origin', result: 'ok', frameId: 7 });
    expect(t.matched).toContain('90% of the baseline');

    // Lazy content elsewhere in the frame changes its extract signature; the cited block is unchanged and unique.
    child.document.querySelector('article')!.insertAdjacentHTML('beforeend', '<p>Chart legend rendered later with plenty of new words in it.</p>');
    const t1 = await jumpToFingerprintTraced(fp90);
    expect(t1).toMatchObject({ route: 'cross-origin', result: 'ok', reason: 'exact' });
    expect(t1.matched).toContain('90% of the baseline');

    frameId = 11; // page reload: Chrome hands out a new frameId; the cached summary keeps f=7
    await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const t2 = await jumpToFingerprintTraced({ ...fp90, f: 7 });
    expect(t2).toMatchObject({ route: 'cross-origin', result: 'ok', frameId: 11 });
    expect(t2.matched).toContain('90% of the baseline');
  });

  it('two same-src embeds: each anchor jumps inside its own document', async () => {
    const top = makeDoc(`<iframe id="a" src="https://s.example/same"></iframe><iframe id="b" src="https://s.example/same"></iframe>`, 'https://h.example/');
    const A = makeDoc(article('ALPHA'), 'https://s.example/same');
    const B = makeDoc(article('BETA'), 'https://s.example/same');
    Object.defineProperty(top.document.getElementById('a')!, 'contentDocument', { get: () => A.document, configurable: true });
    Object.defineProperty(top.document.getElementById('b')!, 'contentDocument', { get: () => B.document, configurable: true });
    useGlobals(top.document, top.window, 'https://h.example/');
    (globalThis as any).chrome = { runtime: { sendMessage: vi.fn(async () => ({ ok: false })) } };
    const page = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const t = await jumpToFingerprintTraced(idWith(page, 'BETA A practical readiness'));
    expect(t.matched).toContain('BETA A practical readiness');
  });
});

describe('nested frame notice', () => {
  it('a complete article with chart frames inside it gets no "unread" notice; a thin shell does', () => {
    const charts = '<iframe src="/headline/index.html?title=0"></iframe><iframe src="/viz/index.html?c=a"></iframe>';
    const full = mergeFrameParts([
      { role: 'top', sk: 'top', frameId: 0, href: 'https://hub.example/', title: 'Hub', content: '[p1] Hub shell', anchors: {}, docSig: 't' },
      { role: 'embed', sk: 'embed:0', frameId: 3, href: 'https://s.example/', title: 'Handbook', content: PARAS.map((p, i) => `[p${i + 1}] ${p} ${p}`).join('\n\n'), anchors: {}, docSig: 'e', nestedContentFrames: 2 },
    ]);
    expect(full.notices.filter((n) => n.kind === 'nested_unread')).toEqual([]);
    expect(full.content).not.toMatch(/nested content frame/);
    const shell = mergeFrameParts([
      { role: 'embed', sk: 'embed:0', frameId: 3, href: 'https://s.example/', title: 'Shell', content: '[p1] Loading', anchors: {}, docSig: 'e', nestedContentFrames: 1 },
    ]);
    expect(shell.notices.some((n) => n.kind === 'nested_unread')).toBe(true);
    void charts;
  });

  it('a large video player inside the article is not unread text; a large document frame is', () => {
    const d = makeDoc(`<p>x</p><iframe src="https://www.youtube.com/embed/abc" allow="autoplay; encrypted-media"></iframe>`, 'https://a.example/');
    expect(countNestedContentFrames(d.document)).toBe(0);
    const e = makeDoc(`<p>x</p><iframe src="https://docs.example/chapter-2"></iframe>`, 'https://a.example/');
    expect(countNestedContentFrames(e.document)).toBe(1);
  });
});

describe('probe trust', () => {
  it('only a direct child of the top page answers, and only to its parent', () => {
    const top: any = {}; top.parent = top; top.top = top;
    const child: any = { parent: top, top };
    const grandchild: any = { parent: child, top };
    expect(isTrustedProbe({ source: top } as any, child)).toBe(true);
    expect(isTrustedProbe({ source: child } as any, grandchild)).toBe(false); // nonce forwarded by a candidate
    expect(isTrustedProbe({ source: top } as any, grandchild)).toBe(false);
    expect(isTrustedProbe({ source: {} } as any, child)).toBe(false);
    expect(isTrustedProbe({ source: top } as any, top)).toBe(false); // top never acks itself
  });
});
