/**
 * Panel glass opacity from what the host page shows behind the panel. On a light, calm page the panel is .82 white
 * over a 28px blur; on dark or highly saturated pages the blurred colours bleed through too much, so it goes up to .88.
 * Pure functions here; the DOM sampling (which elements sit behind the panel, their colours) is in `sampleBehind`.
 */
export type RGBA = { r: number; g: number; b: number; a: number };
export const GLASS_LIGHT = 0.82;
export const GLASS_STRONG = 0.88;

/** Parse rgb()/rgba()/#hex colours (what getComputedStyle and gradients serialize to). null for anything else. */
export function parseColor(s: string): RGBA | null {
  const str = s.trim().toLowerCase();
  let m = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
  }
  m = str.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  return null;
}

/** Every colour literal inside a CSS value, e.g. a gradient's stops. */
export function colorsIn(value: string): RGBA[] {
  return (value.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? []).map(parseColor).filter((c): c is RGBA => !!c && c.a > 0);
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance({ r, g, b }: RGBA): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** HSL saturation, 0 … 1. */
export function saturation({ r, g, b }: RGBA): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2;
  if (mx === mn) return 0;
  return (mx - mn) / (1 - Math.abs(2 * l - 1));
}

/** Chroma (max − min channel), 0 … 1: how much colour there is, unlike HSL saturation which calls pastels "saturated". */
export function chroma({ r, g, b }: RGBA): number { return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }

/** Composite a translucent colour over an opaque one. */
export function over(top: RGBA, under: RGBA): RGBA {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

/**
 * A page is "loud" behind the panel when, on average, it is dark (luminance under .35), or when a sizeable share
 * (≥ 30%) of the sampled points is a vivid colour (chroma ≥ .45). Empty samples: assume a light page.
 */
export function glassAlpha(samples: RGBA[]): number {
  if (!samples.length) return GLASS_LIGHT;
  const lum = samples.reduce((s, c) => s + luminance(c), 0) / samples.length;
  const vivid = samples.filter((c) => chroma(c) >= 0.45).length / samples.length;
  return lum < 0.35 || vivid >= 0.3 ? GLASS_STRONG : GLASS_LIGHT;
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

/** The colour an element paints at a point, as far as CSS tells: its own background colour, else the average of its gradient stops. */
function paintOf(el: Element): RGBA | null {
  const cs = getComputedStyle(el);
  const grad = colorsIn(cs.backgroundImage);
  if (grad.length) {
    const n = grad.length;
    return { r: grad.reduce((s, c) => s + c.r, 0) / n, g: grad.reduce((s, c) => s + c.g, 0) / n, b: grad.reduce((s, c) => s + c.b, 0) / n, a: Math.max(...grad.map((c) => c.a)) };
  }
  const bg = parseColor(cs.backgroundColor);
  return bg && bg.a > 0 ? bg : null;
}

/** Sample a 3×4 grid of points behind `rect`, ignoring our own overlay host, compositing each stack down to an opaque colour. */
export function sampleBehind(rect: { left: number; top: number; width: number; height: number }, skip: Element): RGBA[] {
  const out: RGBA[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const x = rect.left + rect.width * (i + 0.5) / 3, y = rect.top + rect.height * (j + 0.5) / 4;
    const stack = document.elementsFromPoint(x, y).filter((el) => el !== skip && !skip.contains(el));
    let c: RGBA | null = null;
    const layers: RGBA[] = [];
    for (const el of stack) {
      if (/^(IMG|VIDEO|CANVAS|PICTURE|svg)$/i.test(el.tagName)) { c = { r: 128, g: 128, b: 128, a: 1 }; break; } // media: treat as mid-grey, busy
      const p = paintOf(el); if (!p) continue;
      layers.push(p);
      if (p.a >= 1) { c = p; break; }
    }
    let base = c ?? WHITE;
    for (const l of layers.reverse()) if (l !== c) base = over(l, base);
    out.push(base);
  }
  return out;
}
