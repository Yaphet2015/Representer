import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { copyText, legacyCopy } from '../lib/clipboard';
import { messageMarkdown, overviewMarkdown, withoutBlockIds } from '../lib/copy';
import { CopyButton } from '../components/CopyButton';
import type { Summary } from '../lib/types';

const summary: Summary = {
  overview: 'PHP runs ==70% of the world’s websites== and [[Wiz]] found\ntwo bugs. See ==unclosed and [[open',
  sections: [
    { title: 'What ==it== is', icon: 'list', bullets: ['Used by [[WordPress]] [p12] and others.', 'Run [[/setup-pstack]] first\nthen go.'] },
    { title: 'Empty section', icon: 'list', bullets: [] },
    { title: '', icon: 'list', bullets: [] },
  ],
  quote: { text: 'The bugs weren’t new.', anchor: 'p4' },
};

describe('overviewMarkdown', () => {
  const md = overviewMarkdown(summary, { pageTitle: 'PHP [[intro]]', excerptTitle: 'From the page', excerptFrom: 'PHP intro · example.com' });
  it('keeps the Markdown structure', () => {
    expect(md).toBe([
      '# PHP intro',
      'PHP runs 70% of the world’s websites and Wiz found two bugs. See unclosed and open',
      '## What it is\n- Used by WordPress and others.\n- Run /setup-pstack first then go.',
      '## Empty section',
      '## From the page\n\n> “The bugs weren’t new.”\n>\n> — PHP intro · example.com',
    ].join('\n\n'));
  });
  it('has no highlight marks and no block ids', () => {
    expect(md).not.toMatch(/==|\[\[|\]\]|\[p\d+\]/);
  });
  it('omits the excerpt section when there is no quote and the title when there is none', () => {
    const m = overviewMarkdown({ ...summary, quote: undefined });
    expect(m).not.toContain('>'); expect(m).not.toContain('From the page'); expect(m.startsWith('PHP runs')).toBe(true);
  });
  it('quote without a source still copies as a quote; empty summaries copy as empty text', () => {
    expect(overviewMarkdown({ overview: 'x', sections: [], quote: { text: 'Hello there world', anchor: 'p1' } })).toBe('x\n\n> “Hello there world”');
    expect(overviewMarkdown({ overview: '', sections: [] })).toBe('');
  });
  it('copies the excerpt without one-sided quotation marks', () => {
    const m = overviewMarkdown({ overview: 'x', sections: [], quote: { text: '"The underlying bugs weren\'t new; what changed was our ability to find them," Kanhere said.', anchor: 'p1' } }, { excerptFrom: 'Site' });
    expect(m).toBe('x\n\n> “The underlying bugs weren\'t new; what changed was our ability to find them”\n>\n> — Site');
  });
  it('old summaries (no marks, legacy keyTerms) copy as plain text', () => {
    expect(overviewMarkdown({ overview: 'React uses a virtual DOM.', keyTerms: ['virtual DOM'], sections: [{ title: 'A', icon: 'list', bullets: ['b'] }] })).toBe('React uses a virtual DOM.\n\n## A\n- b');
  });
});

describe('messageMarkdown', () => {
  it('keeps the Markdown source as written and only drops internal block ids', () => {
    const src = '## Title\n\n- **bold** and `code`\n- see [p3] here\n\n```js\nconst a = [1, 2];\n```';
    expect(messageMarkdown(src)).toBe('## Title\n\n- **bold** and `code`\n- see here\n\n```js\nconst a = [1, 2];\n```');
    expect(withoutBlockIds('a [p1]b \\[p2\\] c')).toBe('a b c');
    expect(withoutBlockIds('- first [p3]\n- second [p4] \n\nthird [p5]')).toBe('- first\n- second\n\nthird');
  });
});

describe('copyText', () => {
  it('uses the async clipboard when it works', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('hi')).toBe(true); expect(writeText).toHaveBeenCalledWith('hi');
  });
  it('falls back to execCommand when the async clipboard is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowed')) } });
    const ta = { value: '', style: {} as any, setAttribute() {}, focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
    const appended: any[] = [];
    const doc: any = { body: { appendChild: (e: any) => appended.push(e) }, activeElement: null, createElement: () => ta, execCommand: vi.fn().mockReturnValue(true) };
    expect(await copyText('fallback text', doc)).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(ta.value).toBe('fallback text'); expect(ta.remove).toHaveBeenCalled(); expect(appended).toEqual([ta]);
  });
  it('reports failure when both paths fail', async () => {
    vi.stubGlobal('navigator', {});
    const ta = { style: {} as any, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {} };
    const doc: any = { body: { appendChild() {} }, createElement: () => ta, execCommand: () => { throw new Error('x'); } };
    expect(await copyText('x', doc)).toBe(false);
    expect(legacyCopy('x', { ...doc, execCommand: () => false })).toBe(false);
  });
});

describe('CopyButton', () => {
  it('renders no bubble in its idle state and the success state has none either (only failures are shown)', () => {
    const src = readFileSync(new URL('../components/CopyButton.tsx', import.meta.url), 'utf8');
    expect(src).toContain("state === 'failed' && (");
    expect(src).not.toMatch(/state !== 'idle' && \(\s*<span aria-hidden/);
    expect(src).toContain('role="status"'); // the screen-reader announcement stays
    expect(renderToStaticMarkup(<CopyButton label="Copy" getText={() => 'x'} />)).not.toContain('aria-hidden="true" class="pointer-events-none');
  });
  it('is a labelled button; reveal hides it until hover/focus but never on touch or keyboard focus', () => {
    const h = renderToStaticMarkup(<CopyButton reveal label="Copy message" getText={() => 'x'} />);
    expect(h).toMatch(/<button[^>]*aria-label="(复制消息|Copy message)"/);
    expect(h).toContain('group-hover:opacity-100'); expect(h).toContain('group-focus-within:opacity-100'); expect(h).toContain('[@media(hover:none)]:opacity-100');
    expect(renderToStaticMarkup(<CopyButton label="Copy" getText={() => 'x'} />)).not.toContain('opacity-0');
  });
});
