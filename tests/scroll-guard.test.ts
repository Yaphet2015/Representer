import { describe, expect, it } from 'vitest';
import { canScrollToward, shouldBlockScroll, type ScrollBox } from '../lib/scroll-guard';

const box = (o: Partial<ScrollBox> = {}): ScrollBox => ({ scrollTop: 0, scrollHeight: 100, clientHeight: 100, scrollLeft: 0, scrollWidth: 100, clientWidth: 100, canX: false, canY: false, ...o });
const list = (top: number) => box({ canY: true, scrollTop: top, scrollHeight: 500, clientHeight: 200 });

describe('canScrollToward', () => {
  it('scrolls down until the end, up until the top', () => {
    expect(canScrollToward(list(0), 0, 10)).toBe(true);
    expect(canScrollToward(list(0), 0, -10)).toBe(false);
    expect(canScrollToward(list(300), 0, 10)).toBe(false);
    expect(canScrollToward(list(299.6), 0, 10)).toBe(false); // fractional end
    expect(canScrollToward(list(300), 0, -10)).toBe(true);
  });
  it('ignores overflow it does not allow, and boxes without overflow', () => {
    expect(canScrollToward(box({ scrollHeight: 500, clientHeight: 200 }), 0, 10)).toBe(false); // overflow hidden
    expect(canScrollToward(box({ canY: true }), 0, 10)).toBe(false); // nothing to scroll
  });
  it('handles the horizontal axis (branch chips)', () => {
    const chips = box({ canX: true, scrollWidth: 400, clientWidth: 200 });
    expect(canScrollToward(chips, 10, 0)).toBe(true);
    expect(canScrollToward(chips, -10, 0)).toBe(false);
    expect(canScrollToward({ ...chips, scrollLeft: 200 }, 10, 0)).toBe(false);
  });
});

describe('shouldBlockScroll', () => {
  it('lets the event through when some ancestor can still scroll that way', () => {
    expect(shouldBlockScroll([box(), list(100), box()], 0, 10)).toBe(false);
  });
  it('blocks at the end of the list so the page behind does not scroll', () => {
    expect(shouldBlockScroll([box(), list(300)], 0, 10)).toBe(true);
    expect(shouldBlockScroll([list(0)], 0, -10)).toBe(true);
  });
  it('blocks over areas with nothing scrollable (capsule, header, composer)', () => {
    expect(shouldBlockScroll([box(), box()], 0, 10)).toBe(true);
  });
  it('a textarea that can scroll keeps its own wheel', () => {
    expect(shouldBlockScroll([box({ canY: true, scrollHeight: 300, clientHeight: 80 }), list(300)], 0, 10)).toBe(false);
  });
  it('does nothing for an empty delta', () => expect(shouldBlockScroll([box()], 0, 0)).toBe(false));
});
