import { describe, expect, it, vi } from 'vitest';
import { createEntryRecorder, isContentEntryStage, ENTRY_TRACE_LIMIT, readEntryTrace, type EntryTraceInput, type EntryTraceRow } from '../lib/pdf-entry-trace';

function memoryStore() {
  let rows: unknown = [];
  return { read: vi.fn(async () => rows), write: vi.fn(async (value: EntryTraceRow[]) => { rows = value; }), rows: () => readEntryTrace(rows) };
}

describe('test-only shortcut session breadcrumbs', () => {
  it('does no storage work in the command turn, preserving the original synchronous open path', async () => {
    const store = memoryStore();
    const trace = createEntryRecorder(store, () => 1000);
    trace.record({ stage: 'command', tabId: 8, hasTab: true });
    trace.record({ stage: 'cached-pdf', tabId: 8 });
    trace.record({ stage: 'open-request', tabId: 8 });
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled();
    await trace.drained();
    expect(store.rows().map((r) => r.stage)).toEqual(['command', 'cached-pdf', 'open-request']);
    expect(store.read).toHaveBeenCalledTimes(1);
  });
  it('preserves earlier worker boots while bounding the snapshot to the last 80 events', async () => {
    const store = memoryStore();
    const first = createEntryRecorder(store, () => 1000);
    first.record({ stage: 'worker-main' }); first.record({ stage: 'listeners-ready' });
    await first.drained();
    const second = createEntryRecorder(store, () => 2000);
    second.record({ stage: 'worker-main' }); second.record({ stage: 'command', tabId: 8 });
    await second.drained();
    expect(store.rows().map((r) => r.boot)).toEqual([1000, 1000, 2000, 2000]);
    for (let i = 0; i < 100; i++) second.record({ stage: 'open-resolved', tabId: 8 });
    await second.drained();
    expect(store.rows()).toHaveLength(ENTRY_TRACE_LIMIT);
  });
  it('never copies URLs, tokens, arbitrary errors or extra fields into persisted records', async () => {
    const store = memoryStore();
    const trace = createEntryRecorder(store, () => 1000);
    const extra: EntryTraceInput & { url: string; token: string; error: string } = {
      stage: 'command', hasTab: true, url: 'private-url', token: 'private-token', error: 'private-error',
    };
    trace.record(extra); await trace.drained();
    const output = JSON.stringify(store.rows());
    expect(output).not.toContain('private'); expect(output).not.toContain('url'); expect(output).not.toContain('token');
    expect(store.rows()[0]?.stage).toBe('command');
  });
  it('validates old records and strips extra fields when merging a later worker snapshot', () => {
    const rows = readEntryTrace([{ stage: 'command', at: 1, boot: 1, tabId: 8, url: 'private' },
      { stage: '__proto__', at: 1, boot: 1 }, { stage: 'command', at: 'wrong', boot: 1 }]);
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain('private');
  });
  it('keeps routing independent of unavailable diagnostic storage and recovers the write queue', async () => {
    const store = memoryStore(); store.write.mockRejectedValueOnce(new Error('diagnostics unavailable'));
    const trace = createEntryRecorder(store, () => 1000);
    trace.record({ stage: 'command' }); await expect(trace.drained()).resolves.toBeUndefined();
    trace.record({ stage: 'open-resolved' }); await trace.drained();
    expect(store.rows().map((r) => r.stage)).toEqual(['open-resolved']);
  });
  it('keeps the panel lifecycle and tab-active fields, and drops non-boolean values', async () => {
    const store = memoryStore();
    const trace = createEntryRecorder(store, () => 1000);
    trace.record({ stage: 'command', tabId: 8, active: true });
    trace.record({ stage: 'options-resolved', tabId: 8 });
    trace.record({ stage: 'open-tab-state', tabId: 8, active: false });
    trace.record({ stage: 'panel-load', tabId: 8, visible: false });
    trace.record({ stage: 'panel-visible', tabId: 8, visible: true });
    trace.record({ stage: 'panel-unload', tabId: 8, visible: false });
    await trace.drained();
    expect(store.rows().map((r) => [r.stage, r.active, r.visible])).toEqual([
      ['command', true, undefined], ['options-resolved', undefined, undefined],
      ['open-tab-state', false, undefined], ['panel-load', undefined, false],
      ['panel-visible', undefined, true], ['panel-unload', undefined, false],
    ]);
    expect(readEntryTrace([{ stage: 'panel-load', at: 1, boot: 1, visible: 'yes', active: 1 }]))
      .toEqual([{ stage: 'panel-load', at: 1, boot: 1, tabId: undefined, hasTab: undefined, hasUrl: undefined,
        publicUrl: undefined, status: undefined, code: undefined, active: undefined, visible: undefined }]);
  });
});

it('teardown reasons and identity comparisons are allowlisted; raw document identity is never copied', async () => {
  const store = memoryStore(); const trace = createEntryRecorder(store, () => 1000);
  trace.record({ stage: 'forget', tabId: 8, reason: 'context-handoff', knownKind: 'pdf', hasGrant: true });
  trace.record({ stage: 'announce-html', tabId: 8, sameDocument: true, sameInspectedDocument: false });
  await trace.drained();
  expect(store.rows()[0]).toMatchObject({ reason: 'context-handoff', knownKind: 'pdf', hasGrant: true });
  expect(store.rows()[1]).toMatchObject({ sameDocument: true, sameInspectedDocument: false });
  const rows = readEntryTrace([{ stage: 'announce-html', at: 1, boot: 1, reason: 'private-url', knownKind: 'secret',
    hasGrant: 'yes', sameDocument: 1, sameInspectedDocument: 'yes', documentId: 'private-id', token: 'private-token' }]);
  expect(rows[0]).toMatchObject({ reason: undefined, knownKind: undefined, hasGrant: undefined, sameDocument: undefined, sameInspectedDocument: undefined });
  expect(JSON.stringify(rows)).not.toMatch(/private|secret/);
});

it('only accepts the closed set of diagnostic content lifecycle stage names', () => {
  expect(isContentEntryStage('content-mounted')).toBe(true);
  expect(isContentEntryStage('content-key-command-owned')).toBe(true);
  expect(isContentEntryStage('forget')).toBe(false);
  expect(isContentEntryStage('https://private.example')).toBe(false);
  expect(isContentEntryStage({ stage: 'content-mounted' })).toBe(false);
});
