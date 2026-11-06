/**
 * Premise under attack (failed twice under browser acceptance):
 *   "Chrome frameId on fingerprints (fp.f) plus a docSig computed interchangeably
 *    from Defuddle markdown OR body.innerText is enough to locate and validate."
 *
 * These tests hit production entrypoints: installFrameWorker handlers and
 * extractPageWithFrames → jumpToFingerprint — not relay/merge stubs with docSig:'s'.
 */
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractPageWithFrames, installFrameWorker, jumpToFingerprint, setLastMergedPage, getLastMergedPage,
} from '../lib/frame-bridge';
import { FRAME_EXTRACT, FRAME_LOCATE, FRAME_PING } from '../lib/frame-protocol';
import { docSignature, listCandidateIframes, mergeFrameParts, type FramePart } from '../lib/frames';
import { extractDocument } from '../lib/extract';
import { pageShift, liveIndex as liveIndexFn, type Fingerprint } from '../lib/locate';

type Listener = (msg: any, sender: any, reply: (r: any) => void) => boolean | void;

function articleBody(seed: string) {
  return `
    <article>
      <h1>${seed} Handbook Title With Enough Letters</h1>
      <p>${seed} first paragraph explains mixture of experts training in depth for engineers.</p>
      <p>${seed} second paragraph covers routing load balance and all-to-all communication costs.</p>
      <p>${seed} third paragraph gives hardware checklist and environment requirements clearly.</p>
    </article>`;
}

function makeDoc(body: string, href = 'https://example.com/page') {
  const { document, window } = parseHTML(`<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`);
  (document as any).URL = href;
  Object.defineProperty(document, 'defaultView', { value: window, configurable: true });
  (window.Element.prototype as any).getClientRects = function () { return [{}]; };
  (window.HTMLElement.prototype as any).getBoundingClientRect = function () {
    return { width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} };
  };
  (window.Element.prototype as any).scrollIntoView = function () {};
  (window.HTMLElement.prototype as any).scrollIntoView = function () {};
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute('contenteditable') === 'true' || this.getAttribute('contenteditable') === ''; },
  });
  return { document: document as unknown as Document, window };
}

function installChromeMock() {
  const listeners: Listener[] = [];
  const sendMessage = vi.fn(async (msg: any) => {
    // Default: no frames registered for COLLECT etc.
    if (msg?.type === 'rp-frame-wait-ack') return { ok: false, error: 'no ack' };
    return { ok: false, error: 'unhandled ' + msg?.type };
  });
  (globalThis as any).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => { listeners.push(fn); },
        removeListener: (fn: Listener) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
      sendMessage,
    },
  };
  return {
    listeners,
    sendMessage,
    /** Deliver a runtime message to every installed worker listener (production path). */
    async deliver(msg: any): Promise<any> {
      return await new Promise((resolve, reject) => {
        let answered = false;
        const reply = (r: any) => { answered = true; resolve(r); };
        for (const fn of listeners) {
          try {
            const keep = fn(msg, {}, reply);
            if (keep && !answered) {
              // async reply expected — give microtasks a turn
            }
          } catch (e) { reject(e); return; }
        }
        queueMicrotask(() => { if (!answered) resolve(undefined); });
      });
    },
  };
}

describe('premise: extract signature must match locate signature (worker entry)', () => {
  let chromeMock: ReturnType<typeof installChromeMock>;
  let prevDoc: any;
  let prevLoc: any;

  beforeEach(() => {
    chromeMock = installChromeMock();
    prevDoc = (globalThis as any).document;
    prevLoc = (globalThis as any).location;
  });
  afterEach(() => {
    setLastMergedPage(null);
    (globalThis as any).document = prevDoc;
    (globalThis as any).location = prevLoc;
    vi.restoreAllMocks();
  });

  it('FRAME_EXTRACT → FRAME_LOCATE succeeds on unchanged DOM; fails stale after real content change', async () => {
    const { document, window } = makeDoc(articleBody('MoE'));
    (globalThis as any).document = document;
    (globalThis as any).window = window;
    (globalThis as any).location = { href: 'https://embed.example.com/handbook', ancestorOrigins: { length: 1 } };

    installFrameWorker();

    const extracted = await chromeMock.deliver({ type: FRAME_EXTRACT });
    expect(extracted?.ok).toBe(true);
    expect(extracted.content.length).toBeGreaterThan(80);
    expect(extracted.docSig).toBeTruthy();
    // Premise check: stub docSig:'s' would hide the bug — require real extract signature
    expect(extracted.docSig).not.toBe('s');
    const fromExtract = docSignature(extracted.content);
    expect(extracted.docSig).toBe(fromExtract);

    const fp = Object.values(extracted.anchors as Record<string, Fingerprint>)[0]!;
    expect(fp).toBeTruthy();

    const located = await chromeMock.deliver({
      type: FRAME_LOCATE,
      fingerprint: fp,
      expectHref: extracted.href,
      expectDocSig: extracted.docSig,
    });
    expect(located?.ok).toBe(true);
    expect(located.found).toBe(true);
    expect(located.stale).toBeFalsy();

    // Change the actual article DOM (not a stub flag)
    document.querySelector('article')!.innerHTML = articleBody('CHANGED-CONTENT-XYZ');
    const stale = await chromeMock.deliver({
      type: FRAME_LOCATE,
      fingerprint: fp,
      expectHref: extracted.href,
      expectDocSig: extracted.docSig,
    });
    expect(stale?.ok).toBe(false);
    expect(stale?.stale).toBe(true);
  });

  it('PING docSig matches EXTRACT docSig on the same unchanged document', async () => {
    const { document, window } = makeDoc(articleBody('Ping'));
    (globalThis as any).document = document;
    (globalThis as any).window = window;
    (globalThis as any).location = { href: 'https://embed.example.com/x', ancestorOrigins: { length: 1 } };
    installFrameWorker();
    const extracted = await chromeMock.deliver({ type: FRAME_EXTRACT });
    const ping = await chromeMock.deliver({ type: FRAME_PING });
    expect(ping?.ok).toBe(true);
    expect(ping.docSig).toBe(extracted.docSig);
  });
});

