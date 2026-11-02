import { describe, expect, it, vi } from 'vitest';
import { createAnalytics, durationBucket, GA_MEASUREMENT_ID, sanitize } from '@/lib/analytics';
import { memKV } from '@/lib/storage';

const setup = (o: { secret?: string; enabled?: boolean } = {}) => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const kv = memKV();
  let t = 1_700_000_000_000;
  const a = createAnalytics({ kv, secret: 'secret' in o ? o.secret : 'S3CRET', enabled: async () => o.enabled ?? true, fetch: fetch as any, now: () => t, random: () => 'cid-1' });
  return { a, fetch, kv, tick: (ms: number) => { t += ms; } };
};
const body = (f: any, i = 0) => JSON.parse(f.mock.calls[i][1].body);

describe('analytics', () => {
  it('sends a GA4 MP payload', async () => {
    const { a, fetch } = setup();
    expect(await a.track('overview_generated', { success: true, duration_bucket: durationBucket(12_000), chunked: false })).toBe(true);
    const [url, init] = fetch.mock.calls[0] as any;
    expect(url).toBe(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=S3CRET`);
    expect(init.method).toBe('POST');
    const b = body(fetch);
    expect(b.client_id).toBe('cid-1');
    expect(b.events[0]).toEqual({ name: 'overview_generated', params: { success: true, duration_bucket: '10-20s', chunked: false, session_id: '1700000000', engagement_time_msec: 100 } });
  });
  it('keeps client_id, renews session after 30 min idle', async () => {
    const { a, fetch, tick } = setup();
    await a.track('panel_opened', { source: 'toolbar' }); tick(60_000);
    await a.track('chat_message_sent'); tick(31 * 60_000);
    await a.track('skill_run');
    const ids = [0, 1, 2].map((i) => body(fetch, i));
    expect(new Set(ids.map((b) => b.client_id)).size).toBe(1);
    expect(ids[0].events[0].params.session_id).toBe(ids[1].events[0].params.session_id);
    expect(ids[2].events[0].params.session_id).not.toBe(ids[1].events[0].params.session_id);
  });
  it('is a no-op without a secret', async () => {
    const { a, fetch } = setup({ secret: undefined });
    expect(await a.track('settings_saved')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('respects opt-out / dev / mock (enabled=false)', async () => {
    const { a, fetch } = setup({ enabled: false });
    expect(await a.track('panel_opened')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('never sends PII-ish fields', async () => {
    const { a, fetch } = setup();
    await a.track('chat_message_sent', { url: 'https://x.com/a', text: 'my prompt', apiKey: 'sk-1', output: 'answer' } as any);
    await a.track('panel_opened', { source: 'https://evil.com/page', title: 'Secret page' } as any);
    const s = JSON.stringify([body(fetch, 0), body(fetch, 1)]);
    for (const bad of ['x.com', 'my prompt', 'sk-1', 'answer', 'evil.com', 'Secret']) expect(s).not.toContain(bad);
    expect(Object.keys(body(fetch, 0).events[0].params).sort()).toEqual(['engagement_time_msec', 'session_id']);
  });
  it('never throws when fetch fails', async () => {
    const { a, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await a.track('skill_run')).toBe(false);
  });
  it('sanitize + buckets', () => {
    expect(sanitize('extension_installed', { reason: 'update', version: '0.1.11', extra: 1 })).toEqual({ reason: 'update', version: '0.1.11' });
    expect([durationBucket(1000), durationBucket(7000), durationBucket(99_000)]).toEqual(['<5s', '5-10s', '80s+']);
  });
});
