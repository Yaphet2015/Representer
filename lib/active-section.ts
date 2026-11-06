/**
 * Which settings section the nav highlights, from where the sections are now (pure; see entrypoints/options).
 * The section whose top has passed the reading line (10% down the viewport) wins, so a long section stays active
 * while it is read; at the very bottom of the page the last visible section wins, since a short tail section can
 * never reach the line. At the very top, the first section.
 */
export interface SectionBox { id: string; top: number; bottom: number }

export function activeSection(boxes: SectionBox[], view: { height: number; scrollY: number; scrollHeight: number }): string | undefined {
  if (!boxes.length) return undefined;
  if (view.scrollY < 40) return boxes[0]!.id;
  const atBottom = view.scrollY + view.height >= view.scrollHeight - 2;
  if (atBottom) {
    const visible = boxes.filter((b) => b.top < view.height && b.bottom > 0);
    if (visible.length) return visible[visible.length - 1]!.id;
  }
  const line = view.height * 0.1;
  let id = boxes[0]!.id;
  for (const b of boxes) if (b.top <= line + 1) id = b.id;
  return id;
}
