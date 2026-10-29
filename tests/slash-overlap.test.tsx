import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LangProvider } from '../components/i18n';
import { MENU_MAX_PX, menuMaxHeight, quickItems, skillDesc, SlashMenu, slashItems, slashKeyAction } from '../components/SlashMenu';
import { Composer, openMenu } from '../components/Composer';
import { messages } from '../lib/i18n';
import { DEFAULT_SKILLS, DEFAULT_SKILLS_EN, type Skill } from '../lib/skills';

const skill = (n: number): Skill => ({ id: `s${n}`, name: `技能${n}`, template: 'summarize {{page_title}} for me please, in detail', icon: '💡' } as Skill);
const skills = Array.from({ length: 12 }, (_, i) => skill(i));
const t = messages('zh-CN');
const wrap = (el: React.ReactElement) => renderToStaticMarkup(<LangProvider>{el}</LangProvider>);

describe('quick actions: one list for the / menu and the + menu', () => {
  const builtin = (id: string, name: string): Skill => ({ ...[...DEFAULT_SKILLS, ...DEFAULT_SKILLS_EN].find((d) => d.id === id)!, name });
  it('the / menu opens exactly while the input starts with "/" and something matches', () => {
    for (const [input, open] of [['/', true], ['/技能1', true], ['/side hi', true], ['/zzz-none', false], ['hello', false], ['', false]] as const)
      expect(slashItems(input, skills, t).length > 0, input).toBe(open);
  });
  it('lists every Skill, then /side, with a line icon, a name and a short grey description', () => {
    const items = quickItems([builtin('translate-en', '翻译成英文'), builtin('key-points', '提炼要点'), skill(1)], t);
    expect(items.map((i) => i.key)).toEqual(['translate-en', 'key-points', 's1', 'side']);
    expect(items.map((i) => i.desc)).toEqual(['保留术语', '一句一条', 'summarize fo…', t.sideDesc]);
    expect(items[3]!.name).toBe(t.sideName);
    const html = wrap(<SlashMenu items={items} active={1} onPick={() => {}} onHover={() => {}} />);
    expect(html).not.toContain('🌐'); // line icons, not emoji
    expect(html.match(/<svg/g)).toHaveLength(4);
    expect(html.match(/class="flex h-8 /g)).toHaveLength(4); // 32px rows
    expect(html).toContain('rp-menu');
  });
  it('a built-in Skill the user edited gets the template as its description', () => {
    expect(skillDesc({ ...builtin('qa', 'x'), template: '{{input}} 用三句话总结这一页的核心观点' }, t)).toBe('用三句话总结这一页的核心…');
    expect(skillDesc(builtin('qa', 'Quiz me'), messages('en'))).toBe('Check yourself');
    expect(skillDesc({ id: 'qa', name: 'x', template: '短 {{input}}' }, t)).toBe('短');
  });
  it('typed "/" wins over the + menu; the + menu shows the full list', () => {
    const all = quickItems(skills.slice(0, 2), t);
    expect(openMenu([all[0]!], all, true)).toEqual({ mode: 'slash', items: [all[0]] });
    expect(openMenu([], all, true)).toEqual({ mode: 'plus', items: all });
    expect(openMenu([], all, false)).toEqual({ mode: null, items: [] });
    expect(openMenu([], [], true).mode).toBeNull();
  });
  it('the + button is borderless, and turns into a light-blue × while open', () => {
    const ref = { current: null };
    const html = wrap(<Composer value="" onChange={() => {}} onSubmit={() => {}} disabled={false} canSend={false} status="" slashItems={[]} onPickSlash={() => {}} quickItems={quickItems(skills.slice(0, 2), t)} onPickQuick={() => {}} inputRef={ref} />);
    const plus = html.match(/<button[^>]*data-plus[^>]*>/)![0];
    expect(plus).not.toMatch(/\bborder\b/);
    expect(plus).toContain('aria-expanded="false"');
    expect(html).toContain('rp-composer');
    const send = html.match(/<button[^>]*data-send[^>]*>/)![0];
    expect(send).toContain('disabled');
    expect(send).toContain('var(--line-strong)'); // empty input: grey, disabled
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
  const items = slashItems('/', skills.slice(0, 3), t); // 3 skills + /side
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
