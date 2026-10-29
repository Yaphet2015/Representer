import { describe, expect, it } from 'vitest';
import { collapseForPage, EXPANDED, escClosesPanel, stepCollapse, type CollapseState } from '../lib/capsule';

/** feed a series of scrollTop values as user (or programmatic) scrolling */
const run = (tops: number[], { user = true, range = 1000, from = EXPANDED as CollapseState, start = 0 } = {}) => {
  let s = from, prev = start;
  for (const top of tops) { s = stepCollapse(s, { top, prevTop: prev, range, user }); prev = top; }
  return s;
};

describe('capsule collapse', () => {
  it('collapses after 24px of reading down, once past 48px', () => {
    expect(run([20, 40]).collapsed).toBe(false); // 40px down but still above 48
    expect(run([20, 40, 50]).collapsed).toBe(true);
    expect(run([60], { start: 50 }).collapsed).toBe(false); // only 10px of movement
    expect(run([60, 75], { start: 50 }).collapsed).toBe(true); // 25px accumulated
  });

  it('expands after 16px of scrolling back up; changing direction resets the count', () => {
    const c = run([100, 200]);
    expect(c.collapsed).toBe(true);
    expect(run([190], { from: c, start: 200 }).collapsed).toBe(true);
    expect(run([190, 183], { from: c, start: 200 }).collapsed).toBe(false);
    expect(run([190, 195, 185], { from: c, start: 200 }).collapsed).toBe(true); // 10 up, 5 down, 10 up
  });

  it('always expands at the top (<= 8px), even from programmatic scrolls', () => {
    const c = run([100, 200]);
    expect(run([8], { from: c, start: 200, user: false })).toEqual(EXPANDED);
    expect(run([5], { from: c, start: 200 }).collapsed).toBe(false);
  });

  it('ignores programmatic scrolling (stream auto-follow) in both directions', () => {
    expect(run([100, 300, 600], { user: false }).collapsed).toBe(false);
    const c = run([100, 200]);
    expect(run([150, 100], { from: c, start: 200, user: false }).collapsed).toBe(true);
  });

  it('never collapses a page that barely scrolls', () => {
    expect(run([30, 60, 79], { range: 79 }).collapsed).toBe(false);
    expect(collapseForPage(200, 50).collapsed).toBe(false);
  });

  it('decides from the page’s own position when switching tabs', () => {
    expect(collapseForPage(47, 1000).collapsed).toBe(false);
    expect(collapseForPage(48, 1000).collapsed).toBe(true);
  });
});

describe('Esc closes the panel', () => {
  const k = (o: Partial<Parameters<typeof escClosesPanel>[0]> = {}) => escClosesPanel({ key: 'Escape', defaultPrevented: false, ...o });
  it('closes on a plain Esc', () => expect(k()).toBe(true));
  it('leaves Esc to a control that already handled it (slash menu)', () => expect(k({ defaultPrevented: true })).toBe(false));
  it('does not close while an IME is composing', () => {
    expect(k({ isComposing: true })).toBe(false);
    expect(k({ keyCode: 229 })).toBe(false);
  });
  it('ignores other keys', () => expect(k({ key: 'Enter' })).toBe(false));
});
