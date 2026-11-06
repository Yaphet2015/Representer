import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import {
  FRAME_EXCLUDE_RE, TOP_FRAME_ID, blockCount, dedupeContent, embedScore, isContentCandidate,
  isExcludedFrame, isSubstantialContent, isThinContent, listCandidateIframes, mergeFrameParts,
  plainLength, remapPart, urlsLooselyEqual, type FramePart,
} from '../lib/frames';
import type { Anchors } from '../lib/locate';

const docOf = (body: string) => parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as unknown as Document;

function iframe(doc: Document, attrs: Record<string, string>, size = { w: 900, h: 700 }) {
  const el = doc.createElement('iframe') as HTMLIFrameElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  (el as any).getBoundingClientRect = () => ({ width: size.w, height: size.h, top: 0, left: 0, bottom: size.h, right: size.w, x: 0, y: 0, toJSON() {} });
  doc.body.appendChild(el);
  return el;
}

function part(over: Partial<FramePart> & { content: string; role: 'top' | 'embed' }): FramePart {
  const anchors: Anchors = {};
  for (const m of over.content.matchAll(/\[p(\d+)\]/g)) {
    const id = `p${m[1]}`;
    anchors[id] = { h: `${over.role}-${over.href ?? ''}-${m[1]}-${over.content.slice(0, 24)}`, n: 40, head: `head-${m[1]}`, o: Number(m[1]) - 1 };
  }
  const frameId = over.frameId ?? (over.role === 'top' ? TOP_FRAME_ID : 2);
  const sk = over.sk ?? (over.role === 'top' ? 'top' : `embed:${frameId}`);
  return {
    title: over.title ?? 't',
    content: over.content,
    anchors: over.anchors ?? anchors,
    sk,
    frameId,
    href: over.href ?? (over.role === 'top' ? 'https://example.com/page' : 'https://app.example.com/'),
    role: over.role,
    embedSrc: over.embedSrc,
    candidateIndex: over.candidateIndex,
    nestedContentFrames: over.nestedContentFrames,
    docSig: over.docSig ?? `sig-${over.role}-${over.content.length}`,
  };
}

describe('iframe candidate filters', () => {
  it('rejects ads, login, pay, chat and tiny trackers', () => {
    const doc = docOf('');
    expect(isExcludedFrame(iframe(doc, { src: 'https://ads.example.com/banner', id: 'ad-slot' }))).toBe(true);
    expect(isExcludedFrame(iframe(doc, { src: 'https://example.com/login', name: 'signin' }))).toBe(true);
    expect(isExcludedFrame(iframe(doc, { src: 'https://pay.example.com/checkout' }))).toBe(true);
    expect(isExcludedFrame(iframe(doc, { 'aria-label': 'chat widget', src: 'https://cdn.example.com/w' }))).toBe(true);
    expect(FRAME_EXCLUDE_RE.test('https://www.google-analytics.com/collect')).toBe(true);
  });

  it('keeps a large app iframe and drops a 1x1 pixel', () => {
    const doc = docOf('');
    const main = iframe(doc, { src: 'https://app.example.com/', 'aria-label': 'docker space app' }, { w: 1000, h: 800 });
    const pixel = iframe(doc, { src: 'https://track.example.com/p.gif' }, { w: 1, h: 1 });
    expect(isContentCandidate(main)).toBe(true);
    expect(isContentCandidate(pixel)).toBe(false);
    expect(listCandidateIframes(doc).map((e) => e.src)).toEqual([main.src]);
  });
});

describe('thin vs substantial', () => {
  it('treats shell chrome as thin and a handbook body as substantial', () => {
    const shell = '[p1] huggingface / moe-blogpost Like 81 Refreshing';
    const body = Array.from({ length: 8 }, (_, i) => `[p${i + 1}] ${'Mixture of experts training handbook paragraph with enough text. '.repeat(3)}`).join('\n\n');
    expect(isThinContent(shell)).toBe(true);
    expect(isSubstantialContent(body)).toBe(true);
    expect(plainLength(body)).toBeGreaterThan(400);
    expect(blockCount(body)).toBe(8);
  });
});

