import { describe, expect, it } from 'vitest';
import {
  isEndpointMissing,
  LLM_API_NEGATIVE_TTL_MS,
  lookupLlmApi,
  normalizeLlmBaseUrl,
  rememberLlmApi,
  resetLlmApiCache,
} from '../lib/llm-api';

describe('normalizeLlmBaseUrl', () => {
  it('strips trailing slashes so /v1 and /v1/ share a cache key', () => {
    expect(normalizeLlmBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(normalizeLlmBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1');
  });
});

describe('isEndpointMissing', () => {
  it('treats a missing route (404, 405, unknown path) as endpoint-missing', () => {
    expect(isEndpointMissing(new Error('Model call failed: byok API error (404): Cannot POST /v1/responses'))).toBe(true);
    expect(isEndpointMissing(new Error('Model call failed: byok API error (404): 404 status code (no body)'))).toBe(true);
    expect(isEndpointMissing(new Error('404 Not Found'))).toBe(true);
    expect(isEndpointMissing(Object.assign(new Error('Not Found'), { status: 404 }))).toBe(true);
    expect(isEndpointMissing(new Error('Model call failed: byok API error (405): Method Not Allowed'))).toBe(true);
    expect(isEndpointMissing(Object.assign(new Error('method not allowed'), { status: 405 }))).toBe(true);
    expect(isEndpointMissing(new Error('unknown route: /v1/responses'))).toBe(true);
    expect(isEndpointMissing(new Error('Invalid URL (POST /v1/responses)'))).toBe(true);
  });

  it('does not treat auth, quota, or model errors as a missing endpoint', () => {
    expect(isEndpointMissing(new Error('Model call failed: byok API error (401): invalid key'))).toBe(false);
    expect(isEndpointMissing(new Error('Model call failed: byok API error (403): forbidden'))).toBe(false);
    expect(isEndpointMissing(Object.assign(new Error('invalid_api_key'), { status: 401 }))).toBe(false);
    expect(isEndpointMissing(new Error('429: rate_limit_exceeded'))).toBe(false);
    expect(isEndpointMissing(new Error('402: insufficient_quota'))).toBe(false);
    expect(isEndpointMissing(new Error('Model call failed: byok API error (404): {"message":"The model \'gpt-x\' does not exist or you do not have access to it.","type":"invalid_request_error","param":"model","code":"model_not_found"}'))).toBe(false);
    expect(isEndpointMissing(new Error('404: model not found'))).toBe(false);
    expect(isEndpointMissing(new Error('400: Function tools with reasoning_effort are not supported'))).toBe(false);
  });
});

describe('lookupLlmApi / rememberLlmApi', () => {
  it('treats a Responses hit as sticky and expires a completions miss', () => {
    resetLlmApiCache();
    const url = 'https://api.example.com/v1/';
    expect(lookupLlmApi(url, 0)).toBeUndefined();
    rememberLlmApi(url, 'openai-responses', 0);
    expect(lookupLlmApi('https://api.example.com/v1', LLM_API_NEGATIVE_TTL_MS * 10)).toBe('openai-responses');

    resetLlmApiCache();
    rememberLlmApi(url, 'openai-completions', 1_000);
    expect(lookupLlmApi(url, 1_000 + LLM_API_NEGATIVE_TTL_MS - 1)).toBe('openai-completions');
    expect(lookupLlmApi(url, 1_000 + LLM_API_NEGATIVE_TTL_MS)).toBeUndefined();
  });
});
