import { describe, expect, it } from 'vitest';
import { chatSystem, summaryInstructions, withUserPrompt } from '../lib/prompts';

const summary = { overview: 'o', keyTerms: [], sections: [] };
const longPage = 'English page text. '.repeat(3000);

describe('custom system prompt', () => {
  it('empty or blank custom text leaves the built-in prompt unchanged', () => {
    expect(summaryInstructions('en', '')).toBe(summaryInstructions('en'));
    expect(summaryInstructions('en', '   ')).toBe(summaryInstructions('en'));
    expect(chatSystem('T', summary, 'c', undefined)).toBe(chatSystem('T', summary, 'c'));
  });
  it('summary: keeps the JSON contract and lets the user override the reply language', () => {
    const p = summaryInstructions('en', '请用中文回答');
    expect(p).toContain('Reply with ONLY a JSON object');
    expect(p).toMatch(/unless the user's instructions ask for another language/);
    expect(p).toMatch(/Only the JSON format is mandatory/);
    expect(p.split('请用中文回答').length - 1).toBe(2);
    expect(p.trimEnd().endsWith('</user_instructions>')).toBe(true);
  });
  it('chat: user instructions come before the page content and again at the very end', () => {
    const p = chatSystem('T', summary, longPage, '  请用中文回答  ');
    const page = p.indexOf('<page_content>');
    expect(p.indexOf('请用中文回答')).toBeLessThan(page);
    expect(p.lastIndexOf('请用中文回答')).toBeGreaterThan(p.indexOf('</page_content>'));
    expect(p.trimEnd().endsWith('</user_instructions>')).toBe(true);
  });
  it('withUserPrompt wraps the text in tags after the note', () => {
    expect(withUserPrompt('A', 'B', 'N:')).toBe('A\n\nN:\n<user_instructions>\nB\n</user_instructions>');
  });
});

describe('summary contract', () => {
  it('asks for block ids on titles and bullets, and the quote is anchored to a block too', () => {
    const p = summaryInstructions('zh-CN');
    expect(p).toContain('"bullets": [{"text": string, "anchor": string}]');
    expect(p).toContain('"quote": {"text": string, "anchor": string} or null');
    expect(p).toMatch(/\[p12\]/);
  });
  it('describes the highlight rules and no longer asks for keyTerms', () => {
    const p = summaryInstructions('en');
    expect(p).not.toMatch(/keyTerms/);
    for (const needle of ['==like this==', '[[like this]]', 'Skim test', 'Deletion test', '[[/setup-pstack]]', 'bare number']) expect(p).toContain(needle);
  });
  it('chat sees the content and summary without block ids', () => {
    const s = { overview: 'o', keyTerms: [], sections: [{ title: 'T', icon: 'list' as const, bullets: ['b'], anchor: 'p1', anchors: ['p2'] }] };
    const p = chatSystem('T', s, '[p1] Hello\n\n[p2] World');
    expect(p).not.toMatch(/\[p\d+\]|"anchors?"/);
    expect(p).toContain('Hello\n\nWorld');
  });
  it('chat sees the summary without highlight marks or the old keyTerms', () => {
    const s = { overview: 'A ==key phrase== and [[Term]].', keyTerms: ['Term'], sections: [{ title: 'T', icon: 'list' as const, bullets: ['use [[/setup-pstack]] now'] }], quote: { text: 'q', anchor: 'p1' } };
    const p = chatSystem('T', s, 'content');
    expect(p).toContain('A key phrase and Term.'); expect(p).toContain('use /setup-pstack now');
    expect(p).not.toMatch(/==|\[\[|\]\]|keyTerms/);
  });
});
