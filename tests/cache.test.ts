import { describe, expect, it } from 'vitest';
import { createCache, isFresh, TTL_MS } from '../lib/cache';
import { memKV } from '../lib/storage';
import { normalizeUrl } from '../lib/url';

const summary = { overview: 'x', keyTerms: [], sections: [] };

describe('cache TTL', () => {
  it('isFresh boundaries', () => {
    expect(isFresh(0, TTL_MS - 1)).toBe(true);
    expect(isFresh(0, TTL_MS)).toBe(false);
    expect(isFresh(1000, 0)).toBe(false);
  });
  it('returns cached within 24h and expires after', async () => {
    let now = 1_000_000;
    const c = createCache(memKV(), () => now);
    await c.setSummary('u', { summary, content: 'c', title: 't' });
    now += TTL_MS - 1000;
    expect((await c.getSummary('u'))?.summary).toEqual(summary);
    now += 2000;
    expect(await c.getSummary('u')).toBeNull();
  });
  it('clearSummary drops the overview only and leaves sessions in place', async () => {
    const kv = memKV();
    const c = createCache(kv);
    const sessions = { active: 'main', sessions: [{ id: 'main', name: '主线', messages: [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'ok' }], createdAt: 0 }] };
    await c.setSummary('u', { summary, content: 'c', title: 't' });
    await c.setSessions('u', sessions);
    await c.clearSummary('u');
    expect(await c.getSummary('u')).toBeNull();
    expect(await kv.get('sess:u')).toEqual(sessions);
    expect(await kv.get('chat:u')).toBeUndefined();
    expect((await c.getSessions('u')).sessions[0]!.messages).toEqual(sessions.sessions[0]!.messages);
  });
  it('expiring an overview does not drop sessions, and clearSummary keeps a legacy chat key', async () => {
    let now = 1_000_000;
    const kv = memKV();
    const c = createCache(kv, () => now);
    await c.setSummary('u', { summary, content: 'c', title: 't' });
    await c.setSessions('u', { active: 'main', sessions: [{ id: 'main', name: '主线', messages: [{ role: 'user' as const, content: 'kept' }], createdAt: 0 }] });
    now += TTL_MS + 1;
    expect(await c.getSummary('u')).toBeNull();
    expect((await c.getSessions('u')).sessions[0]!.messages).toEqual([{ role: 'user', content: 'kept' }]);
    await kv.set('chat:legacy', [{ role: 'user', content: 'legacy' }]);
    await c.clearSummary('legacy');
    expect((await c.getSessions('legacy')).sessions[0]!.messages[0]!.content).toBe('legacy');
  });
  it('normalizes URLs for cache keys', () => {
    expect(normalizeUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('https://example.com/a/?a=1&b=2');
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a');
  });
});