describe('remap and dedupe', () => {
  it('renumbers markers, stamps frame ids, and keeps local ordinals', () => {
    const p = part({ role: 'embed', frameId: 7, content: '[p1] Alpha text here for hashing.\n\n[p2] Beta text here for hashing.' });
    const r = remapPart(p, 3, 'gen-1');
    expect(r.content).toContain('[p4]');
    expect(r.content).toContain('[p5]');
    expect(r.anchors.p4!.f).toBe(7);
    expect(r.anchors.p4!.sk).toBe('embed:7');
    expect(r.anchors.p4!.o).toBe(0);
    expect(r.anchors.p5!.o).toBe(1);
    expect(r.anchors.p4!.g).toBe('gen-1');
    expect(r.next).toBe(5);
  });

  it('drops embed chunks whose fingerprint already appeared in top', () => {
    const seen = new Set(['h1']);
    const anchors: Anchors = {
      p1: { h: 'h1', n: 40, head: 'same', o: 0, f: 2 },
      p2: { h: 'h2', n: 40, head: 'other', o: 1, f: 2 },
    };
    const d = dedupeContent('[p1] Same as top.\n\n[p2] Unique embed paragraph with enough letters.', anchors, seen);
    expect(d.content).not.toContain('[p1]');
    expect(d.content).toContain('[p2]');
    expect(d.anchors.p1).toBeUndefined();
    expect(d.anchors.p2).toBeTruthy();
  });
});

describe('mergeFrameParts', () => {
  it('uses the embed as primary when the top page is only a shell', () => {
    const top = part({
      role: 'top',
      title: 'Shell - a Hugging Face Space',
      content: '[p1] Like 81 Refreshing',
    });
    const embed = part({
      role: 'embed',
      frameId: 3,
      title: 'The Ultimate MoE Training Handbook',
      href: 'https://app.example.com/',
      content: Array.from({ length: 6 }, (_, i) => `[p${i + 1}] ${'How to train a Mixture-of-Experts model at scale with real runs. '.repeat(2)}`).join('\n\n'),
    });
    const merged = mergeFrameParts([top, embed]);
    expect(merged.title).toBe('The Ultimate MoE Training Handbook');
    expect(merged.content).toMatch(/Mixture-of-Experts/);
    expect(merged.content).toMatch(/Source: main text was read from an embedded document/);
    expect(Object.values(merged.anchors).some((fp) => fp.f === 3)).toBe(true);
    expect(embedScore(embed)).toBeGreaterThan(embedScore(top));
  });

  it('keeps substantial top text and appends embed without dropping top', () => {
    const topBody = Array.from({ length: 5 }, (_, i) => `[p${i + 1}] ${'Top article introduction with a real thesis and supporting detail. '.repeat(2)}`).join('\n\n');
    const top = part({ role: 'top', title: 'Top article', content: topBody });
    const embed = part({
      role: 'embed',
      frameId: 4,
      content: '[p1] ' + 'Embedded appendix with additional figures and notes for readers. '.repeat(4),
    });
    const merged = mergeFrameParts([top, embed]);
    expect(merged.title).toBe('Top article');
    expect(merged.content).toMatch(/Top article introduction/);
    expect(merged.content).toMatch(/Embedded appendix/);
    expect(merged.content).toMatch(/top document and 1 embedded/);
    expect(isSubstantialContent(topBody)).toBe(true);
  });

  it('records nested unread only for content-candidate nested frames', () => {
    const withNested = part({
      role: 'embed',
      frameId: 5,
      nestedContentFrames: 2,
      // a thin shell whose text lives in deeper frames (a full article with charts gets no notice: frame-jump-target)
      content: '[p1] Loading the document viewer',
    });
    const decorativeOnly = part({
      role: 'embed',
      frameId: 6,
      nestedContentFrames: 0,
      content: Array.from({ length: 5 }, (_, i) => `[p${i + 1}] ${'Handbook article with a decorative empty banner iframe ignored. '.repeat(2)}`).join('\n\n'),
    });
    expect(mergeFrameParts([withNested]).notices.some((n) => n.kind === 'nested_unread' && n.count === 2)).toBe(true);
    expect(mergeFrameParts([decorativeOnly]).notices.filter((n) => n.kind === 'nested_unread')).toHaveLength(0);
  });

  it('returns empty body when nothing readable was extracted', () => {
    const merged = mergeFrameParts([]);
    expect(merged.content).toBe('');
    expect(merged.sources).toEqual([]);
  });
});

describe('urlsLooselyEqual', () => {
  it('matches the same path across theme query strings', () => {
    expect(urlsLooselyEqual(
      'https://huggingface-moe-blogpost.hf.space/?__theme=system',
      'https://huggingface-moe-blogpost.hf.space/',
    )).toBe(true);
    expect(urlsLooselyEqual('https://a.example/x', 'https://b.example/x')).toBe(false);
  });
});
