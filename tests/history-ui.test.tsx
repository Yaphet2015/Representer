/** Settings → History, rendered for real (react-dom + linkedom) and clicked through. Read-only throughout. */
import { vi } from 'vitest';
// The DOM must exist before react-dom loads (it checks for one once, at import).
await vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  (document as any).oninput = null; // linkedom lacks the handler property react-dom probes to use 'input' events
  Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true });
});
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryCard } from '../components/options/HistoryCard';
import { Overview, type Locator } from '../components/Overview';
import { chromeHistorySource, type HistorySource } from '../lib/history';
import type { Summary } from '../lib/types';

const NOW = Date.now();
const sum = (overview: string): Summary => ({ overview, sections: [{ title: 'Part one', icon: 'list', bullets: ['b'] }] });
const rec = (title: string, overview: string, ago: number) => ({ summary: sum(overview), content: 'PAGE-TEXT', title, createdAt: NOW - ago });

let root: Root; let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="r"></div>';
  vi.stubGlobal('location', { hostname: 'ext-id' });
  const no = (what: string) => () => { throw new Error('history must not ' + what); };
  vi.stubGlobal('chrome', { runtime: { sendMessage: no('message the background (model / extraction)'), connect: no('open a port') }, storage: { local: { set: no('write'), remove: no('remove'), clear: no('clear') } } });
  host = document.getElementById('r') as unknown as HTMLElement;
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

/** A source over a plain object, counting reads; the test mutates `data` and fires `fire()` like storage.onChanged. */
function fakeStore(data: Record<string, unknown>) {
  let listener: (() => void) | null = null; let unsubscribed = 0; let fail = false; let reads = 0;
  const source: HistorySource = { async readSummaries() { reads++; if (fail) throw new Error('boom'); return { ...data }; } };
  const subscribe = (fn: () => void) => { listener = fn; return () => { listener = null; unsubscribed++; }; };
  return { source, subscribe, data, fire: () => listener?.(), get unsubscribed() { return unsubscribed; }, get reads() { return reads; }, setFail: (v: boolean) => { fail = v; } };
}
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const q = (sel: string) => host.querySelector(sel) as any;
const qa = (sel: string) => [...host.querySelectorAll(sel)] as any[];
const click = (el: any) => act(async () => { el.dispatchEvent(new (window as any).Event('click', { bubbles: true })); });
const typeIn = async (el: any, value: string) => {
  await act(async () => {
    el.value = value;
    el._valueTracker?.setValue('\u0000'); // React only fires onChange when the value differs from what it last saw
    el.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
  });
};

describe('settings history (interactive)', () => {
  it('lists newest first, opens a record, goes back; search narrows, shows no-match and recovers', async () => {
    const s = fakeStore({ 'sum:https://a.test/x': rec('Alpha page', 'Alpha overview', 3 * 86400e3), 'sum:https://b.test/y': rec('Bravo page', 'Bravo overview', 1000), settings: { apiKey: 'SYNTHETIC-KEY' } });
    await act(async () => root.render(<HistoryCard source={s.source} subscribe={s.subscribe} />)); await settle();
    expect(qa('[data-history-item]').map((b) => b.textContent)).toEqual([expect.stringContaining('Bravo page'), expect.stringContaining('Alpha page')]);
    expect(host.innerHTML).not.toContain('SYNTHETIC-KEY'); expect(host.innerHTML).not.toContain('PAGE-TEXT');

    await click(qa('[data-history-item]')[1]);
    expect(q('[data-history-detail]')).toBeTruthy();
    expect(host.textContent).toContain('Alpha overview'); expect(host.textContent).toContain('Part one');
    expect(q('[role="button"]')).toBeNull(); // no fake locate targets
    expect(q('[data-history-open]').getAttribute('href')).toBe('https://a.test/x');
    await click(q('[data-history-back]'));
    expect(qa('[data-history-item]')).toHaveLength(2);

    await typeIn(q('[data-history-search]'), 'zzz-nothing');
    expect(q('[data-history-nomatch]')).toBeTruthy(); expect(qa('[data-history-item]')).toHaveLength(0);
    await typeIn(q('[data-history-search]'), 'bravo');
    expect(qa('[data-history-item]').map((b) => b.textContent)).toEqual([expect.stringContaining('Bravo page')]);
    await typeIn(q('[data-history-search]'), '');
    expect(qa('[data-history-item]')).toHaveLength(2);
  });

  it('follows storage changes, shows the empty state, and unsubscribes on unmount', async () => {
    const s = fakeStore({});
    await act(async () => root.render(<HistoryCard source={s.source} subscribe={s.subscribe} />)); await settle();
    expect(q('[data-history-empty]')).toBeTruthy();
    s.data['sum:https://c.test/'] = rec('Charlie', 'Charlie overview', 10);
    await act(async () => s.fire()); await settle();
    expect(qa('[data-history-item]').map((b) => b.textContent)).toEqual([expect.stringContaining('Charlie')]);
    act(() => root.unmount()); root = createRoot(host);
    expect(s.unsubscribed).toBe(1);
  });

  it('a failed read shows an error with retry, and retry recovers', async () => {
    const s = fakeStore({ 'sum:https://d.test/': rec('Delta', 'Delta overview', 10) }); s.setFail(true);
    await act(async () => root.render(<HistoryCard source={s.source} subscribe={s.subscribe} />)); await settle();
    expect(q('[role="alert"]')).toBeTruthy();
    s.setFail(false);
    await click(q('[role="alert"] button')); await settle();
    expect(q('[role="alert"]')).toBeNull(); expect(qa('[data-history-item]')).toHaveLength(1);
  });

  it('damaged records never blank the page', async () => {
    const odd = { get summary() { throw new Error('bad getter'); } };
    const s = fakeStore({ 'sum:https://e.test/': odd, 'sum:https://f.test/': 42, 'sum:https://g.test/': rec('Good', 'Good overview', 5) });
    await act(async () => root.render(<HistoryCard source={s.source} subscribe={s.subscribe} />)); await settle();
    expect(qa('[data-history-item]')).toHaveLength(1);
    expect(host.textContent).toMatch(/2/);
  });
});

