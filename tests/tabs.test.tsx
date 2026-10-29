import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Capsule, CloseButton } from '../components/Capsule';
import { LangProvider } from '../components/i18n';
import { SessionChips } from '../components/SessionChips';
import { nextTab } from '../lib/capsule';
import { messages } from '../lib/i18n';
import { forkSession, initialState, MAIN_ID } from '../lib/sessions';

const render = (node: React.ReactNode) => renderToStaticMarkup(<LangProvider>{node}</LangProvider>);
const cap = (p: Partial<Parameters<typeof Capsule>[0]> = {}) => render(<Capsule value="overview" onChange={() => {}} {...p} />);
const tab = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-tab="${id}"[^>]*>`))![0];

describe('floating capsule', () => {
  it('is a tablist of two tabs; the selected one is light accent and the only tab stop', () => {
    const html = cap({ value: 'chat' });
    expect(html).toMatch(/role="tablist"/);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(tab(html, 'chat')).toContain('aria-selected="true"');
    expect(tab(html, 'chat')).toContain('text-accent-ink');
    expect(tab(html, 'chat')).toContain('tabindex="0"');
    expect(tab(html, 'overview')).toContain('aria-selected="false"');
    expect(tab(html, 'overview')).toContain('tabindex="-1"');
    expect(tab(html, 'overview')).toContain('hover:bg-hover-2');
  });

  it('collapses to icons: labels leave the layout and the name moves to title / aria-label', () => {
    const html = cap({ collapsed: true });
    expect(html).toContain('data-collapsed="true"');
    expect(tab(html, 'overview')).toContain('w-7 px-0');
    expect(tab(html, 'overview')).toContain(`title="${messages('en').tabOverview}"`);
    expect(html).toMatch(/data-label[^>]*hidden/);
    expect(cap()).not.toContain('data-collapsed');
  });

  it('shows the flowing border and pixel loader only while summarizing', () => {
    expect(cap({ summarizing: true })).toContain('data-flow');
    expect(cap({ summarizing: true })).toContain(messages('en').summarizing);
    expect(cap()).not.toContain('data-flow');
  });

  it('keeps close outside the tab list, named and hinting Esc', () => {
    expect(cap()).not.toContain('data-close');
    const html = render(<CloseButton onClose={() => {}} />);
    expect(html).toContain(`aria-label="${messages('en').close}"`);
    expect(html).toContain('title="Close · Esc"');
  });

  it('arrow keys wrap, Home/End jump, other keys do nothing', () => {
    expect(nextTab('overview', 'ArrowRight')).toBe('chat');
    expect(nextTab('overview', 'ArrowLeft')).toBe('chat');
    expect(nextTab('chat', 'ArrowRight')).toBe('overview');
    expect(nextTab('chat', 'Home')).toBe('overview');
    expect(nextTab('overview', 'End')).toBe('chat');
    expect(nextTab('overview', 'Enter')).toBeNull();
  });

  it('has no header bar or minimize left in the panel', () => {
    const app = readFileSync('components/App.tsx', 'utf8');
    expect(app).not.toMatch(/data-top-row|setMin|minimize/);
    expect(app).toContain('dir="ltr"');
    expect(Object.keys(messages('zh-CN'))).not.toContain('minimize');
  });
});

describe('side chat row', () => {
  const two = forkSession(initialState(), MAIN_ID, 0, 'side-a').state;
  it('scrolls only the chips; the fork icon button sits outside at the far right', () => {
    const html = render(<SessionChips state={two} onSwitch={() => {}} onClose={() => {}} onFork={() => {}} disabled={false} />);
    const scroller = html.indexOf('data-chips-scroller');
    const fork = html.indexOf('data-fork');
    expect(scroller).toBeGreaterThan(-1);
    expect(fork).toBeGreaterThan(scroller);
    // the fork button is a sibling after the scroller closes, not inside it
    const inner = html.slice(scroller, fork);
    expect((inner.match(/<div/g) ?? []).length).toBeLessThanOrEqual((inner.match(/<\/div>/g) ?? []).length + 1);
    expect(html).toContain(`title="${messages('en').newSideTitle}"`);
    expect(html).toMatch(/data-fork[^>]*size-6/);
  });
});
