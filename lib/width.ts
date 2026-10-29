export const DEFAULT_WIDTH = 380;
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 640;
export const EDGE_GAP = 40; // 20px margin on each side

/** Clamp panel width to [320, 640] and never wider than viewport - 40 (min wins on tiny viewports' sanity: never below 0). */
export function clampWidth(w: number, viewport: number): number {
  if (!Number.isFinite(w)) w = DEFAULT_WIDTH;
  const max = Math.min(MAX_WIDTH, viewport - EDGE_GAP);
  return Math.round(Math.max(Math.min(MIN_WIDTH, Math.max(0, max)), Math.min(w, max)));
}

/** Layout viewport width without the page's vertical scrollbar (the panel's `right` offset is measured from there too). */
export function viewportWidth(doc: { documentElement?: { clientWidth: number } | null } = document, win: { innerWidth: number } = window): number {
  return doc.documentElement?.clientWidth || win.innerWidth;
}
