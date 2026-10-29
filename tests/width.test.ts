import { describe, expect, it } from 'vitest';
import { clampWidth } from '../lib/width';

describe('clampWidth', () => {
  it('keeps values within 320..640', () => {
    expect(clampWidth(380, 1400)).toBe(380);
    expect(clampWidth(100, 1400)).toBe(320);
    expect(clampWidth(900, 1400)).toBe(640);
    expect(clampWidth(500.6, 1400)).toBe(501);
  });
  it('never exceeds viewport - 40', () => {
    expect(clampWidth(640, 600)).toBe(560);
    expect(clampWidth(380, 400)).toBe(360); // narrow viewport beats the 320 floor only when it must
    expect(clampWidth(380, 300)).toBe(260);
  });
  it('falls back to default for NaN', () => expect(clampWidth(NaN, 1400)).toBe(380));
});

import { viewportWidth } from '../lib/width';
describe('viewportWidth', () => {
  it('uses the layout width without the page scrollbar', () => {
    expect(viewportWidth({ documentElement: { clientWidth: 1265 } }, { innerWidth: 1280 })).toBe(1265);
  });
  it('falls back to innerWidth when there is no document element', () => {
    expect(viewportWidth({ documentElement: null }, { innerWidth: 1280 })).toBe(1280);
  });
});
