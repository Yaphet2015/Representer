import { describe, expect, it } from 'vitest';
import { activeSection, type SectionBox } from '../lib/active-section';

/** Sections laid out top to bottom in page coordinates; `at(scrollY)` returns their viewport boxes. */
function page(sections: [string, number][], gap = 24, start = 80, tail = 48) {
  let y = start; const abs = sections.map(([id, h]) => { const b = { id, top: y, bottom: y + h }; y += h + gap; return b; });
  const scrollHeight = y - gap + tail;
  return (scrollY: number, height = 800) => ({ boxes: abs.map((b): SectionBox => ({ id: b.id, top: b.top - scrollY, bottom: b.bottom - scrollY })), view: { height, scrollY, scrollHeight } , maxY: Math.max(0, scrollHeight - height) });
}
const pick = (p: ReturnType<typeof page>, y: number, h?: number) => { const r = p(y, h); return activeSection(r.boxes, r.view); };
const SECTIONS: [string, number][] = [['general', 160], ['connection', 420], ['instructions', 260], ['skills', 380], ['shortcuts', 260]];

describe('settings nav: active section', () => {
  it('General at the top of the page', () => {
    expect(pick(page([...SECTIONS, ['history', 600]]), 0)).toBe('general');
  });
  it('a long history detail stays active all the way while it is read, down to the very bottom', () => {
    const p = page([...SECTIONS, ['history', 3000]]);
    const historyTop = 80 + SECTIONS.reduce((n, [, h]) => n + h + 24, 0);
    const max = p(0).maxY;
    for (let y = historyTop - 40; y <= max; y += 150) expect(pick(p, y)).toBe('history');
    expect(pick(p, max)).toBe('history');
  });
  it('sections in the middle are active when their top reaches the reading line', () => {
    const p = page([...SECTIONS, ['history', 600]]);
    expect(pick(p, 80 + 160 + 24 - 60)).toBe('connection');
    expect(pick(p, 80 + 160 + 24 + 420 + 24 + 260 + 24 - 60)).toBe('skills');
  });
  it('a narrow viewport with the top nav bar works the same way', () => {
    const p = page([...SECTIONS, ['history', 900]], 24, 130);
    expect(pick(p, p(0, 600).maxY, 600)).toBe('history');
  });
  it('nothing to show is undefined', () => {
    expect(activeSection([], { height: 800, scrollY: 0 })).toBeUndefined();
  });
});
