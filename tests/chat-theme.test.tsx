// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import postcss from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../components/Chat';
import { PANEL_CSS } from '../lib/panel-css';
import { initialState } from '../lib/sessions';

vi.mock('../lib/messages', () => ({ CHAT_PORT: 'chat', rpc: vi.fn() }));
vi.mock('../lib/skills', () => ({
  createSkillStore: () => ({ ordered: async () => [] }),
  localizeSkill: (s: unknown) => s,
}));
vi.mock('../lib/storage', () => ({ chromeKV: {}, KEYS: {}, onStorageChange: () => () => {} }));
import { rpc } from '../lib/messages';

// Read the declarations generated for the classes used by the actual rendered bubbles.
// jsdom does not resolve color-mix/OKLCH, so contrast is also checked in browser QA.
const stylesheet = postcss.parse(PANEL_CSS);
function declaration(el: Element, property: string): string | undefined {
  let value: string | undefined;
  stylesheet.walkRules((rule) => {
    if (!rule.selector.startsWith('.') || rule.selector.includes(':')) return;
    // Tailwind escapes commas as \2c; jsdom's selector engine does not match those reliably.
    const className = rule.selector.slice(1).replace(/\\(?:([\da-f]{1,6})\s?|(.))/gi,
      (_, hex: string | undefined, char: string) => hex ? String.fromCodePoint(parseInt(hex, 16)) : char);
    if ([...el.classList].includes(className)) rule.walkDecls(property, (decl) => { value = decl.value; });
  });
  return value;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(rpc).mockResolvedValue({ ok: true, state: initialState([
    { role: 'user', content: '没看懂。他们具体做了个啥？' },
    { role: 'user', content: 'Explain this page in detail.', label: '💡 Explain' },
  ]) } as never);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('user bubble theme colors', () => {
  it.each(['light', 'dark'])('uses theme surfaces for normal and Skill messages in %s mode', async (theme) => {
    container.dataset.theme = theme;
    await act(async () => root.render(<Chat url="https://example.test" pageTitle="Test" hasSummary reloadKey={0} getPage={async () => ({ title: 'Test', content: '' })} />));
    const bubbles = [...container.querySelectorAll('[data-msg="user"] > div')];
    expect(bubbles).toHaveLength(2);
    const [normal, skill] = bubbles;
    expect(normal!.textContent).toBe('没看懂。他们具体做了个啥？');
    expect(skill!.textContent).toBe('💡 Explain');
    expect(skill!.getAttribute('title')).toBe('Explain this page in detail.');
    expect(declaration(normal!, 'background-color')).toBe('color-mix(in srgb,var(--ink) 7%,var(--surface))');
    expect(declaration(normal!, 'color')).toBe('var(--ink)');
    expect(declaration(normal!, 'border-color')).toBe('var(--edge)');
    expect(declaration(skill!, 'background-color')).toBe('color-mix(in srgb,var(--accent) 12%,var(--surface))');
    expect(declaration(skill!, 'color')).toBe('var(--accent-ink)');
    expect(declaration(skill!, 'border-color')).toBe('var(--accent-ring)');
  });
});
