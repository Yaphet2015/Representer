import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrayMove, createAutosaver, failedField, type SaveStatus } from '../lib/autosave';
import { createSkillStore, DEFAULT_SKILLS } from '../lib/skills';
import { memKV } from '../lib/storage';
import { resolveTheme } from '../lib/theme';
import { dropIndex, keyStep } from '../components/SkillsManager';

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const setup = (save = vi.fn(async (_: string) => {})) => { const st: SaveStatus[] = []; return { save, st, a: createAutosaver(save, (s) => st.push(s), 600) }; };

  it('debounces rapid text edits into one write of the latest value', async () => {
    const { save, st, a } = setup();
    a.schedule('a'); a.schedule('ab'); vi.advanceTimersByTime(599); a.schedule('abc');
    vi.advanceTimersByTime(599); expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith('abc');
    expect(st).toEqual(['saving', 'saved']);
  });
  it('flush writes immediately and drops the pending debounce', async () => {
    const { save, a } = setup();
    a.schedule('x'); await a.flush('toggle');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save.mock.calls).toEqual([['toggle']]);
  });
  it('flush() with no argument writes the pending value, or nothing', async () => {
    const { save, a } = setup();
    await a.flush(); expect(save).not.toHaveBeenCalled();
    a.schedule('p'); await a.flush(); expect(save.mock.calls).toEqual([['p']]);
  });
  it('reports errors and retry writes the last value again', async () => {
    let fail = true; const save = vi.fn(async () => { if (fail) throw new Error('quota'); });
    const st: SaveStatus[] = []; const a = createAutosaver<string>(save, (s) => st.push(s));
    await a.flush('v'); expect(st.at(-1)).toBe('error');
    fail = false; await a.retry(); expect(st.at(-1)).toBe('saved'); expect(save).toHaveBeenLastCalledWith('v');
  });
});

describe('failedField', () => {
  it('maps errors to the field to outline', () => {
    expect(failedField('401 Unauthorized: invalid api key')).toBe('apiKey');
    expect(failedField('403 Forbidden')).toBe('apiKey');
    expect(failedField('getaddrinfo ENOTFOUND api.foo')).toBe('baseUrl');
    expect(failedField('404 Not Found')).toBe('baseUrl');
    expect(failedField('model_not_found: The model gpt-x does not exist')).toBe('model');
    expect(failedField('timeout')).toBeNull();
  });
});

describe('skill reorder', () => {
  it('arrayMove / dropIndex / keyStep', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    const mids = [24, 72, 120, 168];
    expect(dropIndex(mids, 0, 24)).toBe(0);
    expect(dropIndex(mids, 0, 130)).toBe(2); // dragged past b and c
    expect(dropIndex(mids, 3, 50)).toBe(1);
    expect(keyStep(0, 'ArrowUp', 4)).toBe(0); expect(keyStep(0, 'ArrowDown', 4)).toBe(1);
    expect(keyStep(2, 'Home', 4)).toBe(0); expect(keyStep(1, 'End', 4)).toBe(3); expect(keyStep(1, 'x', 4)).toBe(1);
  });
  it('store.reorder / moveTo / replaceAll persist the order', async () => {
    const kv = memKV(); const store = createSkillStore(kv);
    const ids = DEFAULT_SKILLS.map((s) => s.id);
    await store.reorder([...ids].reverse());
    expect((await store.list()).map((s) => s.id)).toEqual([...ids].reverse());
    await store.moveTo(ids[0]!, 0);
    expect((await store.list())[0]!.id).toBe(ids[0]);
    const before = await store.list(); await store.resetDefaults(); await store.replaceAll(before);
    expect(await store.list()).toEqual(before);
  });
  it('reorder keeps unlisted skills at the end', async () => {
    const store = createSkillStore(memKV());
    const ids = DEFAULT_SKILLS.map((s) => s.id);
    await store.reorder([ids[2]!]);
    const got = (await store.list()).map((s) => s.id);
    expect(got[0]).toBe(ids[2]); expect(got).toHaveLength(ids.length);
  });
});

describe('resolveTheme', () => {
  it('explicit setting wins, system follows the OS', () => {
    expect(resolveTheme('dark', false)).toBe('dark'); expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark'); expect(resolveTheme(undefined, false)).toBe('light');
  });
});

import { readFileSync } from 'node:fs';
import { errorKind } from '../lib/autosave';
import { messages } from '../lib/i18n';

describe('errorKind', () => {
  it('classifies connection errors and every kind has zh + en copy', () => {
    const cases: [string, string][] = [
      ['401: {"code":"invalid_api_key"}', 'auth'], ['403 Forbidden', 'auth'],
      ['404 status code (no body)', 'url'], ['getaddrinfo ENOTFOUND x.invalid', 'url'],
      ['model_not_found', 'model'], ['TypeError: Failed to fetch', 'network'], ['connect ECONNREFUSED 127.0.0.1', 'network'],
      ['Request timed out', 'timeout'], ['500 Internal Server Error', 'generic'],
    ];
    for (const [e, k] of cases) expect(errorKind(e), e).toBe(k);
    for (const lang of ['zh-CN', 'en'] as const) for (const [, k] of cases) expect(messages(lang).errKind[k as 'auth']).toBeTruthy();
  });
});

describe('theme-boot.js', () => {
  const run = (stored: string | null, systemDark: boolean) => {
    const attrs: Record<string, string> = {}; const classes = new Set<string>();
    const el = { setAttribute: (k: string, v: string) => { attrs[k] = v; }, classList: { add: (c: string) => classes.add(c) } };
    new Function('localStorage', 'matchMedia', 'document', readFileSync('public/theme-boot.js', 'utf8'))(
      { getItem: () => stored }, () => ({ matches: systemDark }), { documentElement: el });
    return { theme: attrs['data-theme'], dark: classes.has('dark') };
  };
  it('applies the cached theme before paint, resolving system via matchMedia', () => {
    expect(run('dark', false)).toEqual({ theme: 'dark', dark: true });
    expect(run('light', true)).toEqual({ theme: 'light', dark: false });
    expect(run('system', true)).toEqual({ theme: 'dark', dark: true });
    expect(run(null, false)).toEqual({ theme: 'light', dark: false });
  });
  it('is referenced from the options page head, not inline', () => {
    const html = readFileSync('entrypoints/options/index.html', 'utf8');
    expect(html).toMatch(/<head>[\s\S]*<script src="\/theme-boot\.js"><\/script>[\s\S]*<\/head>/);
    expect(html).toContain('name="color-scheme" content="light dark"');
  });
});
