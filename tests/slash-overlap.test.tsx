import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LangProvider } from '../components/i18n';
import { MENU_MAX_PX, menuMaxHeight, SlashMenu, slashItems, slashKeyAction } from '../components/SlashMenu';
import { SkillsRow } from '../components/SkillsRow';
import { messages } from '../lib/i18n';
import type { Skill } from '../lib/skills';

const skill = (n: number): Skill => ({ id: `s${n}`, name: `技能${n}`, template: 'summarize {{page_title}} for me please, in detail', icon: '💡' } as Skill);
const skills = Array.from({ length: 12 }, (_, i) => skill(i));
const t = messages('zh-CN');
const wrap = (el: React.ReactElement) => renderToStaticMarkup(<LangProvider>{el}</LangProvider>);
const row = (yieldTo: boolean) => wrap(<SkillsRow skills={skills.slice(0, 4)} onRun={() => {}} disabled={false} yield={yieldTo} />);

describe('quick-ask strip yields to the slash menu', () => {
  it('is visible and clickable while the menu is closed', () => {
    const html = row(false);
    expect(html).toContain('data-skills-row');
    expect(html).not.toContain('invisible');
    expect(html).not.toContain('pointer-events-none');
    expect(html).not.toContain('aria-hidden="true" class="rp-noscrollbar');
  });
  it('is hidden from sight, pointer, tab order and screen readers while the menu is open, and still mounted (so it comes back)', () => {
    const html = row(true);
    expect(html).toContain('data-skills-row');
    expect(html).toMatch(/invisible/);
    expect(html).toMatch(/pointer-events-none/);
    expect(html).toMatch(/opacity-0/);
    expect(html).toContain('aria-hidden="true"');
  });
  it('the menu opens exactly while the input starts with "/", so the strip returns when it closes', () => {
    for (const [input, open] of [['/', true], ['/技能1', true], ['/side hi', true], ['/zzz-none', false], ['hello', false], ['', false]] as const)
      expect(slashItems(input, skills, t).length > 0, input).toBe(open);
  });
  it('the menu is always painted above the strip', () => {
    const menu = wrap(<SlashMenu items={slashItems('/', skills.slice(0, 3), t)} active={0} onPick={() => {}} onHover={() => {}} />);
    expect(menu).toContain('data-slash-menu');
    expect(menu).toMatch(/z-20/);
    expect(row(false)).toMatch(/z-10/);
  });
});

describe('menu height follows the room above the composer', () => {
  it('uses the preferred height in a tall panel and never more', () => {
    expect(menuMaxHeight(900, 100)).toBe(MENU_MAX_PX);
  });
  it('shrinks to fit a short panel so the top is never clipped', () => {
    expect(menuMaxHeight(300, 200)).toBe(88);
    expect(menuMaxHeight(260, 200)).toBeLessThan(MENU_MAX_PX);
  });
  it('keeps a usable minimum (it scrolls) in a very short panel', () => {
    expect(menuMaxHeight(210, 200)).toBe(48);
  });
});

describe('keyboard still drives the menu', () => {
  const items = slashItems('/', skills.slice(0, 3), t); // /side + 3 skills
  const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });
  it('moves with the arrows, wrapping both ways', () => {
    expect(slashKeyAction(key('ArrowDown'), items, 0, '/')).toEqual({ type: 'move', active: 1 });
    expect(slashKeyAction(key('ArrowDown'), items, items.length - 1, '/')).toEqual({ type: 'move', active: 0 });
    expect(slashKeyAction(key('ArrowUp'), items, 0, '/')).toEqual({ type: 'move', active: items.length - 1 });
  });
  it('picks the active item with Tab or Enter, but not with Shift+Enter', () => {
    expect(slashKeyAction(key('Tab'), items, 2, '/')).toEqual({ type: 'pick', item: items[2] });
    expect(slashKeyAction(key('Enter'), items, 1, '/')).toEqual({ type: 'pick', item: items[1] });
    expect(slashKeyAction(key('Enter', true), items, 1, '/')).toBeNull();
  });
  it('lets Enter send "/side text" instead of re-picking /side', () => {
    const side = slashItems('/side hi', skills, t);
    expect(slashKeyAction(key('Enter'), side, 0, '/side hi')).toBeNull();
    expect(slashKeyAction(key('Tab'), side, 0, '/side hi')).toEqual({ type: 'pick', item: side[0] });
  });
  it('Escape closes (clears the input); other keys and an empty menu do nothing', () => {
    expect(slashKeyAction(key('Escape'), items, 0, '/')).toEqual({ type: 'close' });
    expect(slashKeyAction(key('a'), items, 0, '/')).toBeNull();
    expect(slashKeyAction(key('ArrowDown'), [], 0, '/')).toBeNull();
  });
});
