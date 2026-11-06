/**
 * Overview history for the settings page: a read-only view of the summaries already kept in chrome.storage.local
 * under `sum:<url>` (lib/cache.ts). Nothing here writes, removes, or calls the model: listing must not run
 * getSummary, whose expiry check deletes stale entries.
 */
import { isFresh } from './cache';
import { isSummary } from './parse';
import type { Summary } from './types';

export const SUM_PREFIX = 'sum:';

export interface HistoryEntry {
  /** the cache key's URL (normalized page URL) */
  url: string;
  /** an http(s) URL safe to open, else null (no link is shown) */
  href: string | null;
  /** page title as stored; '' when missing */
  title: string;
  /** hostname without www.; '' when the URL can't be parsed */
  host: string;
  /** generation time (ms), or null when the stored value isn't a usable time */
  createdAt: number | null;
  /** still inside the 24 h reuse window (lib/cache.ts TTL_MS) */
  fresh: boolean;
  summary: Summary;
}

export interface HistoryList { entries: HistoryEntry[]; /** `sum:` records that couldn't be shown (damaged / unknown shape) */ skipped: number }

/** Read-only source of `sum:` records. Only those keys are ever read when the browser can list keys. */
export interface HistorySource { readSummaries(): Promise<Record<string, unknown>> }

export function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** One stored record → an entry, or null when it can't be rendered. Old records without hash/anchors are fine. */
export function toEntry(key: string, value: unknown, now: number): HistoryEntry | null {
  if (!key.startsWith(SUM_PREFIX) || !value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isSummary(v.summary)) return null;
  const url = key.slice(SUM_PREFIX.length);
  const createdAt = typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) && v.createdAt > 0 ? v.createdAt : null;
  return {
    url, href: safeHref(url), host: hostOf(url),
    title: typeof v.title === 'string' ? v.title.trim() : '',
    createdAt, fresh: createdAt !== null && isFresh(createdAt, now),
    summary: v.summary,
  };
}

/** Newest first; records without a usable time go last, then by URL so the order is stable. */
export function byNewest(a: HistoryEntry, b: HistoryEntry): number {
  return (b.createdAt ?? -1) - (a.createdAt ?? -1) || a.url.localeCompare(b.url);
}

export async function listHistory(src: HistorySource, now = Date.now()): Promise<HistoryList> {
  const all = await src.readSummaries();
  let skipped = 0;
  const entries: HistoryEntry[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(SUM_PREFIX)) continue;
    const e = toEntry(k, v, now);
    if (e) entries.push(e); else skipped++;
  }
  return { entries: entries.sort(byNewest), skipped };
}

/** Case-insensitive match on title, URL, overview and section titles; every word must match. */
export function searchHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => {
    const hay = [e.title, e.url, e.summary.overview, ...e.summary.sections.map((s) => s.title)].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** chrome.storage.local, reading only `sum:` keys (getKeys, Chrome 130+); older browsers read all and drop the rest here. */
export const chromeHistorySource: HistorySource = {
  async readSummaries() {
    const area = chrome.storage.local as chrome.storage.LocalStorageArea & { getKeys?: () => Promise<string[]> };
    if (typeof area.getKeys === 'function') {
      const keys = (await area.getKeys()).filter((k) => k.startsWith(SUM_PREFIX));
      return keys.length ? await area.get(keys) : {};
    }
    const all = await area.get(null);
    return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(SUM_PREFIX)));
  },
};

/** Call `fn` when any `sum:` record changes; returns an unsubscribe function. */
export function onHistoryChange(fn: () => void): () => void {
  const h = (c: Record<string, unknown>, area: string) => { if (area === 'local' && Object.keys(c).some((k) => k.startsWith(SUM_PREFIX))) fn(); };
  chrome.storage.onChanged.addListener(h);
  return () => chrome.storage.onChanged.removeListener(h);
}
