import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Skeleton } from '../components/Skeleton';

describe('Skeleton', () => {
  const html = renderToStaticMarkup(<Skeleton />);
  it('is hidden from assistive tech (the loading label carries the status)', () => {
    expect(html).toMatch(/^<div[^>]*aria-hidden="true"/);
  });
  it('carries many section groups so a tall panel is filled', () => {
    expect((html.match(/border-l-\[1\.5px\]/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
  it('clips its overflow and fades out at the bottom in the panel colour', () => {
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('bg-gradient-to-t from-white to-transparent');
  });
  it('has no text content', () => {
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
  });
});