describe('chromeHistorySource (store capability)', () => {
  const data = { settings: { apiKey: 'SYNTHETIC-KEY' }, 'sess:https://a.test/': {}, 'sum:https://a.test/': { summary: sum('x') } };
  const mk = (getKeys?: () => Promise<unknown>) => {
    const calls: unknown[] = [];
    vi.stubGlobal('chrome', { storage: { local: {
      getKeys, async get(k: unknown) { calls.push(k); if (k === null) return { ...data }; return Object.fromEntries((k as string[]).map((x) => [x, (data as any)[x]])); },
      async set() { throw new Error('must not write'); }, async remove() { throw new Error('must not remove'); }, async clear() { throw new Error('must not clear'); },
    } } });
    return calls;
  };
  it('reads only sum: keys when getKeys works', async () => {
    const calls = mk(async () => Object.keys(data));
    expect(Object.keys(await chromeHistorySource.readSummaries())).toEqual(['sum:https://a.test/']);
    expect(calls).toEqual([['sum:https://a.test/']]);
  });
  it('falls back to a full read when getKeys is missing, throws, or returns junk, and still returns only sum: records', async () => {
    for (const gk of [undefined, async () => { throw new Error('nope'); }, async () => 'junk']) {
      const calls = mk(gk as any);
      const r = await chromeHistorySource.readSummaries();
      expect(Object.keys(r)).toEqual(['sum:https://a.test/']); expect(JSON.stringify(r)).not.toContain('SYNTHETIC-KEY');
      expect(calls).toEqual([null]);
    }
  });
});

describe('Overview locator boundary (live panel unchanged)', () => {
  const summary: Summary = { overview: 'O', sections: [{ title: 'Sec', icon: 'list', bullets: ['one'], anchor: 'p1' }], quote: { text: 'A quoted line.', anchor: 'p2' } };
  it('with the live locator, resolvable items are jump targets and clicks go through it', async () => {
    const went: string[] = []; let stopped = 0;
    const locator: Locator = { locatable: (items) => new Set(items.map(([k]) => k)), go: async (it) => { went.push(it.text); return 'missing'; }, observe: () => () => { stopped++; } };
    const fails: string[] = [];
    await act(async () => root.render(<Overview summary={summary} locator={locator} host="x.test" onLocateFail={(k) => fails.push(k)} />));
    const targets = qa('[role="button"]');
    expect(targets.length).toBe(3); // section title, bullet, excerpt
    await click(targets[0]);
    expect(went).toEqual(['Sec']); expect(fails).toEqual(['missing']);
    act(() => root.unmount()); root = createRoot(host);
    expect(stopped).toBe(1);
  });
  it('without a locator nothing is a jump target', async () => {
    await act(async () => root.render(<Overview summary={summary} host="x.test" />));
    expect(qa('[role="button"]')).toHaveLength(0);
    expect(host.textContent).toContain('A quoted line.');
  });
});
