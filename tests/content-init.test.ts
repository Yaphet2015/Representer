import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimContentInitialization } from '../lib/content-init';

afterEach(() => { globalThis.__representerContentInitialized = false; });

describe('content initialization ownership', () => {
  it('initializes once when the same isolated world executes the content bundle twice', () => {
    const cleanups: Array<() => void> = [];
    const initialize = vi.fn();
    const run = () => { if (claimContentInitialization((cleanup) => cleanups.push(cleanup))) initialize(); };
    run(); run();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(cleanups).toHaveLength(1);
  });
  it('allows WXT to replace an invalidated context without leaving a stale initialized flag', () => {
    const cleanups: Array<() => void> = [];
    expect(claimContentInitialization((cleanup) => cleanups.push(cleanup))).toBe(true);
    cleanups[0]?.();
    expect(claimContentInitialization((cleanup) => cleanups.push(cleanup))).toBe(true);
    expect(claimContentInitialization(() => {})).toBe(false);
  });
});
