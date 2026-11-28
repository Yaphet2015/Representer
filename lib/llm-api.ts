/**
 * Pick the OpenAI-compatible request path for a BYOK base URL.
 * Prefer POST {baseUrl}/responses when the server has it; otherwise use {baseUrl}/chat/completions.
 * The choice is cached in memory per normalized base URL so existing settings do not change.
 */
export type LlmApi = 'openai-responses' | 'openai-completions';

/** After a missing-endpoint miss, retry /responses again later so a server that adds it is not stuck. */
export const LLM_API_NEGATIVE_TTL_MS = 15 * 60 * 1000;

type Entry = { api: LlmApi; at: number };

const cache = new Map<string, Entry>();

export function normalizeLlmBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function resetLlmApiCache(): void {
  cache.clear();
}

export function rememberLlmApi(baseUrl: string, api: LlmApi, now = Date.now()): void {
  cache.set(normalizeLlmBaseUrl(baseUrl), { api, at: now });
}

/** Cached path for this base URL, or undefined if we should probe /responses again. */
export function lookupLlmApi(baseUrl: string, now = Date.now()): LlmApi | undefined {
  const key = normalizeLlmBaseUrl(baseUrl);
  const entry = cache.get(key);
  if (!entry) return undefined;
  // "supports /responses" is sticky; a miss expires so we can probe again.
  if (entry.api === 'openai-completions' && now - entry.at >= LLM_API_NEGATIVE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.api;
}

/** HTTP status on the error object or in its message, if one is present. */
function statusOf(e: unknown, msg: string): number | undefined {
  const rec = e as any;
  const n = rec?.status ?? rec?.statusCode ?? rec?.cause?.status ?? rec?.cause?.statusCode;
  if (typeof n === 'number' && n >= 100 && n < 600) return n;
  const m = msg.match(/\b(40[0-9]|42[29]|50[0-35])\b/);
  return m ? Number(m[1]) : undefined;
}

/** A genuine model, auth, or quota failure — never treat these as a missing route. */
function isGenuineServiceError(msg: string): boolean {
  return /model_not_found|unknown model|invalid model|model (?:is )?not found|the model\b.+\bdoes not exist|does not exist or you do not have access|param["']?\s*[:=]\s*["']?model\b|insufficient_quota|quota[_\s-]?exceeded|rate[_ ]?limit|invalid[_ ]?(?:api[_ ]?)?key|incorrect api key|authentication|unauthorized|forbidden|permission[_ ]?denied|access denied/i.test(msg);
}

/** Mentions of a missing /responses route (or an unknown path in general). */
function isMissingRoute(msg: string): boolean {
  return /cannot\s+(?:post|put|get|patch|delete)\b|unknown (?:route|path|endpoint|url)|no such (?:route|path|endpoint)|not (?:found|implemented)|invalid url|unrecognized (?:route|path|endpoint)|unrecognised (?:route|path|endpoint)/i.test(msg);
}

/**
 * True only when the failure means this server has no Responses route.
 * 401/403, quota, and model errors must not trigger a completions retry.
 */
export function isEndpointMissing(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  if (isGenuineServiceError(msg) && !/cannot\s+(?:post|put|get|patch|delete)\b/i.test(msg)) return false;
  const status = statusOf(e, msg);
  if (status === 401 || status === 403 || status === 402 || status === 429) return false;
  if (status === 405 || status === 501) return true;
  if (status === 404) return true;
  if (status !== undefined) return false;
  return isMissingRoute(msg);
}
