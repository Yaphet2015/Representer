import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendCommandTrace, sanitizeCommandTraceEvent, urlKindOf, COMMAND_TRACE_LIMIT, type CommandTraceEvent } from '@/lib/command-trace';

const base = (): CommandTraceEvent => ({
  seq: 1, at: 1_700_000_000_000, source: 'command', command: 'toggle-overlay',
  hasTab: true, tabId: 8, urlKind: 'https', outcome: 'open-called',
});

describe('urlKindOf', () => {
  it('classifies schemes without exposing the rest of the URL', () => {
    expect(urlKindOf(undefined)).toBe('missing');
    expect(urlKindOf('https://example.com/a.pdf')).toBe('https');
    expect(urlKindOf('http://example.com/a.pdf')).toBe('http');
    expect(urlKindOf('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe('chrome-extension');
    expect(urlKindOf('chrome://downloads/')).toBe('chrome');
    expect(urlKindOf('file:///tmp/a.pdf')).toBe('file');
    expect(urlKindOf('blob:https://example.com/1')).toBe('blob');
    expect(urlKindOf('not a url')).toBe('other');
  });
});

describe('sanitizeCommandTraceEvent', () => {
  it('keeps only the allowlisted fields', () => {
    const dirty = { ...base(), url: 'https://secret.example/doc.pdf', token: 'abc', title: 'Quarterly', text: 'page text' } as CommandTraceEvent;
    expect(sanitizeCommandTraceEvent(dirty)).toEqual(base());
  });

  it('drops openError values that look like URLs or secrets', () => {
    expect(sanitizeCommandTraceEvent({ ...base(), outcome: 'open-failed', openError: 'https://evil.example/x' }).openError).toBeUndefined();
    expect(sanitizeCommandTraceEvent({ ...base(), outcome: 'open-failed', openError: 'Side panel is not enabled' }).openError).toBe('Side panel is not enabled');
  });
});

describe('appendCommandTrace', () => {
  it('caps the log at the bound and drops the oldest events', () => {
    const events: CommandTraceEvent[] = [];
    let cur = events;
    for (let i = 1; i <= COMMAND_TRACE_LIMIT + 3; i++) cur = appendCommandTrace(cur, { ...base(), seq: i });
    expect(cur).toHaveLength(COMMAND_TRACE_LIMIT);
    expect(cur[0]!.seq).toBe(4);
    expect(cur.at(-1)!.seq).toBe(COMMAND_TRACE_LIMIT + 3);
  });
});

describe('commandTraceEnabled is off in the default test/build', () => {
  it('does not write session storage when the flag is unset', async () => {
    const set = vi.fn();
    vi.stubGlobal('chrome', { storage: { session: { get: async () => ({}), set } } });
    const { recordCommandTrace, commandTraceEnabled } = await import('@/lib/command-trace');
    expect(commandTraceEnabled).toBe(false);
    await expect(recordCommandTrace({ source: 'command', hasTab: false, urlKind: 'missing', outcome: 'no-tab' })).resolves.toBeNull();
    expect(set).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
