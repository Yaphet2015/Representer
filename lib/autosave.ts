export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave for the options page. `schedule` coalesces rapid edits (text fields) into one write after `delay` ms;
 * `flush` writes now (toggles, selects, blur). Status goes saving → saved, or error (retry() writes the last value again).
 */
export function createAutosaver<T>(save: (v: T) => Promise<unknown>, onStatus: (s: SaveStatus) => void, delay = 600) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { v: T } | null = null;
  let last: { v: T } | null = null;
  let seq = 0;
  const write = async (v: T) => {
    const id = ++seq; last = { v };
    onStatus('saving');
    try { await save(v); if (id === seq) onStatus('saved'); }
    catch { if (id === seq) onStatus('error'); }
  };
  return {
    schedule(v: T) {
      pending = { v };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; const p = pending; pending = null; if (p) void write(p.v); }, delay);
    },
    async flush(v?: T) {
      if (timer) { clearTimeout(timer); timer = null; }
      const p = arguments.length ? { v: v as T } : pending; pending = null;
      if (p) await write(p.v);
    },
    async retry() { if (last) await write(last.v); },
    /** true while a debounced write is waiting */
    pending: () => timer !== null,
    cancel() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}

/** Which connection field a failed test points at (so the UI can outline it in red). */
export function failedField(error: string): 'apiKey' | 'baseUrl' | 'model' | null {
  const e = error.toLowerCase();
  if (/model[_ ]not[_ ]found|model .*does not exist|no such model|unknown model/.test(e)) return 'model';
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key|incorrect api key/.test(e)) return 'apiKey';
  if (/enotfound|\b404\b|not found|failed to fetch|getaddrinfo|econnrefused|invalid url/.test(e)) return 'baseUrl';
  return null;
}

/** Move item `from` → `to` in a copy of the list. */
export function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const a = [...list]; const [x] = a.splice(from, 1); a.splice(Math.max(0, Math.min(to, a.length)), 0, x!); return a;
}
