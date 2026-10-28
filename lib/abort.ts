/** Cancellation helpers shared by the background worker and the LLM layer. */
export class AbortError extends Error {
  constructor(message = 'Aborted') { super(message); this.name = 'AbortError'; }
}
export const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';

/** Settles as soon as `signal` aborts, even when `work` ignores it (the work itself is not stopped here). */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { work.catch(() => {}); return Promise.reject(new AbortError()); }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
