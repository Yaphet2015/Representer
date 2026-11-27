import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Capsule, CloseButton, SettingsButton, SettingsLead } from '../components/Capsule';
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
    expect(tab(html, 'overview')).toContain('hover:bg-hover');
  });

  it('collapses to icons: labels leave the layout and the name moves to title / aria-label', () => {
    const html = cap({ collapsed: true });
    expect(html).toContain('data-collapsed="true"');
    expect(tab(html, 'overview')).toContain('w-[26px] px-0');
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

  it('capsule and close share the F2 glass material; no frost patches', () => {
    expect(cap()).toContain('rp-glass');
    expect(cap({ collapsed: true })).toContain('rp-glass');
    expect(render(<CloseButton onClose={() => {}} />)).toContain('rp-glass');
    expect(cap()).not.toContain('data-frost');
    expect(tab(cap(), 'overview')).toContain('var(--accent)_16%');
    const css = readFileSync('assets/tailwind.css', 'utf8');
    expect(css).toMatch(/\.rp-glass \{ background: rgba\(var\(--glass-rgb\),\.25\); -webkit-backdrop-filter: blur\(6px\)/);
    expect(css).not.toContain('rp-frost');
  });

  it('uses the same blue glow on both pages', () => {
    const app = readFileSync('components/App.tsx', 'utf8');
    expect(app).not.toContain('var(--ink) 9%');
    expect(app.match(/var\(--accent\) 13%/g)).toHaveLength(1);
  });

  it('both blue glows (top and bottom) fade to transparent, not white, so the glass shows through', () => {
    for (const f of ['components/App.tsx', 'components/Chat.tsx']) {
      const src = readFileSync(f, 'utf8');
      const glow = src.match(/radial-gradient\([^']*/)![0];
      expect(glow, f).toContain('var(--accent) 13%, transparent');
      expect(glow, f).not.toMatch(/#fff/);
    }
  });

  it('the panel is frosted glass (.82, blur 28 + saturate 1.1) and secondary text uses ink-2', () => {
    const css = readFileSync('assets/tailwind.css', 'utf8');
    const rule = css.match(/\.rp-panel-glass \{[^}]*\}/)![0];
    expect(rule).toContain('--glass-a: .82');
    expect(rule).toContain('--ink-3: var(--ink-2)');
    expect(rule).toContain('backdrop-filter: blur(28px) saturate(1.1)');
    expect(readFileSync('components/App.tsx', 'utf8')).toContain('rp-panel-glass');
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

describe('settings icon in the scrolling lead', () => {
  it('is a quiet control named for settings, not a glass button, and is not in the tab list', () => {
    expect(cap()).not.toContain('data-settings');
    const html = render(<SettingsButton />);
    expect(html).toContain(`aria-label="${messages('en').settingsShort}"`);
    expect(html).toContain(`title="${messages('en').settingsShort}"`);
    expect(html).toContain('data-settings');
    expect(html).toContain('text-ink-3');
    expect(html).toContain('size-3.5');
    expect(html).not.toContain('rp-glass');
    expect(html).not.toMatch(/\bfixed\b|\bsticky\b|\babsolute\b/);
  });

  it('sits in normal flow so it can scroll away; never fixed or sticky', () => {
    const html = render(<SettingsLead className="-mt-11 h-11" />);
    expect(html).toContain('data-settings-lead');
    expect(html).toContain('-mt-11 h-11');
    expect(html).toContain('data-settings');
    expect(html).not.toMatch(/\bfixed\b|\bsticky\b|\babsolute\b/);
  });

  it('lives in the overlay scroller, not in the floating capsule or close row, and does not change the PDF settings text', () => {
    const app = readFileSync('components/App.tsx', 'utf8');
    const scroll = app.slice(app.indexOf('rp-scroll h-full overflow-y-auto pt-11'), app.indexOf('absolute left-1/2 top-1.5'));
    expect(scroll).toContain('<SettingsLead className="-mt-11 h-11" />');
    expect(scroll).toContain('overflow-y-auto');
    const cap = app.slice(app.indexOf('absolute left-1/2 top-1.5'), app.indexOf('CloseButton'));
    expect(cap).not.toContain('SettingsLead');
    expect(app).toContain('absolute right-2 top-1.5');
    const chat = readFileSync('components/Chat.tsx', 'utf8');
    expect(chat).toContain('{!state && <SettingsLead className="-mx-4 -mt-14 h-14" />}');
    const pdf = readFileSync('components/pdf/PdfPanel.tsx', 'utf8');
    expect(pdf).toContain('openOptionsPage');
    expect(pdf).toContain('Settings</Button>');
    expect(pdf).not.toContain('SettingsLead');
  });
});

describe('conversation tab row', () => {
  const two = forkSession(initialState(), MAIN_ID, 0, 'side-a').state;
  it('is icon-only on the right: a New conversation plus, not a visible text label or a side-chat fork', () => {
    const html = render(<SessionChips state={two} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} disabled={false} />);
    const scroller = html.indexOf('data-chips-scroller');
    const neu = html.indexOf('data-new-tab');
    expect(scroller).toBeGreaterThan(-1);
    expect(neu).toBeGreaterThan(scroller);
    const inner = html.slice(scroller, neu);
    expect((inner.match(/<div/g) ?? []).length).toBeLessThanOrEqual((inner.match(/<\/div>/g) ?? []).length + 1);
    const btn = html.match(/<button[^>]*data-new-tab[^>]*>[\s\S]*?<\/button>/)![0];
    expect(btn).toContain(`title="${messages('en').newConversationTitle}"`);
    expect(btn).toContain(`aria-label="${messages('en').newConversationTitle}"`);
    expect(btn).toMatch(/data-new-tab[^>]*size-6/);
    expect(btn.replace(/<[^>]+>/g, '').trim()).toBe(''); // icon-only: no visible label
    expect(html).not.toContain('data-fork');
    expect(html).toContain(messages('en').sideSession(1)); // side chip still present
  });
  it('still shows the New button when only the main tab exists', () => {
    const html = render(<SessionChips state={initialState()} onSwitch={() => {}} onClose={() => {}} onNew={() => {}} disabled={false} />);
    expect(html).toContain('data-new-tab');
    expect(html).toContain(messages('en').mainSession);
  });
});
