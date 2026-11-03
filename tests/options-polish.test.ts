import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cn } from '@/lib/cn';
import { inputCls } from '@/components/options/ui';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('options polish', () => {
  it('cn lets caller classes override base classes', () => {
    const icon = cn(inputCls(), 'w-12 shrink-0 px-0').split(' ');
    expect(icon).toContain('w-12');
    expect(icon).not.toContain('w-full');
    expect(icon).not.toContain('px-3');
  });

  it('skill editor: icon is fixed width, name flexes', () => {
    const s = src('components/SkillsManager.tsx');
    expect(s).toMatch(/aria-label=\{t\.icon\}[^\n]*'w-12 shrink-0/);
    expect(s).toMatch(/aria-label=\{t\.name\}[^\n]*'min-w-0 flex-1'/);
  });

  it('General is the first section in nav and content', () => {
    const m = src('entrypoints/options/main.tsx');
    expect(m).toMatch(/SECTIONS = \['general',/);
    expect(m).toMatch(/const nav = \[\s*\{ id: 'general'/);
    const cards = [...m.matchAll(/<Card id="(\w+)"/g)].map((x) => x[1]);
    expect(cards[0]).toBe('general');
  });

  it('header logo is the real brand icon, not a solid placeholder', () => {
    const m = src('entrypoints/options/main.tsx');
    expect(m).toMatch(/<img data-brand-logo src="\/icon\/128\.png"/);
  });
});
