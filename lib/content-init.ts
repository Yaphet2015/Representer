// The isolated-world global survives repeated execution of the packaged content script.
// WXT invalidates an older context before starting a replacement; release ownership then.
declare global {
  var __representerContentInitialized: boolean | undefined;
}

export function claimContentInitialization(onInvalidated: (cleanup: () => void) => unknown): boolean {
  if (globalThis.__representerContentInitialized) return false;
  globalThis.__representerContentInitialized = true;
  onInvalidated(() => { globalThis.__representerContentInitialized = false; });
  return true;
}
