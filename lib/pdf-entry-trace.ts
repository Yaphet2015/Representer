/** Test-build-only, bounded session breadcrumbs; never page text, URLs, or grants. */
export const ENTRY_TRACE_KEY = 'rp-entry-check-v1';
/** Separate key: the panel page and worker never read-modify-write the same array concurrently. */
export const PANEL_TRACE_KEY = 'rp-entry-check-panel-v1';
export const CONTENT_ENTRY_TRACE = 'rp-entry-content-trace';
const contentStages = {
  'content-key-fallback': true, 'content-key-command-owned': true, 'content-key-lookup-failed': true,
  'content-toggle-message': true, 'content-toggle-keydown': true, 'content-toggle-dedup': true,
  'content-mount-request': true, 'content-mounted': true, 'content-toggle-existing': true, 'content-mount-rejected': true,
};
export type ContentEntryStage = keyof typeof contentStages;
export function isContentEntryStage(value: unknown): value is ContentEntryStage {
  return typeof value === 'string' && Object.hasOwn(contentStages, value);
}
const stages = {
  ...contentStages, 'web-toggle-request': true, 'web-toggle-resolved': true,
  'worker-main': true, 'entry-install': true, 'listeners-ready': true, 'hydrate-done': true,
  command: true, toolbar: true, activate: true, 'skip-no-tab': true, 'skip-url': true,
  'skip-loading': true, 'cached-pdf': true, 'mime-request': true, 'mime-pdf': true,
  'mime-web': true, 'mime-stale': true, 'open-request': true, 'open-resolved': true,
  'open-rejected': true, 'options-rejected': true, 'entry-error': true,
  'options-resolved': true, 'open-tab-state': true,
  forget: true, 'disable-request': true, 'disable-resolved': true, 'disable-rejected': true,
  'close-request': true, 'close-resolved': true, 'close-rejected': true,
  'global-disable-request': true, 'global-disable-resolved': true, 'global-disable-rejected': true,
  'announce-html': true, 'announce-pdf': true,
  'context-request': true, 'context-ping-pdf': true, 'context-ping-html': true,
  'context-ping-other': true, 'context-no-receiver': true,
  'context-pdf': true, 'context-none': true, 'context-web': true,
  'panel-load': true, 'panel-visible': true, 'panel-hidden': true, 'panel-unload': true,
};
export type EntryTraceStage = keyof typeof stages;
const errorCodes = {
  'pdf-user-gesture': true, 'pdf-open': true, 'document-loading': true,
  'document-unavailable': true, 'webpage-unavailable': true,
};
export type EntryErrorCode = keyof typeof errorCodes;
const reasons = {
  startup: true, 'tab-removed': true, 'navigation-public': true, 'navigation-checked': true,
  'navigation-tab-missing': true, 'webpage-route': true, 'html-announce': true, 'context-handoff': true,
  'no-request-tab': true, 'no-valid-grant': true, 'context-tab-missing': true,
  'context-url-mismatch': true, 'context-url-recheck': true, 'context-tab-recheck-missing': true,
  'grant-replaced': true, 'context-error': true,
};
export type EntryTraceReason = keyof typeof reasons;
export interface EntryTraceInput {
  stage: EntryTraceStage;
  reason?: EntryTraceReason;
  knownKind?: 'pdf' | 'html';
  hasGrant?: boolean;
  sameDocument?: boolean;
  /** Compares sender.documentId with last inspected top-frame documentId; never stores either ID. */
  sameInspectedDocument?: boolean;
  tabId?: number;
  hasTab?: boolean;
  hasUrl?: boolean;
  publicUrl?: boolean;
  status?: 'loading' | 'complete' | 'other';
  code?: EntryErrorCode;
  /** Tab.active as Chrome reported it (command tab, or tabs.get after open). */
  active?: boolean;
  /** document.visibilityState === 'visible' inside the panel page. */
  visible?: boolean;
}
export interface EntryTraceRow extends EntryTraceInput { at: number; boot: number }
export const ENTRY_TRACE_LIMIT = 80;

