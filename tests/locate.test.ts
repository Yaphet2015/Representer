import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { bestMatch, buildIndex, findQuote, keyOf, locate } from '../lib/locate';

const page = (body: string) => parseHTML(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`).document as unknown as Document;

const ARTICLE = `
  <nav>Home · About</nav>
  <article>
    <h2 id="h-origins">Origins of the press</h2>
    <p id="p1">Johannes Gutenberg combined <b>movable metal</b> type, oil-based ink, and a screw press adapted from wine-making.</p>
    <p id="p2">Within fifty years, millions of volumes circulated across Europe, reshaping religion, science, and politics.</p>
    <ul><li id="li1">Literacy rose sharply in cities with a print shop.</li></ul>
    <p id="p3">印刷术让知识的传播速度大大加快，书籍价格也随之下降。</p>
    <p id="hidden" hidden>Secret paragraph about Gutenberg wine-making presses.</p>
    <script>var s = "Within fifty years, millions of volumes";</script>
  </article>
  <representer-overlay>Within fifty years, millions of volumes circulated</representer-overlay>`;

describe('findQuote', () => {
  const hay = keyOf('Hello world. The quick brown fox jumps over the lazy dog, again and again.');
  it('ignores case, whitespace, punctuation and curly quotes', () => {
    expect(findQuote(hay, '“the QUICK   brown-fox” jumps')).not.toBeNull();
  });
  it('still finds a quote the model shortened or slightly changed at one end', () => {
    expect(findQuote(hay, 'The quick brown fox jumps over the lazy dog, again and again!!! and more words added')).not.toBeNull();
    expect(findQuote(hay, 'A sly quick brown fox jumps over the lazy dog, again and again.')).not.toBeNull();
  });
  it('returns null for text that is not on the page or too short to trust', () => {
    expect(findQuote(hay, 'Something completely different that never appears')).toBeNull();
    expect(findQuote(hay, 'fox')).toBeNull();
  });
});

describe('bestMatch (fuzzy fallback)', () => {
  const blocks = ['Gutenberg combined movable metal type and ink.', 'Millions of volumes circulated across Europe.', 'Unrelated footer text.'];
  it('picks the block sharing most words with the query', () => {
    expect(bestMatch(blocks, 'Volumes circulated widely across Europe')).toBe(1);
  });
  it('returns -1 when nothing overlaps enough', () => {
    expect(bestMatch(blocks, 'Quantum computing breakthroughs announced')).toBe(-1);
  });
  it('works for CJK text without spaces', () => {
    expect(bestMatch(['印刷术让知识的传播速度大大加快', '天气很好'], '知识传播速度加快')).toBe(0);
  });
});

describe('locate in a page', () => {
  const doc = page(ARTICLE);
  const index = buildIndex(doc);
  const id = (q: { quote?: string; text: string }) => locate(index, q)?.getAttribute('id') ?? null;

  it('finds the block of a verbatim quote, across inline markup', () => {
    expect(id({ quote: 'Gutenberg combined movable metal type', text: 'x' })).toBe('p1');
    expect(id({ quote: 'Literacy rose sharply in cities', text: 'x' })).toBe('li1');
    expect(id({ quote: 'Origins of the press', text: 'x' })).toBe('h-origins');
    expect(id({ quote: '知识的传播速度大大加快', text: 'x' })).toBe('p3');
  });
  it('never matches scripts, hidden elements or our own overlay', () => {
    expect(index.key).not.toContain(keyOf('Secret paragraph'));
    expect(id({ quote: 'Within fifty years, millions of volumes circulated', text: 'x' })).toBe('p2');
  });
  it('falls back to the item text when there is no quote (summaries cached before quotes existed)', () => {
    expect(id({ text: 'Millions of volumes circulated across Europe within fifty years' })).toBe('p2');
  });
  it('returns null when the item is not on the page', () => {
    expect(id({ quote: 'A sentence that the page does not contain at all', text: 'Quantum computing breakthroughs' })).toBeNull();
  });
});
