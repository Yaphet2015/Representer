import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Overview } from '../components/Overview';
import { parseSummary } from '../lib/parse';
import type { Summary } from '../lib/types';

vi.stubGlobal('location', { hostname: 'www.example.com' });
const html = (s: Summary, pageTitle = 'Page') => renderToStaticMarkup(<Overview summary={s} pageTitle={pageTitle} onAsk={() => {}} />);

describe('Overview marks', () => {
  const s: Summary = {
    overview: 'Plain start ==the key claim== middle [[pstack]] end ==broken and [[open',
    sections: [{ title: 'Sec ==x==', icon: 'list', bullets: ['use [[/setup-pstack]] now'] }],
  };
  it('renders strong phrases as <mark> and terms as clickable buttons, and never leaks marker symbols', () => {
    const h = html(s);
    expect(h).toContain('<mark');
    expect(h).toMatch(/<mark[^>]*font-semibold[^>]*>the key claim<\/mark>/);
    expect(h).toMatch(/data-term[^>]*>pstack<\/span>/);
    expect(h).toMatch(/data-term[^>]*>\/setup-pstack<\/span>/);
    expect(h).not.toMatch(/==|\[\[|\]\]/);
  });
  it('shows old summaries without marks (and with keyTerms) as plain text', () => {
    const h = html({ overview: 'React uses a virtual DOM.', keyTerms: ['virtual DOM'], sections: [] });
    expect(h).toContain('React uses a virtual DOM.'); expect(h).not.toContain('<mark'); expect(h).not.toContain('data-term');
    expect(h).not.toContain('data-excerpt');
  });
  it('terms are plain text when no handler is given', () => {
    expect(renderToStaticMarkup(<Overview summary={s} />)).not.toContain('data-term');
  });
});

describe('Overview excerpt', () => {
  const content = '[p1] The only thing that matters is that the cache never lies to you, whatever it costs.';
  const raw = (quote: unknown) => JSON.stringify({ overview: 'o', sections: [], quote });
  it('shows the section at the bottom, with its source', () => {
    const q = parseSummary(raw({ text: 'the cache never lies to you', anchor: 'p1' }), content);
    const h = html(q, 'My Page');
    expect(h).toContain('data-excerpt'); expect(h).toContain('<blockquote'); expect(h).toContain('“the cache never lies to you”');
    expect(h).toContain('My Page · example.com'); // title and site, without www.
    expect(h.indexOf('data-excerpt')).toBeGreaterThan(h.indexOf('>o<') - 1);
  });
  it('renders nothing when the quote failed validation', () => {
    const q = parseSummary(raw({ text: 'something the page never said', anchor: 'p1' }), content);
    expect(html(q)).not.toContain('data-excerpt');
  });
});