describe('premise: source key not volatile frameId (extract→jump entry)', () => {
  let chromeMock: ReturnType<typeof installChromeMock>;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });
  afterEach(() => {
    setLastMergedPage(null);
    vi.restoreAllMocks();
  });

  it('extractPageWithFrames → jumpToFingerprint ok; cache-like reload with new frameId still locates via stable source key', async () => {
    const { document, window } = makeDoc(`
      <div id="shell">HF shell chrome only</div>
      <iframe id="a" src="https://app.example.com/one"></iframe>
    `);
    const iframe = document.getElementById('a') as HTMLIFrameElement;
    const child = makeDoc(articleBody('EmbedA'), 'https://app.example.com/one');
    Object.defineProperty(iframe, 'contentDocument', { get: () => child.document, configurable: true });
    Object.defineProperty(iframe, 'src', { get: () => 'https://app.example.com/one', configurable: true });

    (globalThis as any).document = document;
    (globalThis as any).window = window;
    (globalThis as any).location = { href: 'https://hf.example.com/space', ancestorOrigins: { length: 0 } };

    // No cross-origin collect needed — same-origin contentDocument path
    const page1 = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    expect(page1.content).toMatch(/EmbedA|mixture|experts|Handbook/i);
    const embedSources = page1.sources.filter((s) => s.role === 'embed');
    expect(embedSources.length).toBeGreaterThanOrEqual(1);
    const sk = (embedSources[0] as any).sk;
    expect(sk, 'stable source key required on FrameSource').toBeTruthy();

    const anchorId = Object.keys(page1.anchors).find((id) => page1.anchors[id]?.sk === sk || (page1.anchors[id] as any)?.sk === sk)!;
    // Prefer any embed anchor
    const embedFp = Object.values(page1.anchors).find((fp) => (fp as any).sk?.startsWith?.('embed') || (fp.f != null && fp.f !== 0))!;
    expect(embedFp).toBeTruthy();
    expect((embedFp as any).sk, 'fingerprint must carry stable source key, not only frameId').toBeTruthy();

    const r1 = await jumpToFingerprint(embedFp);
    expect(r1).toBe('ok');

    // Simulate reload: re-extract (new generation / transport ids), cache keeps old fp.f but same sk+ds
    const page2 = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const src2 = page2.sources.find((s) => s.sk === (embedFp as any).sk);
    expect(src2).toBeTruthy();
    expect(src2!.sk).toBe((embedFp as any).sk);
    setLastMergedPage(page2);

    // Cached fingerprint with a WRONG volatile frameId must still locate via sk
    const cachedFp = { ...embedFp, f: 99999 };
    const r2 = await jumpToFingerprint(cachedFp);
    expect(r2).toBe('ok');
  });

  it('rejects jump when the embed document content actually changed', async () => {
    const { document, window } = makeDoc(`<iframe id="a" src="https://app.example.com/one"></iframe>`);
    const iframe = document.getElementById('a') as HTMLIFrameElement;
    const child = makeDoc(articleBody('Stable'), 'https://app.example.com/one');
    Object.defineProperty(iframe, 'contentDocument', { get: () => child.document, configurable: true });
    Object.defineProperty(iframe, 'src', { get: () => 'https://app.example.com/one', configurable: true });
    (globalThis as any).document = document;
    (globalThis as any).window = window;
    (globalThis as any).location = { href: 'https://hf.example.com/space', ancestorOrigins: { length: 0 } };

    const page = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const fp = Object.values(page.anchors).find((a) => (a as any).sk?.startsWith?.('embed') || a.f) !;
    expect(await jumpToFingerprint(fp)).toBe('ok');

    child.document.querySelector('article')!.innerHTML = articleBody('MUTATED-DOC');
    // Re-extract updates lastMerge signatures; cached fp still points at old identity/sig expectations
    await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    // Jump with OLD fingerprint (as a cached summary would) against new DOM
    const r = await jumpToFingerprint(fp);
    expect(r).toBe('stale');
  });

  it('two same-origin embeds with identical src do not cross-bind', async () => {
    const { document, window } = makeDoc(`
      <iframe id="a" src="https://app.example.com/same"></iframe>
      <iframe id="b" src="https://app.example.com/same"></iframe>
    `);
    const a = document.getElementById('a') as HTMLIFrameElement;
    const b = document.getElementById('b') as HTMLIFrameElement;
    const childA = makeDoc(articleBody('ALPHA-UNIQUE-TOKEN'), 'https://app.example.com/same');
    const childB = makeDoc(articleBody('BETA-UNIQUE-TOKEN'), 'https://app.example.com/same');
    Object.defineProperty(a, 'contentDocument', { get: () => childA.document, configurable: true });
    Object.defineProperty(b, 'contentDocument', { get: () => childB.document, configurable: true });
    Object.defineProperty(a, 'src', { get: () => 'https://app.example.com/same', configurable: true });
    Object.defineProperty(b, 'src', { get: () => 'https://app.example.com/same', configurable: true });
    (globalThis as any).document = document;
    (globalThis as any).window = window;
    (globalThis as any).location = { href: 'https://host.example.com/', ancestorOrigins: { length: 0 } };

    const page = await extractPageWithFrames({ totalMs: 10, gapMs: 1 });
    const embeds = page.sources.filter((s) => s.role === 'embed');
    expect(embeds.length).toBe(2);
    expect((embeds[0] as any).sk).not.toBe((embeds[1] as any).sk);

    const fpA = Object.values(page.anchors).find((fp) => fp.head.includes('ALPHA') || page.content.includes('ALPHA') && (fp as any).sk === (embeds[0] as any).sk)!;
    const fpB = Object.values(page.anchors).find((fp) => (fp as any).sk === (embeds[1] as any).sk)!;
    // Resolve by matching content tokens in anchors
    const bySk0 = Object.values(page.anchors).filter((fp) => (fp as any).sk === (embeds[0] as any).sk);
    const bySk1 = Object.values(page.anchors).filter((fp) => (fp as any).sk === (embeds[1] as any).sk);
    expect(bySk0.length).toBeGreaterThan(0);
    expect(bySk1.length).toBeGreaterThan(0);
    expect(bySk0[0]!.h).not.toBe(bySk1[0]!.h);

    expect(await jumpToFingerprint(bySk0[0]!)).toBe('ok');
    expect(await jumpToFingerprint(bySk1[0]!)).toBe('ok');
  });
});

