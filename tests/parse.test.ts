import { describe, expect, it } from 'vitest';
import { highlightTerms, isSummary, parseSummary } from '../lib/parse';

describe('parseSummary', () => {
  const obj = { overview: 'React uses a virtual DOM.', keyTerms: ['virtual DOM'], sections: [{ title: 'Core', icon: 'target', bullets: ['a', 'b'] }] };
  it('parses plain JSON', () => expect(parseSummary(JSON.stringify(obj))).toEqual(obj));
  it('parses fenced JSON with surrounding prose', () => {
    expect(parseSummary('Sure!\n```json\n' + JSON.stringify(obj) + '\n```')).toEqual(obj);
  });
  it('defaults unknown icons and tolerates key_terms / missing fields', () => {
    const r = parseSummary(JSON.stringify({ overview: 'x', key_terms: ['x', 3], sections: [{ title: 'S', icon: 'rocket' }, { nope: 1 }] }));
    expect(r).toEqual({ overview: 'x', keyTerms: ['x'], sections: [{ title: 'S', icon: 'list', bullets: [] }] });
  });
  it('rejects a section with an empty title (as the old zod schema did)', () => {
    expect(() => parseSummary(JSON.stringify({ overview: 'x', sections: [{ title: '  ', icon: 'list' }] }))).toThrow(/title/);
  });
  it('reads {text, quote} bullets and section quotes into bullets + parallel quotes', () => {
    const r = parseSummary(JSON.stringify({ overview: 'x', sections: [{ title: 'S', quote: ' Origins ', icon: 'list', bullets: [{ text: 'a', quote: 'from the page' }, { text: 'b' }, 'c', { quote: 'no text' }] }] }));
    expect(r.sections[0]).toEqual({ title: 'S', icon: 'list', quote: 'Origins', bullets: ['a', 'b', 'c'], quotes: ['from the page', '', ''] });
  });
  it('keeps old plain-string summaries valid (no quotes)', () => {
    expect(isSummary(obj)).toBe(true);
    expect(isSummary({ ...obj, sections: [{ ...obj.sections[0], quotes: ['q', ''] }] })).toBe(true);
    expect(isSummary({ ...obj, sections: [{ ...obj.sections[0], quotes: [1] }] })).toBe(false);
  });
  it('throws on invalid output', () => {
    expect(() => parseSummary('no json here')).toThrow();
    expect(() => parseSummary('{"sections":[]}')).toThrow(/overview/);
  });
});

describe('highlightTerms', () => {
  it('marks terms case-insensitively', () => {
    expect(highlightTerms('A Virtual DOM diff', ['virtual dom'])).toEqual([
      { text: 'A ', highlight: false }, { text: 'Virtual DOM', highlight: true }, { text: ' diff', highlight: false },
    ]);
  });
});
