import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages, resolveLang } from '../lib/i18n';
import { stripMarks } from '../lib/highlight';
import { buildMockSummary, mockReplyText } from '../lib/mock';
import { summaryInstructions } from '../lib/prompts';
import { forkSession, initialState, sessionLabel } from '../lib/sessions';
import { DEFAULT_SKILLS, DEFAULT_SKILLS_EN, localizeSkill, validateSkill } from '../lib/skills';
import { formatVisualInspectReport, VISION_UNSUPPORTED, VISION_TOOLS_UNSUPPORTED } from '../lib/pdf-visual';
import { pdfTextDocument, readPdfBytes, PDF_MAX_PAGES } from '../lib/pdf-text';

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
    expect(sessionLabel({ id: 'chat-a', name: '对话 1' }, 'en')).toBe('Chat 1');
    expect(sessionLabel({ id: 'chat-a', name: '对话 1' }, 'zh-CN')).toBe('对话 1');
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

describe('PDF panel, errors, titles and skill labels', () => {
  it('localizes PDF UI, document titles, toolbar/errors and skill-label punctuation', () => {
    const zh = messages('zh-CN'), en = messages('en');
    expect(en.pdfSourceLabel).toBe('View PDF source page in sidebar');
    expect(zh.pdfSourceLabel).toMatch(/[\u4e00-\u9fff]/);
    expect(zh.pdfSourceLabel).not.toBe(en.pdfSourceLabel);
    expect(en.pdfChatEmpty).toMatch(/Ask about the PDF/);
    expect(zh.pdfChatEmpty).toMatch(/[\u4e00-\u9fff]/);
    expect(en.settingsTitle).toBe('Representer Settings');
    expect(zh.settingsTitle).toBe('Representer 设置');
    expect(en.pdfDocumentTitle).toBe('Representer · PDF');
    expect(zh.pdfDocumentTitle).toBe('Representer · PDF');
    expect(en.skillLabelSep).toBe(': ');
    expect(zh.skillLabelSep).toBe('：');
    expect(en.pdfToolbarTitle('x')).toBe('Representer: x');
    expect(zh.pdfToolbarTitle('x')).toBe('Representer: x');
    expect(en.pdfEntryDocumentLoading).toMatch(/still loading/);
    expect(zh.pdfEntryDocumentLoading).toMatch(/[\u4e00-\u9fff]/);
    expect(en.pdfPasswordProtected).toMatch(/Password-protected/);
    expect(zh.pdfPasswordProtected).toMatch(/[\u4e00-\u9fff]/);
    expect(en.visionUnsupported).toBe(VISION_UNSUPPORTED);
    expect(en.visionToolsUnsupported).toBe(VISION_TOOLS_UNSUPPORTED);
    expect(zh.visionUnsupported).toMatch(/[\u4e00-\u9fff]/);
    expect(zh.visionToolsUnsupported).toMatch(/[\u4e00-\u9fff]/);
    expect(zh.visionUnsupported).not.toBe(en.visionUnsupported);
  });

  it('keeps interpolation consistent for PDF errors and inspect reports', () => {
    const zh = messages('zh-CN'), en = messages('en');
    expect(en.pdfTooManyPages(400, 300)).toContain('400');
    expect(en.pdfTooManyPages(400, 300)).toContain('300');
    expect(zh.pdfTooManyPages(400, 300)).toContain('400');
    expect(en.pdfHttpError(403)).toContain('HTTP 403');
    expect(zh.pdfHttpError(403)).toContain('HTTP 403');
    expect(en.pdfReadingParts(2, 5)).toBe('Reading parts 2/5');
    expect(zh.pdfReadingParts(2, 5)).toContain('2/5');
    const partial = { inspected: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], total: 59, budget: 10, remaining: 49 };
    expect(formatVisualInspectReport(partial, 'en')).toContain('10 of 59');
    expect(formatVisualInspectReport(partial, 'en')).toContain('not renewable mid-run');
    expect(formatVisualInspectReport(partial, 'zh-CN')).toMatch(/[\u4e00-\u9fff]/);
    expect(formatVisualInspectReport(partial, 'zh-CN')).toContain('59');
    expect(formatVisualInspectReport({ inspected: [], total: 4, budget: 10, remaining: 4 }, 'zh-CN')).toMatch(/[\u4e00-\u9fff]/);
    expect(formatVisualInspectReport({ inspected: [1, 2], total: 2, budget: 10, remaining: 0 }, 'en')).toContain('All 2 pages');
  });

  it('throws PDF read errors in the requested language', async () => {
    expect(() => pdfTextDocument([], 1, 'x', [], 'en')).toThrow(messages('en').pdfPageLimit(PDF_MAX_PAGES));
    expect(() => pdfTextDocument([], 1, 'x', [], 'zh-CN')).toThrow(messages('zh-CN').pdfPageLimit(PDF_MAX_PAGES));
    const ac = new AbortController();
    await expect(readPdfBytes(new Response('blocked', { status: 403 }), ac.signal, 'en')).rejects.toThrow(messages('en').pdfHttpError(403));
    await expect(readPdfBytes(new Response('blocked', { status: 403 }), ac.signal, 'zh-CN')).rejects.toThrow(messages('zh-CN').pdfHttpError(403));
    await expect(readPdfBytes(new Response('HTML', { headers: { 'Content-Type': 'text/html' } }), ac.signal, 'zh-CN')).rejects.toThrow(messages('zh-CN').pdfNotPdf);
  });

  it('wires document titles to the catalog instead of hardcoded HTML', () => {
    expect(readFileSync('entrypoints/options/main.tsx', 'utf8')).toContain('document.title = t.settingsTitle');
    expect(readFileSync('components/pdf/PdfPanel.tsx', 'utf8')).toContain('document.title = t.pdfDocumentTitle');
    expect(readFileSync('entrypoints/options/index.html', 'utf8')).not.toContain('Representer Settings');
    expect(readFileSync('entrypoints/pdf-panel/index.html', 'utf8')).not.toContain('Representer · PDF');
    expect(readFileSync('components/Chat.tsx', 'utf8')).toContain('skillRunLabel(s, rawInput, t.skillLabelSep)');
    expect(readFileSync('components/Chat.tsx', 'utf8')).not.toContain("'：' + rawInput");
  });

});
