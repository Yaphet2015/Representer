/**
 * The summary cache reuses an overview only for the same page text (pageHash of the merged content).
 * An iframe whose own #fragment follows the reader's scroll (HF Spaces sync it to the section in view)
 * must not change that text; anything that changes what the reader sees must.
 */
import { describe, expect, it } from 'vitest';
import { pageHash } from '../lib/cache';
import { mergeFrameParts, type FramePart } from '../lib/frames';

const BODY = ['Experts are split across GPUs and exchange tokens with an all-to-all every layer.',
  'A practical starting policy is to require 90% of the baseline bandwidth and a passing check.',
  'Forced-even routing showed how much speed an uneven load costs on our own setup.'];
const body = (paras = BODY) => paras.map((p, i) => `[p${i + 1}] ${p}`).join('\n\n');

function page(embedHref: string, content = body(), notices: Parameters<typeof mergeFrameParts>[1] = []) {
  const parts: FramePart[] = [
    { role: 'top', sk: 'top', frameId: 0, href: 'https://hub.example/spaces/x', title: 'Hub', content: '[p1] Hub shell', anchors: {}, docSig: 't' },
    { role: 'embed', sk: 'embed:0', frameId: 7, href: embedHref, embedSrc: 'https://x.space.example/?__theme=system#s-1', title: 'Handbook', content, anchors: {}, docSig: 'e' },
  ];
  return mergeFrameParts(parts, notices, 'g');
}
const key = (p: ReturnType<typeof page>) => pageHash(p.content);

describe('summary cache identity across iframe URL fragments', () => {
  it('same text, only the iframe #section changed: same key (cache hit)', () => {
    expect(key(page('https://x.space.example/?__theme=system#s-2-5'))).toBe(key(page('https://x.space.example/?__theme=system#s-1')));
  });

  it('the original embed href, fragment included, stays on the source for locating', () => {
    expect(page('https://x.space.example/?__theme=system#s-2-5').sources.find((s) => s.sk === 'embed:0')!.href)
      .toBe('https://x.space.example/?__theme=system#s-2-5');
  });

  it('a fragment-only change in an unread-frame notice does not change the key either', () => {
    const n = (h: string) => [{ kind: 'not_loaded' as const, href: h }];
    expect(key(page('https://x.space.example/', body(), n('https://ads-free.example/w#a'))))
      .toBe(key(page('https://x.space.example/', body(), n('https://ads-free.example/w#b'))));
  });

  it('a hash router that shows a different page under a new fragment: different key (miss)', () => {
    const other = body(['Chapter two is about expert capacity and token dropping.', 'Dropless training keeps a lower loss.']);
    expect(key(page('https://x.space.example/#/chapter-2', other))).not.toBe(key(page('https://x.space.example/#/chapter-1')));
  });

  it('a different query (another document) or changed text: different key (miss)', () => {
    expect(key(page('https://x.space.example/?doc=2#s-1'))).not.toBe(key(page('https://x.space.example/?doc=1#s-1')));
    const edited = body([...BODY.slice(0, 2), 'Forced-even routing was 1.5x faster at init.']);
    expect(key(page('https://x.space.example/#s-1', edited))).not.toBe(key(page('https://x.space.example/#s-1')));
  });
});