describe('top pageShift ignores embed ordinals', () => {
  it('does not let embed local ordinals skew top shift', () => {
    const { document } = makeDoc(`
      <article>
        <p id="a">Alpha unique top paragraph with enough letters for hashing yes.</p>
        <p id="b">Bravo unique top paragraph with enough letters for hashing yes.</p>
      </article>`);
    const live = liveIndexFn(document);
    const topA = live.fps[0]!;
    const topB = live.fps[1]!;
    const anchors = {
      p1: { ...topA, sk: 'top' as const, o: 0 },
      p2: { ...topB, sk: 'top' as const, o: 1 },
      p99: { ...topA, sk: 'embed:0', o: 50, h: 'no-such-hash-zzzz' },
      p100: { h: topA.h, n: topA.n, head: topA.head, o: 80, sk: 'embed:1' },
    };
    // If embed o=80 matched topA uniquely it would skew shift to 0-80; must stay ~0
    expect(Math.abs(pageShift(live, anchors))).toBeLessThan(2);
  });
});

describe('candidate visibility + empty-page notices', () => {
  it('excludes visibility:hidden and opacity:0 iframes', () => {
    const { document } = makeDoc('');
    const hidden = document.createElement('iframe') as HTMLIFrameElement;
    hidden.src = 'https://app.example.com/hidden';
    hidden.setAttribute('style', 'visibility:hidden;width:900px;height:700px');
    (hidden as any).getBoundingClientRect = () => ({ width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} });
    document.body!.appendChild(hidden);

    const faded = document.createElement('iframe') as HTMLIFrameElement;
    faded.src = 'https://app.example.com/faded';
    faded.setAttribute('style', 'opacity:0;width:900px;height:700px');
    (faded as any).getBoundingClientRect = () => ({ width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} });
    document.body!.appendChild(faded);

    const ok = document.createElement('iframe') as HTMLIFrameElement;
    ok.src = 'https://app.example.com/ok';
    (ok as any).getBoundingClientRect = () => ({ width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} });
    document.body!.appendChild(ok);

    const list = listCandidateIframes(document);
    expect(list.map((e) => e.src)).toEqual([ok.src]);
  });
});
