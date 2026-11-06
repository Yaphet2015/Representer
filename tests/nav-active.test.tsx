/** Settings nav highlight, driven like a user: real hook in react-dom + linkedom over a simulated page layout. */
import { vi } from 'vitest';
await vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true });
});
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SectionTail, useActiveSection } from '../components/options/useActiveSection';
import { HistoryCard } from '../components/options/HistoryCard';
import type { HistorySource } from '../lib/history';

const IDS = ['general', 'connection', 'instructions', 'skills', 'shortcuts', 'history'] as const;
const GAP = 24, START = 80, PAD = 48;

/**
 * A browser-like layout: sections stacked in document order with the heights the test sets; an element marked
 * data-section-tail is laid out at least one viewport tall (what its CSS min-height does). scrollY is clamped to
 * the scrollable range exactly as a browser clamps it when the page shrinks, and every clamp fires `scroll`.
 */
function layout(real = false) {
  const h: Record<string, number> = { general: 160, connection: 420, instructions: 260, skills: 380, shortcuts: 260, history: 300 };
  const view = { height: 1000, y: 0 };
  const boxes = () => {
    let y = START; const out: Record<string, { top: number; bottom: number }> = {};
    for (const id of IDS) {
      const el = document.getElementById(id)!;
      const tail = el.closest('[data-section-tail]') ? view.height : 0;
      if (id === 'history' && real) h.history = el.querySelector('[data-history-back]') ? 3000 : 300; // detail vs list
      out[id] = { top: y, bottom: y + h[id]! }; y += Math.max(h[id]!, tail) + GAP;
    }
    return { out, scrollHeight: y - GAP + PAD };
  };
  const maxY = () => Math.max(0, boxes().scrollHeight - view.height);
  const setY = (y: number) => { const c = Math.min(Math.max(0, y), maxY()); if (c !== view.y) { view.y = c; window.dispatchEvent(new window.Event('scroll')); } };
  for (const id of IDS) {
    const el = document.getElementById(id)! as any;
    el.getBoundingClientRect = () => { const b = boxes().out[id]!; return { top: b.top - view.y, bottom: b.bottom - view.y }; };
    el.scrollIntoView = () => setY(boxes().out[id]!.top);
  }
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => view.height });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => view.y });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => boxes().scrollHeight });
  /** Content changes size (list → detail, search narrowing): the browser reflows, clamps the scroll, observers fire. */
  const resize = (id: string, px: number) => { h[id] = px; setY(view.y); roFire(); };
  const reflow = () => { setY(view.y); roFire(); };
  return { resize, reflow, scrollTo: setY, view, maxY, top: (id: string) => boxes().out[id]!.top - view.y };
}

let roFire = () => {};
const NOW = Date.now();
const fakeSource: HistorySource = { async readSummaries() {
  const r = (title: string, ago: number) => ({ summary: { overview: title + ' overview', sections: [{ title: 'Part', icon: 'list', bullets: ['b'] }] }, content: 'x', title, createdAt: NOW - ago });
  return { 'sum:https://a.example/1': r('Alpha', 2000), 'sum:https://b.example/2': r('Bravo', 1000) };
} };
function RealHarness() {
  const [active, go] = useActiveSection(IDS);
  return (
    <main>
      <nav>{IDS.map((id) => <a key={id} data-nav={id} aria-current={active === id ? 'true' : undefined} onClick={() => go(id)}>{id}</a>)}</nav>
      {IDS.slice(0, -1).map((id) => <section key={id} id={id} />)}
      <SectionTail><HistoryCard source={fakeSource} subscribe={() => () => {}} /></SectionTail>
    </main>
  );
}
let root: Root;
function Harness() {
  const [active, go] = useActiveSection(IDS);
  return (
    <main>
      <nav>{IDS.map((id) => <a key={id} data-nav={id} aria-current={active === id ? 'true' : undefined} onClick={() => go(id)}>{id}</a>)}</nav>
      {IDS.slice(0, -1).map((id) => <section key={id} id={id} />)}
      <SectionTail><section id="history"><button data-row>row</button><input data-search /></section></SectionTail>
    </main>
  );
}
const current = () => document.querySelector('[aria-current="true"]')?.getAttribute('data-nav');
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const user = (ev: string, el: Element = document.body) => act(() => { el.dispatchEvent(new window.Event(ev, { bubbles: true })); });
const click = async (sel: string) => { const el = document.querySelector(sel)!; await user('pointerdown', el); await act(() => { (el as any).click?.() ?? el.dispatchEvent(new window.Event('click', { bubbles: true })); }); await frame(); };

let L: ReturnType<typeof layout>;
beforeEach(async () => {
  document.body.innerHTML = '<div id="r"></div>';
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (n: number) => clearTimeout(n));
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { roFire = cb; } observe() {} disconnect() { roFire = () => {}; } });
  root = createRoot(document.getElementById('r')!);
  await act(() => root.render(<Harness />));
  L = layout();
  await frame();
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

