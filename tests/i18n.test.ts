import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages, resolveLang } from '../lib/i18n';
import { stripMarks } from '../lib/highlight';
import { buildMockSummary, mockReplyText } from '../lib/mock';
import { summaryInstructions } from '../lib/prompts';
import { forkSession, initialState, sessionLabel } from '../lib/sessions';
import { DEFAULT_SKILLS, DEFAULT_SKILLS_EN, localizeSkill, validateSkill } from '../lib/skills';

describe('resolveLang', () => {
  it('maps zh* to zh-CN and everything else to en; explicit preference wins', () => {
    expect(resolveLang('auto', 'zh-CN')).toBe('zh-CN');
    expect(resolveLang('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveLang(undefined, 'zh')).toBe('zh-CN');
    expect(resolveLang('auto', 'en-US')).toBe('en');
    expect(resolveLang('auto', 'ja')).toBe('en');
    expect(resolveLang('auto', '')).toBe('en');
    expect(resolveLang('en', 'zh-CN')).toBe('en');
    expect(resolveLang('zh-CN', 'en-US')).toBe('zh-CN');
  });
});

describe('messages', () => {
  it('en and zh-CN define the same keys, and en has no Chinese characters', () => {
    const zh = messages('zh-CN'), en = messages('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    const flat = (v: unknown): string => typeof v === 'function' ? String((v as any)('X', 'Y')) : typeof v === 'object' ? JSON.stringify(v) : String(v);
    for (const [k, v] of Object.entries(en)) expect(flat(v), k).not.toMatch(/[\u4e00-\u9fff]/);
  });
  it('interpolates parameters', () => {
    expect(messages('en').modelsCount(3)).toBe('3 models. Search, or type a custom model name');
    expect(messages('zh-CN').testOk(12, 'pong')).toContain('12 ms');
  });
});

describe('localized content', () => {
  it('mock summary and reply follow the language, the overview carries marks', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      const s = buildMockSummary('Page', lang);
      expect(stripMarks(s.overview)).not.toMatch(/==|\[\[|\]\]/);
      expect(s.overview).toMatch(/==.+==/);
    }
    expect(buildMockSummary('Page', 'en').overview).toMatch(/^This is a sample summary/);
    expect(messages('zh-CN').askTerm('X')).toBe('「X」是什么？它在这页里是怎么用的？');
    expect(messages('en').askTerm('X')).toBe('What is “X”, and how is it used on this page?');
    expect(mockReplyText('hi', 'en')).toMatch(/^\(Sample reply\)/);
  });
  it('summary prompt asks for the UI language', () => {
    expect(summaryInstructions('en')).toContain('English');
    expect(summaryInstructions('zh-CN')).toContain('Simplified Chinese');
  });
  it('built-in Skills are shown in the UI language unless edited', () => {
    const zhBuiltin = DEFAULT_SKILLS[0]!;
    expect(localizeSkill(zhBuiltin, 'en').name).toBe(DEFAULT_SKILLS_EN[0]!.name);
    expect(localizeSkill(DEFAULT_SKILLS_EN[0]!, 'zh-CN').name).toBe(zhBuiltin.name);
    const edited = { ...zhBuiltin, name: '我的翻译' };
    expect(localizeSkill(edited, 'en')).toEqual(edited);
    const custom = { id: 'c', name: 'Mine', template: 'x' };
    expect(localizeSkill(custom, 'zh-CN')).toBe(custom);
    expect(DEFAULT_SKILLS_EN.map((s) => s.id)).toEqual(DEFAULT_SKILLS.map((s) => s.id));
  });
  it('validation errors are localized', () => {
    expect(validateSkill({ name: '', template: 'x' }, 'en')).toBe('Please enter a name');
    expect(validateSkill({ name: '', template: 'x' }, 'zh-CN')).toBe('请填写名称');
  });
  it('session names display in the UI language', () => {
    const st = forkSession(initialState(), 'main', 1, 's1').state;
    expect(st.sessions.map((s) => sessionLabel(s, 'en'))).toEqual(['Main', 'Side 1']);
    expect(st.sessions.map((s) => sessionLabel(s, 'zh-CN'))).toEqual(['主线', '支线 1']);
  });
});

describe('_locales', () => {
  it('provides the manifest name/description in en and zh_CN', () => {
    const en = JSON.parse(readFileSync('public/_locales/en/messages.json', 'utf8'));
    const zh = JSON.parse(readFileSync('public/_locales/zh_CN/messages.json', 'utf8'));
    expect(en.extName.message).toBe('Representer - AI Page Summary & Chat');
    expect(zh.extName.message).toBe('Representer - 网页 AI 总结与对话');
    for (const m of [en, zh]) expect(m.extDescription.message.length).toBeLessThanOrEqual(132);
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
});
