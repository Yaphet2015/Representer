import type { ChatMessage, Summary } from './types';
import type { Anchors } from './locate';
import { initialState, type SessionsState } from './sessions';
import type { KV } from './storage';

export const TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedSummary { summary: Summary; content: string; title: string; createdAt: number; /** pageHash of `content` (missing in older entries: computed from `content`) */ hash?: string; /** fingerprints of the block ids the summary points at (missing in older entries) */ anchors?: Anchors }

/** A short hash of the page text (FNV-1a, 2×32 bits): a cached summary is only reused for the same text. */
export function pageHash(content: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ content.length;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

export function isFresh(createdAt: number, now = Date.now(), ttl = TTL_MS): boolean {
  return now - createdAt >= 0 && now - createdAt < ttl;
}

export function createCache(kv: KV, now: () => number = Date.now) {
  return {
    /** the summary cached for `url`; with `hash`, only when it was made from the same page text (see pageHash) */
    async getSummary(url: string, hash?: string): Promise<CachedSummary | null> {
      const v = (await kv.get('sum:' + url)) as CachedSummary | undefined;
      if (!v) return null;
      if (!isFresh(v.createdAt, now())) { await kv.remove('sum:' + url); return null; }
      if (hash && (v.hash ?? pageHash(v.content)) !== hash) return null; // the page changed: kept until a new summary replaces it
      return v;
    },
    async setSummary(url: string, data: Omit<CachedSummary, 'createdAt'>) {
      await kv.set('sum:' + url, { ...data, hash: pageHash(data.content), createdAt: now() });
    },
    async clearSummary(url: string) { await kv.remove('sum:' + url); await kv.remove('chat:' + url); await kv.remove('sess:' + url); },
    /** Chat sessions for a page (main + side sessions). Migrates the legacy single-chat key. */
    async getSessions(url: string): Promise<SessionsState> {
      const s = (await kv.get('sess:' + url)) as SessionsState | undefined;
      if (s?.sessions?.length) return s;
      return initialState(((await kv.get('chat:' + url)) as ChatMessage[]) ?? [], now());
    },
    async setSessions(url: string, s: SessionsState) { await kv.set('sess:' + url, s); await kv.remove('chat:' + url); },
    /** Read-modify-write the page's sessions. */
    async updateSessions(url: string, fn: (s: SessionsState) => SessionsState): Promise<SessionsState> {
      const next = fn(await this.getSessions(url)); await this.setSessions(url, next); return next;
    },
  };
}