describe('settings nav: History stays highlighted while it is used', () => {
  it('nav → History, open a long detail: History', async () => {
    await click('[data-nav=history]'); expect(current()).toBe('history');
    await click('[data-row]'); L.resize('history', 3000); await frame();
    expect(current()).toBe('history');
  });
  it('nav → History, open detail, back to list, search with no match: History', async () => {
    await click('[data-nav=history]');
    await click('[data-row]'); L.resize('history', 3000); await frame();
    L.scrollTo(L.view.y + 1500); await frame(); expect(current()).toBe('history');
    await click('[data-row]'); L.resize('history', 300); await frame(); expect(current()).toBe('history');
    await click('[data-search]'); await user('keydown'); L.resize('history', 120); await frame();
    expect(current()).toBe('history');
  });
  it('narrow viewport: same flow stays on History', async () => {
    L.view.height = 700; window.dispatchEvent(new window.Event('resize')); await frame();
    await click('[data-nav=history]');
    await click('[data-row]'); L.resize('history', 3000); await frame();
    expect(current()).toBe('history');
  });
  it('the user scrolling back up still moves the highlight; other nav items still work', async () => {
    await click('[data-nav=history]');
    await user('wheel'); L.scrollTo(0); await frame(); expect(current()).toBe('general');
    await click('[data-nav=skills]'); expect(current()).toBe('skills');
    await click('[data-nav=connection]'); expect(current()).toBe('connection');
    await click('[data-nav=shortcuts]'); expect(current()).toBe('shortcuts');
  });
  it('unmount removes every listener it added and disconnects the observer', async () => {
    const live = new Set<string>(); const add = window.addEventListener.bind(window), rm = window.removeEventListener.bind(window);
    (window as any).addEventListener = (t: string, f: any, o?: any) => { live.add(t); add(t, f, o); };
    (window as any).removeEventListener = (t: string, f: any) => { live.delete(t); rm(t, f); };
    act(() => root.unmount()); root = createRoot(document.getElementById('r')!);
    await act(() => root.render(<Harness />)); await frame();
    expect([...live].sort()).toEqual(['resize', 'scroll']);
    act(() => root.unmount()); expect(live.size).toBe(0);
    (window as any).addEventListener = add; (window as any).removeEventListener = rm;
    root = createRoot(document.getElementById('r')!);
  });
});

describe('History: back to list is a transition to the list top', () => {
  it('read a long detail to its end, Back to list: History top in view, focus on the row, nav History', async () => {
    act(() => root.unmount()); document.body.innerHTML = '<div id="r"></div>';
    vi.stubGlobal('location', { hostname: 'ext-id' });
    let focused: HTMLElement | null = null; let focusOpts: unknown; // linkedom has no focus model: record the call
    (window.HTMLElement.prototype as any).focus = function (this: HTMLElement, o?: unknown) { focused = this; focusOpts = o; };
    root = createRoot(document.getElementById('r')!);
    await act(() => root.render(<RealHarness />)); await frame();
    const R = layout(true); await frame();
    await click('[data-nav=history]'); expect(current()).toBe('history');
    await click('[data-history-item]');
    R.reflow(); await frame();
    await user('wheel'); R.scrollTo(R.maxY()); await frame(); // read to the end of the detail
    expect(current()).toBe('history');
    await click('[data-history-back]'); R.reflow(); await frame();
    expect(document.querySelector('[data-history-back]')).toBeNull();
    expect(R.top('history')).toBe(0); // list starts at the top of the viewport, not wherever the detail ended
    expect(current()).toBe('history');
    const f = focused as HTMLElement | null;
    expect(f?.hasAttribute('data-history-item')).toBe(true);
    expect(f?.textContent).toContain('Bravo'); // the row that was opened (newest first)
    expect(focusOpts).toEqual({ preventScroll: true });
    delete (window.HTMLElement.prototype as any).focus;
  });
  it('a storage refresh or the first load does not scroll or move focus', async () => {
    act(() => root.unmount()); document.body.innerHTML = '<div id="r"></div>';
    vi.stubGlobal('location', { hostname: 'ext-id' });
    root = createRoot(document.getElementById('r')!);
    await act(() => root.render(<RealHarness />)); await frame();
    let focusCalls = 0; (window.HTMLElement.prototype as any).focus = () => { focusCalls++; };
    const R = layout(true); R.scrollTo(400); await frame();
    let into = 0; (document.getElementById('history') as any).scrollIntoView = () => { into++; };
    await act(() => root.render(<RealHarness />)); await frame(); // re-render / refresh with the list already shown
    expect(R.view.y).toBe(400); expect(into).toBe(0); expect(focusCalls).toBe(0);
    delete (window.HTMLElement.prototype as any).focus;
  });
});
