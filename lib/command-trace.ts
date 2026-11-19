/** TEST-ONLY command / toolbar trace. Compiled in only when VITE_RP_CMD_DIAG=1.
 *  Records whether a shortcut or action arrived, whether Chrome gave a tab, a URL
 *  *kind* (never the URL itself), and whether sidePanel.open was called or rejected.
 *  No page content, titles, tokens, credentials, or document URLs are stored or logged.
 */
export const COMMAND_TRACE_KEY = 'rp-cmd-trace';
export const COMMAND_TRACE_LIMIT = 20;

export type UrlKind = 'missing' | 'http' | 'https' | 'chrome-extension' | 'chrome' | 'file' | 'blob' | 'other';
export type CommandTraceSource = 'command' | 'action';
export type CommandTraceOutcome =
  | 'no-tab'
  | 'no-usable-url'
  | 'overlay'
  | 'open-called'
  | 'open-ok'
  | 'open-failed';

export type CommandTraceEvent = {
  seq: number;
  at: number;
  source: CommandTraceSource;
  command?: string;
  hasTab: boolean;
  tabId?: number;
  urlKind: UrlKind;
  outcome: CommandTraceOutcome;
  openError?: string;
};

const OUTCOMES = new Set<CommandTraceOutcome>(['no-tab', 'no-usable-url', 'overlay', 'open-called', 'open-ok', 'open-failed']);
const SOURCES = new Set<CommandTraceSource>(['command', 'action']);
const KINDS = new Set<UrlKind>(['missing', 'http', 'https', 'chrome-extension', 'chrome', 'file', 'blob', 'other']);

export const commandTraceEnabled = import.meta.env.VITE_RP_CMD_DIAG === '1';

export function urlKindOf(url?: string): UrlKind {
  if (!url) return 'missing';
  try {
    const p = new URL(url).protocol;
    if (p === 'http:') return 'http';
    if (p === 'https:') return 'https';
    if (p === 'chrome-extension:') return 'chrome-extension';
    if (p === 'chrome:') return 'chrome';
    if (p === 'file:') return 'file';
    if (p === 'blob:') return 'blob';
    return 'other';
  } catch {
    return 'other';
  }
}

/** Keep only the allowlisted fields. Drop URLs, titles, tokens, and any unknown keys. */
export function sanitizeCommandTraceEvent(input: CommandTraceEvent): CommandTraceEvent {
  const seq = Number.isInteger(input.seq) ? input.seq : 0;
  const at = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : 0;
  const source: CommandTraceSource = SOURCES.has(input.source) ? input.source : 'command';
  const outcome: CommandTraceOutcome = OUTCOMES.has(input.outcome) ? input.outcome : 'no-tab';
  const urlKind: UrlKind = KINDS.has(input.urlKind) ? input.urlKind : 'other';
  const event: CommandTraceEvent = { seq, at, source, hasTab: input.hasTab === true, urlKind, outcome };
  if (typeof input.command === 'string' && input.command.length <= 64 && !looksSensitive(input.command)) event.command = input.command;
  if (typeof input.tabId === 'number' && Number.isInteger(input.tabId) && input.tabId >= 0) event.tabId = input.tabId;
  if (typeof input.openError === 'string' && input.openError && !looksSensitive(input.openError)) {
    event.openError = input.openError.slice(0, 200);
  }
  return event;
}

function looksSensitive(s: string): boolean {
  return /https?:\/\/|chrome-extension:\/\/|token|api[-_]?key|authorization|bearer\s/i.test(s);
}

export function appendCommandTrace(events: CommandTraceEvent[], event: CommandTraceEvent): CommandTraceEvent[] {
  const next = [...events, sanitizeCommandTraceEvent(event)];
  return next.length > COMMAND_TRACE_LIMIT ? next.slice(-COMMAND_TRACE_LIMIT) : next;
}

export function isCommandTraceState(v: unknown): v is { events: CommandTraceEvent[]; nextSeq: number } {
  if (!v || typeof v !== 'object' || !('events' in v) || !('nextSeq' in v)) return false;
  const rec = v as { events: unknown; nextSeq: unknown };
  return Array.isArray(rec.events) && typeof rec.nextSeq === 'number' && Number.isInteger(rec.nextSeq);
}

export async function recordCommandTrace(partial: Omit<CommandTraceEvent, 'seq' | 'at'> & { at?: number; seq?: number }): Promise<CommandTraceEvent | null> {
  if (!commandTraceEnabled) return null;
  const stored: unknown = (await chrome.storage.session.get(COMMAND_TRACE_KEY))[COMMAND_TRACE_KEY];
  const prev = isCommandTraceState(stored) ? stored : { events: [] as CommandTraceEvent[], nextSeq: 1 };
  const seq = partial.seq ?? prev.nextSeq;
  const event = sanitizeCommandTraceEvent({ ...partial, seq, at: partial.at ?? Date.now() });
  const next = { events: appendCommandTrace(prev.events, event), nextSeq: Math.max(prev.nextSeq, seq) + 1 };
  await chrome.storage.session.set({ [COMMAND_TRACE_KEY]: next });
  try { console.info('[rp-cmd-trace]', event); } catch { /* ignore */ }
  return event;
}

export async function loadCommandTrace(): Promise<CommandTraceEvent[]> {
  if (!commandTraceEnabled) return [];
  const stored: unknown = (await chrome.storage.session.get(COMMAND_TRACE_KEY))[COMMAND_TRACE_KEY];
  return isCommandTraceState(stored) ? stored.events.map(sanitizeCommandTraceEvent) : [];
}

export async function clearCommandTrace(): Promise<void> {
  if (!commandTraceEnabled) return;
  await chrome.storage.session.remove(COMMAND_TRACE_KEY);
}
