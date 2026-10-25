import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { bestMatch, blockTexts, findQuote, keyOf, liveIndex, MARKER_RE, numberBlocks, resolveItem, stripMarkers, usedAnchors } from '../lib/locate';

const page = (body: string) => parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;

const ARTICLE = `
  <nav><a>Home</a> · <a>About</a></nav>
  <article>
    <h2 id="h1">Origins of the press</h2>
    <p id="p1">Johannes Gutenberg combined <b>movable metal</b> type, oil-based ink, and a screw press adapted from wine-making.</p>
    <p id="p2">Within fifty years, millions of volumes circulated across Europe, reshaping religion, science, and politics.</p>
    <div class="wrap"><div id="d1">A div paragraph about cheap pamphlets that spread news between cities quickly.</div></div>
    <ul><li id="li1">Literacy rose sharply in cities with a print shop.</li></ul>
    <p id="dup1">Read more below.</p>
    <p id="p3">印刷术让知识的传播速度大大加快，书籍价格也随之下降。</p>
    <p id="dup2">Read more below.</p>
    <p id="hidden" hidden>Secret paragraph about Gutenberg wine-making presses.</p>
    <script>var s = "Within fifty years, millions of volumes";</script>
  </article>
  <representer-overlay>Within fifty years, millions of volumes circulated</representer-overlay>`;

const idOf = (el: Element | null) => el?.getAttribute('id') ?? null;

describe('numberBlocks', () => {
  it('numbers innermost text blocks in order, skipping nav, scripts, hidden nodes and our overlay', () => {
    const { blocks, anchors } = numberBlocks(page(ARTICLE));
    expect(blocks.map(idOf)).toEqual(['h1', 'p1', 'p2', 'd1', 'li1', 'dup1', 'p3', 'dup2']);
    expect(Object.keys(anchors)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(anchors.p2!.head).toMatch(/^Johannes Gutenberg combined movable metal type/);
  });
});

describe('resolving anchors on the live page', () => {
  const at = (doc: Document) => { const { anchors } = numberBlocks(doc); return anchors; };

  it('finds the same blocks after the page changes above them (late content, ads, banners)', () => {
    const doc = page(ARTICLE);
    const anchors = at(doc);
    // inject content above the article, including a block with the same text as an existing one
    const banner = doc.createElement('div');
    banner.innerHTML = '<p>Cookie banner: we use cookies to improve your experience on this website.</p><p>Read more below.</p><h2>Breaking news</h2>';
    doc.body.insertBefore(banner, doc.body.firstChild);
    const live = liveIndex(doc);
    const r = (id: string) => idOf(resolveItem(live, anchors, { anchor: id, text: 'x' }));
    expect(r('p1')).toBe('h1');
    expect(r('p2')).toBe('p1');
    expect(r('p7')).toBe('p3');
    // duplicate text: the original position wins over the injected copy
    expect(r('p6')).toBe('dup1');
    expect(r('p8')).toBe('dup2');
  });

  it('still finds a block whose text was edited a little (same start, similar length)', () => {
    const doc = page(ARTICLE);
    const anchors = at(doc);
    doc.getElementById('p2')!.textContent = 'Within fifty years, millions of volumes circulated across Europe, reshaping religion and science.';
    expect(idOf(resolveItem(liveIndex(doc), anchors, { anchor: 'p3', text: 'x' }))).toBe('p2');
  });

  it('falls back to the item text when the anchor is unknown or missing (older cached summaries)', () => {
    const live = liveIndex(page(ARTICLE));
    expect(idOf(resolveItem(live, {}, { anchor: 'p99', text: 'Millions of volumes circulated across Europe within fifty years' }))).toBe('p2');
    expect(idOf(resolveItem(live, undefined, { text: 'Millions of volumes circulated across Europe within fifty years' }))).toBe('p2');
  });

  it('reads legacy quote-format items', () => {
    const live = liveIndex(page(ARTICLE));
    expect(idOf(resolveItem(live, undefined, { quote: 'Gutenberg combined movable metal type', text: 'x' }))).toBe('p1');
  });

  it('returns null when the item is not on the page', () => {
    const live = liveIndex(page(ARTICLE));
    expect(resolveItem(live, {}, { anchor: 'p1', text: 'Quantum computing breakthroughs announced today' })).toBeNull();
  });
});

describe('markers and caching', () => {
  it('recognizes escaped markers and strips them for the chat model', () => {
    expect('\\[p12\\] Hello [p3] world'.replace(MARKER_RE, '[p$1] ')).toBe('[p12] Hello [p3] world');
    expect(stripMarkers('[p1] Hello\n\n[p2] world')).toBe('Hello\n\nworld');
  });
  it('keeps only the fingerprints the summary points at', () => {
    const { anchors } = numberBlocks(page(ARTICLE));
    const used = usedAnchors({ sections: [{ anchor: 'p1', anchors: ['p2', '', 'p404'] }] }, anchors)!;
    expect(Object.keys(used).sort()).toEqual(['p1', 'p2']);
  });
  it('keeps the fingerprint of the quote block too, and reads block texts from the content', () => {
    const { anchors } = numberBlocks(page(ARTICLE));
    expect(Object.keys(usedAnchors({ sections: [], quote: { anchor: 'p2' } }, anchors)!)).toEqual(['p2']);
    expect([...blockTexts('[p1] Hello\n\n\\[p2\\] world\n\nmore').entries()]).toEqual([['p1', 'Hello\n\n'], ['p2', 'world\n\nmore']]);
  });
});

describe('text matching helpers', () => {
  it('findQuote ignores case, whitespace and punctuation, tolerates edited ends', () => {
    const hay = keyOf('Hello world. The quick brown fox jumps over the lazy dog, again and again.');
    expect(findQuote(hay, '“the QUICK   brown-fox” jumps')).not.toBeNull();
    expect(findQuote(hay, 'A sly quick brown fox jumps over the lazy dog, again and again.')).not.toBeNull();
    expect(findQuote(hay, 'Something completely different that never appears')).toBeNull();
  });
  it('bestMatch picks the block sharing most words, including CJK, or -1', () => {
    expect(bestMatch(['Gutenberg combined type.', 'Millions of volumes circulated across Europe.'], 'Volumes circulated widely across Europe')).toBe(1);
    expect(bestMatch(['Gutenberg combined type.'], 'Quantum computing breakthroughs')).toBe(-1);
    expect(bestMatch(['印刷术让知识的传播速度大大加快', '天气很好'], '知识传播速度加快')).toBe(0);
  });
});
