import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { nextSegment } from '../components/bui/SegmentedControl';
import { LangProvider } from '../components/i18n';
import { Segmented } from '../components/Segmented';
import { messages } from '../lib/i18n';

const render = (p: Parameters<typeof Segmented>[0]) => renderToStaticMarkup(<LangProvider><Segmented {...p} /></LangProvider>);
const tab = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-tab="${id}"[^>]*>`))![0];

describe('header tabs', () => {
  it('is a tablist of two tabs with aria-selected on the current one', () => {
    const html = render({ value: 'chat', onChange: () => {} });
    expect(html).toMatch(/role="tablist"/);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(tab(html, 'chat')).toContain('aria-selected="true"');
    expect(tab(html, 'overview')).toContain('aria-selected="false"');
  });

  it('marks only the selected cell as solid ink and focusable (roving tabindex)', () => {
    const html = render({ value: 'overview', onChange: () => {} });
    expect(html.match(/data-tab-pill/g)).toHaveLength(1);
    expect(tab(html, 'overview')).toContain('tabindex="0"');
    expect(tab(html, 'chat')).toContain('tabindex="-1"');
    expect(tab(html, 'chat')).toContain('hover:bg-hover-2');
  });

  it('never disables a tab, whichever page is open', () => {
    for (const value of ['overview', 'chat'] as const) for (const generating of [false, true]) {
      const html = render({ value, onChange: () => {}, generating });
      expect(tab(html, 'overview')).not.toMatch(/ disabled(=| |>)/);
      expect(tab(html, 'chat')).not.toMatch(/ disabled(=| |>)/);
    }
  });

  it('shows the pulsing dot after the overview label only while it generates in the background', () => {
    expect(render({ value: 'chat', onChange: () => {} })).not.toContain('data-generating');
    const html = render({ value: 'chat', onChange: () => {}, generating: true });
    expect(html.match(/data-generating/g)).toHaveLength(1);
    const label = (h: string, id: string) => h.slice(h.indexOf(`data-tab="${id}"`)).match(/<span class="relative inline-flex items-center ([^"]*)"/)![1];
    expect(label(html, 'overview')).toBe('px-2'); // tighter padding makes room for the dot
    expect(label(html, 'chat')).toBe('px-3');
    expect(html.indexOf('data-generating')).toBeGreaterThan(html.indexOf('data-tab="overview"'));
    expect(html.indexOf('data-generating')).toBeLessThan(html.indexOf('data-tab="chat"'));
  });

  it('keeps the cells filling the row, or fixed-size when minimized', () => {
    expect(render({ value: 'overview', onChange: () => {} })).toMatch(/max-w-\[300px\] flex-1/);
    const min = render({ value: 'overview', onChange: () => {}, compact: true });
    expect(min).toContain('flex-none');
    expect(min).toContain('px-[14px]');
    expect(min).not.toContain('flex-1 text'); // cells do not stretch
  });

  it('has labels and an accessible name in both languages', () => {
    for (const lang of ['zh-CN', 'en'] as const) {
      const m = messages(lang);
      expect(m.tabOverview && m.tabChat && m.tabsLabel).toBeTruthy();
    }
  });
});

describe('keyboard navigation', () => {
  const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', disabled: true }];
  it('moves with the arrow keys, wrapping around', () => {
    expect(nextSegment(items, 'a', 'ArrowRight')).toBe('b');
    expect(nextSegment(items, 'b', 'ArrowRight')).toBe('a');
    expect(nextSegment(items, 'a', 'ArrowLeft')).toBe('b');
  });
  it('jumps with Home/End, skips disabled cells and ignores other keys', () => {
    expect(nextSegment(items, 'a', 'End')).toBe('b');
    expect(nextSegment(items, 'b', 'Home')).toBe('a');
    expect(nextSegment(items, 'a', 'Enter')).toBeNull();
  });
});
