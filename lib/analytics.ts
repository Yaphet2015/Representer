/**
 * Anonymous usage stats via the GA4 Measurement Protocol (MV3 forbids remote gtag.js).
 * Only an allowlisted set of events and enum/number params is ever sent: never URLs, page text, prompts, keys or model output.
 * No-op without a build-time api secret (WXT_GA_API_SECRET), in dev builds, in mock mode, or when the user opts out.
 */
import type { KV } from './storage';

export const GA_MEASUREMENT_ID = 'G-9KHE1R22BZ';
export const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const CLIENT_KEY = 'gaClientId';
const SESSION_KEY = 'gaSession';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** event name → the params it may carry (and nothing else) */
export const EVENTS = {
  extension_installed: ['reason', 'version'],
  panel_opened: ['source'],
  overview_generated: ['success', 'duration_bucket', 'chunked'],
  chat_message_sent: [],
  skill_run: [],
  settings_saved: [],
} as const satisfies Record<string, readonly string[]>;
export type EventName = keyof typeof EVENTS;
type Param = string | number | boolean;

export const durationBucket = (ms: number): string =>
  ms < 5_000 ? '<5s' : ms < 10_000 ? '5-10s' : ms < 20_000 ? '10-20s' : ms < 40_000 ? '20-40s' : ms < 80_000 ? '40-80s' : '80s+';

/** drop unknown params and anything that is not a short enum-like value */
export function sanitize(name: EventName, params: Record<string, unknown> = {}): Record<string, Param> {
  const out: Record<string, Param> = {};
  for (const k of EVENTS[name] as readonly string[]) {
    const v = params[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && v.length <= 40 && !/[/:@\s]/.test(v.replace(/^[<>]/, ''))) out[k] = v;
  }
  return out;
}

export interface AnalyticsDeps {
  kv: KV;
  secret: string | undefined;
  /** false in dev builds, mock mode, or when the user turned stats off */
  enabled: () => Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => string;
}

export function createAnalytics({ kv, secret, enabled, fetch: f = fetch, now = Date.now, random = () => crypto.randomUUID() }: AnalyticsDeps) {
  const clientId = async () => {
    let id = (await kv.get(CLIENT_KEY)) as string | undefined;
    if (!id) { id = random(); await kv.set(CLIENT_KEY, id); }
    return id;
  };
  const sessionId = async () => {
    const t = now();
    let s = (await kv.get(SESSION_KEY)) as { id: string; last: number } | undefined;
    if (!s || t - s.last > SESSION_TIMEOUT_MS) s = { id: String(Math.floor(t / 1000)), last: t };
    else s = { ...s, last: t };
    await kv.set(SESSION_KEY, s);
    return s.id;
  };
  return {
    async track(name: EventName, params?: Record<string, unknown>): Promise<boolean> {
      try {
        if (!secret || !(name in EVENTS) || !(await enabled())) return false;
        const body = {
          client_id: await clientId(),
          non_personalized_ads: true,
          events: [{ name, params: { ...sanitize(name, params), session_id: await sessionId(), engagement_time_msec: 100 } }],
        };
        const url = `${GA_ENDPOINT}?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${encodeURIComponent(secret)}`;
        await f(url, { method: 'POST', body: JSON.stringify(body) });
        return true;
      } catch { return false; } // stats must never break the extension
    },
  };
}
export type Analytics = ReturnType<typeof createAnalytics>;