export function readEntryTrace(value: unknown): EntryTraceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: unknown): EntryTraceRow[] => {
    if (!v || typeof v !== 'object' || !('stage' in v) || typeof v.stage !== 'string'
      || !Object.hasOwn(stages, v.stage) || !('at' in v) || typeof v.at !== 'number'
      || !('boot' in v) || typeof v.boot !== 'number') return [];
    // Reconstruct through the same allowlist used for new rows.
    const stage = Object.keys(stages).find((key): key is EntryTraceStage => key === v.stage);
    if (!stage) return [];
    const code = 'code' in v ? Object.keys(errorCodes).find((key): key is EntryErrorCode => key === v.code) : undefined;
    return [{
      stage, at: v.at, boot: v.boot,
      tabId: 'tabId' in v && typeof v.tabId === 'number' ? v.tabId : undefined,
      hasTab: 'hasTab' in v && typeof v.hasTab === 'boolean' ? v.hasTab : undefined,
      hasUrl: 'hasUrl' in v && typeof v.hasUrl === 'boolean' ? v.hasUrl : undefined,
      publicUrl: 'publicUrl' in v && typeof v.publicUrl === 'boolean' ? v.publicUrl : undefined,
      status: 'status' in v && (v.status === 'loading' || v.status === 'complete' || v.status === 'other') ? v.status : undefined,
      code,
      reason: 'reason' in v ? Object.keys(reasons).find((key): key is EntryTraceReason => key === v.reason) : undefined,
      knownKind: 'knownKind' in v && (v.knownKind === 'pdf' || v.knownKind === 'html') ? v.knownKind : undefined,
      hasGrant: 'hasGrant' in v && typeof v.hasGrant === 'boolean' ? v.hasGrant : undefined,
      sameDocument: 'sameDocument' in v && typeof v.sameDocument === 'boolean' ? v.sameDocument : undefined,
      sameInspectedDocument: 'sameInspectedDocument' in v && typeof v.sameInspectedDocument === 'boolean' ? v.sameInspectedDocument : undefined,
      active: 'active' in v && typeof v.active === 'boolean' ? v.active : undefined,
      visible: 'visible' in v && typeof v.visible === 'boolean' ? v.visible : undefined,
    }];
  }).slice(-ENTRY_TRACE_LIMIT);
}

export function createEntryRecorder(storage: {
  read(): Promise<unknown>;
  write(rows: EntryTraceRow[]): Promise<void>;
}, now: () => number = Date.now) {
  const boot = now();
  let buffered: EntryTraceRow[] = [];
  let scheduled = false;
  let pending = Promise.resolve();
  const record = (input: EntryTraceInput) => {
    buffered.push({
      at: now(), boot, stage: input.stage, tabId: input.tabId, hasTab: input.hasTab,
      hasUrl: input.hasUrl, publicUrl: input.publicUrl, status: input.status, code: input.code,
      active: input.active, visible: input.visible, reason: input.reason, knownKind: input.knownKind,
      hasGrant: input.hasGrant, sameDocument: input.sameDocument, sameInspectedDocument: input.sameInspectedDocument,
    });
    if (scheduled) return;
    scheduled = true;
    // Do not call another Chrome API before the routing handler reaches open/executeScript.
    // No interval, timeout, port, or polling keeps the worker awake.
    queueMicrotask(() => {
      scheduled = false;
      const batch = buffered; buffered = [];
      pending = pending.then(async () => {
        const previous = readEntryTrace(await storage.read());
        await storage.write([...previous, ...batch].slice(-ENTRY_TRACE_LIMIT));
      }).catch(() => {}); // Diagnostics must never break the action being observed.
    });
  };
  return { record, async drained() { await Promise.resolve(); await pending; } };
}

const recorders = new Map<string, ReturnType<typeof createEntryRecorder>>();
export function recordEntryTrace(input: EntryTraceInput, key: string = ENTRY_TRACE_KEY) {
  let recorder = recorders.get(key);
  if (!recorder) {
    recorder = createEntryRecorder({
      read: async () => (await chrome.storage.session.get(key))[key],
      write: async (rows) => { await chrome.storage.session.set({ [key]: rows }); },
    });
    recorders.set(key, recorder);
  }
  recorder.record(input);
}
