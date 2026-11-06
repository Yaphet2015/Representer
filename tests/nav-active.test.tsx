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
      if (id === 'history' && real) h.history = el.textContent?.includes('Alpha overview') ? 3000 : 300; // a longer overview
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

describe('History two panes keep the nav on History', () => {
  it('nav → History, click another row (detail grows), search with no match: History', async () => {
    act(() => root.unmount()); document.body.innerHTML = '<div id="r"></div>';
    vi.stubGlobal('location', { hostname: 'ext-id' });
    root = createRoot(document.getElementById('r')!);
    await act(() => root.render(<RealHarness />)); await frame();
    const R = layout(true); await frame();
    await click('[data-nav=history]'); expect(current()).toBe('history');
    expect(document.querySelector('[data-history-pane]')?.textContent).toContain('Bravo overview');
    await click('[data-history-item]:not([aria-pressed="true"])'); R.reflow(); await frame();
    expect(document.querySelector('[data-history-pane]')?.textContent).toContain('Alpha overview');
    expect(current()).toBe('history');
  });
});
