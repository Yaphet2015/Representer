// @vitest-environment jsdom
/**
 * The panel's wheel/touch guard in a real shadow root (WXT mounts the panel in one, anchored on <html>), with the
 * official Lenis smooth-scroll library on the page the way sites mount it (window wrapper, wheel listener on window,
 * non-passive). Lenis cancels every wheel it sees outside elements marked data-lenis-prevent and scrolls the page
 * itself; the panel must keep its wheel and touch gestures to itself so its own lists still scroll natively.
 */
import Lenis from 'lenis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardScroll } from '../lib/scroll-guard';

/** jsdom has no layout: give a box the scroll metrics a browser would report. */
function metrics(el: Element, m: { scrollTop?: number; scrollHeight: number; clientHeight: number; scrollLeft?: number; scrollWidth?: number; clientWidth?: number }) {
  for (const [k, v] of Object.entries({ scrollTop: 0, scrollLeft: 0, scrollWidth: m.clientWidth ?? 300, clientWidth: 300, ...m })) Object.defineProperty(el, k, { configurable: true, writable: true, value: v });
}

let lenis: Lenis; let pageSaw: string[]; let cleanup: () => void;
let root: HTMLElement, list: HTMLElement, item: HTMLElement, capsule: HTMLElement, chips: HTMLElement, pageText: HTMLElement;
const onPage = (e: Event) => { pageSaw.push(e.type); };

beforeEach(() => {
  // jsdom lacks these; Lenis only needs them to exist (it measures on resize)
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  document.body.innerHTML = '<p id="page">page text</p>';
  pageText = document.getElementById('page')!;
  const host = document.createElement('representer-overlay'); document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<div id="root">
    <div id="capsule">Overview | Chat</div>
    <div id="list" style="overflow-y:auto"><p id="item">a long overview</p></div>
    <div id="chips" style="overflow-x:auto"><span>chip</span></div>
  </div>`;
  root = shadow.getElementById('root')!; list = shadow.getElementById('list')!; item = shadow.getElementById('item')!;
  capsule = shadow.getElementById('capsule')!; chips = shadow.getElementById('chips')!;
  metrics(list, { scrollHeight: 2000, clientHeight: 500 });
  metrics(chips, { scrollHeight: 30, clientHeight: 30, scrollWidth: 900, clientWidth: 300 });
  for (const el of [root, capsule, item]) metrics(el, { scrollHeight: 10, clientHeight: 10 });
  lenis = new Lenis(); // the site's setup: wrapper = window, smoothWheel on
  pageSaw = [];
  for (const t of ['wheel', 'touchstart', 'touchmove', 'touchend']) window.addEventListener(t, onPage, { passive: false });
  cleanup = guardScroll(root);
});
afterEach(() => {
  cleanup(); lenis.destroy();
  for (const t of ['wheel', 'touchstart', 'touchmove', 'touchend']) window.removeEventListener(t, onPage);
  document.documentElement.querySelector('representer-overlay')?.remove();
});

/** jsdom's TouchEvent can't carry touch points: attach one the way a browser reports it. */
const touch = (target: Element, type: string, y = 100) => {
  const e = new TouchEvent(type, { bubbles: true, cancelable: true, composed: true });
  const pts = type === 'touchend' ? [] : [{ clientX: 50, clientY: y }];
  for (const k of ['touches', 'targetTouches']) Object.defineProperty(e, k, { value: pts });
  Object.defineProperty(e, 'changedTouches', { value: [{ clientX: 50, clientY: y }] });
  target.dispatchEvent(e); return e;
};
const wheel = (target: Element, o: WheelEventInit) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, ...o }); target.dispatchEvent(e); return e; };

describe('panel scroll isolation under a page-level smooth scroller (Lenis)', () => {
  it('a list that can scroll keeps the wheel: not cancelled, and the page never sees it', () => {
    const e = wheel(item, { deltaY: 120 });
    expect(e.defaultPrevented).toBe(false); // the panel list scrolls natively
    expect(pageSaw).toEqual([]); // neither Lenis nor any other page listener hears it
    expect(lenis.isScrolling).toBe(false);
  });
  it('at the end of the list, or over the capsule: cancelled (no scroll chaining), and still kept from the page', () => {
    (list as any).scrollTop = 1500;
    expect(wheel(item, { deltaY: 120 }).defaultPrevented).toBe(true);
    expect(wheel(capsule, { deltaY: -120 }).defaultPrevented).toBe(true);
    expect(pageSaw).toEqual([]);
  });
  it('horizontal: shift+wheel over the chips scrolls them, not the page', () => {
    const e = wheel(chips.firstElementChild!, { deltaY: 100, shiftKey: true });
    expect(e.defaultPrevented).toBe(false); expect(pageSaw).toEqual([]);
  });
  it('ctrl+wheel (pinch / browser zoom) is left alone', () => {
    const e = wheel(item, { deltaY: 100, ctrlKey: true });
    expect(e.defaultPrevented).toBe(false); expect(pageSaw).toEqual(['wheel']);
  });
  it('touch gestures in the panel do not reach the page; touchstart stays passive-friendly (never cancelled)', () => {
    expect(touch(item, 'touchstart', 300).defaultPrevented).toBe(false);
    expect(touch(item, 'touchmove', 200).defaultPrevented).toBe(false); // finger up: the list scrolls down natively
    touch(item, 'touchend', 200);
    expect(pageSaw).toEqual([]);
  });
  it('wheel on the page itself still reaches the page and Lenis', () => {
    const e = wheel(pageText, { deltaY: 120 });
    expect(pageSaw).toEqual(['wheel']); expect(e.defaultPrevented).toBe(true); // Lenis took it, as on any page
  });
  it('cleanup removes the guard: events flow to the page again', () => {
    cleanup(); cleanup = () => {};
    wheel(item, { deltaY: 120 });
    touch(item, 'touchmove');
    expect(pageSaw).toEqual(['wheel', 'touchmove']);
  });
});
