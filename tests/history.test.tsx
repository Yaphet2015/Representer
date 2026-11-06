import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createCache, TTL_MS } from '../lib/cache';
import { listHistory, safeHref, searchHistory, toEntry, type HistorySource } from '../lib/history';
import { memKV, type KV } from '../lib/storage';
import { HistoryDetail } from '../components/options/HistoryCard';
import { Overview } from '../components/Overview';
import type { Summary } from '../lib/types';
import { messages } from '../lib/i18n';

vi.stubGlobal('location', { hostname: 'abcdefghijklmnop' }); // the options page's own (extension) host

const NOW = Date.UTC(2026, 10, 6, 9);
const sum = (overview: string, title = 'Section'): Summary => ({ overview, sections: [{ title, icon: 'list', bullets: ['a bullet'] }], quote: { text: 'A quoted line from the page.', anchor: 'p1' } });

/** A source over a KV that records every write; reads exactly what lib/cache wrote. */
function spyKV() {
  const kv = memKV(); const keys = new Set<string>(); const writes: string[] = [];
  const spied: KV = { get: kv.get, set: async (k, v) => { keys.add(k); writes.push('set ' + k); await kv.set(k, v); }, remove: async (k) => { keys.delete(k); writes.push('rm ' + k); await kv.remove(k); } };
  const source: HistorySource = { async readSummaries() { const o: Record<string, unknown> = {}; for (const k of keys) o[k] = await kv.get(k); return o; } };
  return { spied, source, writes, raw: async (k: string, v: unknown) => { keys.add(k); await kv.set(k, v); } };
}

describe('overview history (lib/history)', () => {
  it('lists every cached summary newest first, including ones past the 24 h window, and never writes or removes', async () => {
    const s = spyKV(); let t = NOW - 3 * TTL_MS;
    const cache = createCache(s.spied, () => t);
    await cache.setSummary('https://old.example/a', { summary: sum('Old one'), content: 'x', title: 'Old' });
    t = NOW - 60_000;
    await cache.setSummary('https://new.example/b', { summary: sum('New one'), content: 'y', title: 'New' });
    s.writes.length = 0;
    const r = await listHistory(s.source, NOW);
    expect(r.entries.map((e) => [e.title, e.fresh])).toEqual([['New', true], ['Old', false]]);
    expect(r.skipped).toBe(0);
    expect(s.writes).toEqual([]); // the expired record is still there: listing doesn't run getSummary's expiry delete
    expect((await listHistory(s.source, NOW)).entries).toHaveLength(2);
  });

  it('only reads sum: records; settings, chats and sessions never show up', async () => {
    const s = spyKV();
    await s.raw('settings', { apiKey: 'SYNTHETIC-KEY' }); await s.raw('sess:https://a.test/', { sessions: [] }); await s.raw('chat:https://a.test/', []);
    await s.raw('sum:https://a.test/', { summary: sum('Hello'), content: 'c', title: 'A', createdAt: NOW });
    const r = await listHistory(s.source, NOW);
    expect(r.entries.map((e) => e.url)).toEqual(['https://a.test/']);
    expect(JSON.stringify(r)).not.toContain('SYNTHETIC-KEY');
  });

  it('keeps old records without hash/anchors, and skips damaged ones with a count', async () => {
    const s = spyKV();
    await s.raw('sum:https://legacy.test/', { summary: sum('Legacy'), content: 'c', title: 'Legacy', createdAt: NOW - 1000 });
    await s.raw('sum:https://broken.test/', { summary: { overview: '' }, title: 'Bad', createdAt: NOW });
    await s.raw('sum:https://null.test/', null);
    await s.raw('sum:https://str.test/', 'oops');
    const r = await listHistory(s.source, NOW);
    expect(r.entries.map((e) => e.title)).toEqual(['Legacy']);
    expect(r.skipped).toBe(3);
  });

  it('does not invent a title or a time: missing values stay empty / unknown and sort last', async () => {
    const s = spyKV();
    await s.raw('sum:https://notime.test/', { summary: sum('No time') });
    await s.raw('sum:https://timed.test/', { summary: sum('Timed'), title: 'T', createdAt: NOW - 5 });
    const r = await listHistory(s.source, NOW);
    expect(r.entries.map((e) => [e.url, e.title, e.createdAt, e.fresh])).toEqual([
      ['https://timed.test/', 'T', NOW - 5, true], ['https://notime.test/', '', null, false]]);
  });

  it('links only http(s) URLs', () => {
    expect(safeHref('https://x.test/a?b=1')).toBe('https://x.test/a?b=1');
    expect(safeHref('http://x.test/')).toBe('http://x.test/');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'chrome://settings', 'not a url']) expect(safeHref(bad)).toBeNull();
    const e = toEntry('sum:javascript:alert(1)', { summary: sum('x'), createdAt: NOW }, NOW)!;
    expect(e.href).toBeNull(); expect(e.host).toBe('');
  });

  it('searches title, URL, overview and section titles; all words must match, case-insensitive', async () => {
    const s = spyKV();
    await s.raw('sum:https://news.test/agents', { summary: sum('Review time is the bottleneck', 'Cognitive debt'), title: 'Agents at work', createdAt: NOW - 1 });
    await s.raw('sum:https://cook.test/bread', { summary: sum('Flour and water'), title: 'Bread', createdAt: NOW - 2 });
    const { entries } = await listHistory(s.source, NOW);
    expect(searchHistory(entries, '').length).toBe(2);
    expect(searchHistory(entries, 'AGENTS').map((e) => e.title)).toEqual(['Agents at work']);
    expect(searchHistory(entries, 'cook.test').map((e) => e.title)).toEqual(['Bread']);
    expect(searchHistory(entries, 'cognitive review').map((e) => e.title)).toEqual(['Agents at work']);
    expect(searchHistory(entries, 'bread agents')).toEqual([]);
  });
});

describe('history detail (settings page)', () => {
  const entry = toEntry('sum:https://www.example.com/post', { summary: sum('Full overview text here', 'First part'), title: 'A very long title '.repeat(10), createdAt: NOW - 3 * TTL_MS }, NOW)!;
  const html = renderToStaticMarkup(<HistoryDetail entry={entry} onBack={() => {}} />);
  it('shows the whole overview with its sections and excerpt, attributed to the page site, not the extension', () => {
    expect(html).toContain('Full overview text here');
    expect(html).toContain('First part');
    expect(html).toContain('A quoted line from the page.');
    expect(html).toContain('example.com');
    expect(html).not.toContain('abcdefghijklmnop');
  });
  it('nothing claims to locate in the page; the original opens in a new tab safely', () => {
    expect(html).not.toContain('role="button"'); // Jump targets render as plain text
    expect(html).toMatch(/<a [^>]*href="https:\/\/www\.example\.com\/post"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain('data-history-detached-note');
  });
  it('marks a record past 24 h without hiding it, and an unsafe URL gets no link', () => {
    expect(['zh-CN', 'en'].some((l) => html.includes(messages(l as 'en').historyStale))).toBe(true);
    const bad = renderToStaticMarkup(<HistoryDetail entry={{ ...entry, url: 'javascript:alert(1)', href: null }} onBack={() => {}} />);
    expect(bad).not.toContain('<a ');
    expect(bad).toContain('Full overview text here');
  });
  it('a detached overview never asks the model or links terms', () => {
    const h = renderToStaticMarkup(<Overview summary={{ overview: 'Uses [[pstack]] here', sections: [] }} host="x.test" />);
    expect(h).not.toContain('data-term'); expect(h).not.toContain('data-regenerate'); expect(h).not.toContain('role="button"');
  });
});
