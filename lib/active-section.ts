/**
 * Which settings section the nav highlights, from where the sections are now (pure; see entrypoints/options).
 * The section whose top has passed the reading line (10% down the viewport) wins, so a long section stays active
 * while it is read. At the very top, the first section. Every section can reach the line: the page keeps a viewport
 * of room below the last one (SectionTail).
 */
export interface SectionBox { id: string; top: number; bottom: number }

export function activeSection(boxes: SectionBox[], view: { height: number; scrollY: number }): string | undefined {
  if (!boxes.length) return undefined;
  if (view.scrollY < 40) return boxes[0]!.id;
  const line = view.height * 0.1;
  let id = boxes[0]!.id;
  for (const b of boxes) if (b.top <= line + 1) id = b.id;
  return id;
}
