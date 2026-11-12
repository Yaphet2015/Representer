// @vitest-environment jsdom
/**
 * The panel's styles must reach the shadow root without any runtime fetch of an extension file.
 * WXT's cssInjectionMode:'ui' does a fetch() of content-scripts/content.css (web-accessible, dynamic URL) when the
 * panel first mounts, and on any failure mounts the panel with only `:host{all:initial}`: a panel in the browser's
 * default styles (Times, native buttons, bare <mark>) that stays that way, since the UI object is created once.
 */
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_CSS, PANEL_SHADOW } from '../lib/panel-css';

// wxt/browser picks the extension API object once, at import: it must exist first (as it does in a content script)
vi.hoisted(() => { Object.assign(globalThis, { chrome: { runtime: { id: 'x', getURL: (p: string) => `chrome-extension://dynamic-id${p}` } } }); });

let fetchCalls: string[];
beforeEach(() => {
  fetchCalls = [];
  // a browser where the extension resource can't be fetched (unsupported dynamic URL, blocked scheme, …)
  vi.stubGlobal('fetch', (url: string) => { fetchCalls.push(String(url)); return Promise.reject(new TypeError('Failed to fetch')); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('panel css', () => {
  it('the bundled string carries the real stylesheet (utilities, theme variables) and targets :host', () => {
    expect(PANEL_CSS.length).toBeGreaterThan(10_000);
    expect(PANEL_CSS).toContain('.rp-scroll');
    expect(PANEL_CSS).toContain(':host');
    expect(PANEL_CSS).not.toContain(':root');
  });

  it('root cause: WXT\'s runtime css path swallows a failed fetch and mounts the panel with only the reset', async () => {
    const ctx = { options: { cssInjectionMode: 'ui' }, onInvalidated: () => {} };
    const ui = await createShadowRootUi(ctx as never, { name: 'x-unstyled', position: 'overlay', anchor: 'html', onMount: () => undefined });
    const styled = [...ui.shadow.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(fetchCalls).toHaveLength(1); // it did try, and failed
    expect(styled).not.toContain('.rp-scroll'); // ...and the UI exists anyway: nothing but `:host{all:initial}`
    expect(styled).toContain('all:initial');
  });

  it('mounted with the content-script options of the real entry, the shadow root is styled although fetch always fails', async () => {
    vi.stubGlobal('defineContentScript', (d: unknown) => d); // WXT's build-time global: the definition object itself
    const entry = (await import('../entrypoints/content')).default as { cssInjectionMode?: string };
    const ctx = { options: { cssInjectionMode: entry.cssInjectionMode }, onInvalidated: () => {} };
    const ui = await createShadowRootUi(ctx as never, { ...PANEL_SHADOW, onMount: () => undefined });
    ui.mount();
    const styled = [...ui.shadow.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(styled).toContain('.rp-scroll'); // the real stylesheet, not just `:host{all:initial}`
    expect(fetchCalls).toEqual([]); // no runtime fetch of content.css that could fail
    ui.remove();
  });
});
