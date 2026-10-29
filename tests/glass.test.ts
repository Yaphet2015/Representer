import { describe, expect, it } from 'vitest';
import { chroma, colorsIn, glassAlpha, GLASS_LIGHT, GLASS_STRONG, luminance, over, parseColor, saturation } from '../lib/glass';

const c = (s: string) => parseColor(s)!;

describe('parseColor', () => {
  it('reads computed rgb/rgba and hex', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0b0b16')).toEqual({ r: 11, g: 11, b: 22, a: 1 });
    expect(parseColor('transparent')).toBeNull();
  });
  it('finds the stops of a gradient, dropping transparent ones', () => {
    expect(colorsIn('radial-gradient(circle at 70% 30%, rgb(255, 77, 141) 0px, rgba(0, 0, 0, 0) 35%)')).toEqual([{ r: 255, g: 77, b: 141, a: 1 }]);
    expect(colorsIn('none')).toEqual([]);
  });
});

describe('colour metrics', () => {
  it('luminance spans black to white', () => {
    expect(luminance(c('#000'))).toBe(0);
    expect(luminance(c('#fff'))).toBeCloseTo(1);
  });
  it('saturation: greys are 0, pure hues are 1', () => {
    expect(saturation(c('#777'))).toBe(0);
    expect(saturation(c('#ff4d8d'))).toBeCloseTo(1);
  });
  it('chroma: pastels are low, vivid hues high', () => {
    expect(chroma(c('#fde2e4'))).toBeLessThan(0.2);
    expect(chroma(c('#3b82f6'))).toBeGreaterThan(0.7);
  });
  it('composites translucent colour over the colour beneath', () => {
    expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, c('#fff'))).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
});

describe('glassAlpha', () => {
  it('stays at .82 on light, calm pages (and when nothing was sampled)', () => {
    expect(glassAlpha(Array(12).fill(c('#fafaf7')))).toBe(GLASS_LIGHT);
    expect(glassAlpha([...Array(10).fill(c('#fafaf7')), c('#e86a5c'), c('#6b8cff')])).toBe(GLASS_LIGHT); // one picture in an article
    expect(glassAlpha([])).toBe(GLASS_LIGHT);
  });
  it('raises to .88 on dark pages', () => {
    expect(glassAlpha(Array(12).fill(c('#0b0b16')))).toBe(GLASS_STRONG);
    expect(glassAlpha(Array(12).fill(c('#1f2937')))).toBe(GLASS_STRONG);
  });
  it('raises to .88 when a large share of the backdrop is vivid colour', () => {
    expect(glassAlpha([...Array(8).fill(c('#fff')), c('#ff4d8d'), c('#3b82f6'), c('#22d3ee'), c('#ff4d8d')])).toBe(GLASS_STRONG);
  });
  it('pastel tints are not vivid', () => {
    expect(glassAlpha(Array(12).fill(c('#fde2e4')))).toBe(GLASS_LIGHT);
  });
});
