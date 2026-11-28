// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedLang } from '../components/i18n';
import { skillRunLabel } from '../components/Chat';
import { PdfPanel } from '../components/pdf/PdfPanel';
import { PdfChat } from '../components/pdf/PdfChat';
import { messages } from '../lib/i18n';
import { PDF_CONTEXT } from '../lib/pdf-contract';

function noListeners() { return { addListener: vi.fn(), removeListener: vi.fn() }; }

describe('skillRunLabel', () => {
  it('joins a skill name and the user text with language-appropriate punctuation', () => {
    const skill = { icon: '📌', name: 'Key points' };
    expect(skillRunLabel(skill, 'hello', messages('en').skillLabelSep)).toBe('📌 Key points: hello');
    expect(skillRunLabel(skill, 'hello', messages('zh-CN').skillLabelSep)).toBe('📌 Key points：hello');
    expect(skillRunLabel(skill, '  ', messages('en').skillLabelSep)).toBe('📌 Key points');
  });
});

describe('PDF and options titles plus PDF empty copy', () => {
  let root: Root, host: HTMLElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    document.body.innerHTML = '<div id="root"></div>';
    host = document.getElementById('root')!;
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn(async (msg) => (msg.type === PDF_CONTEXT ? { kind: 'none' } : { ok: false })), connect: vi.fn(), getURL: (p: string) => p, openOptionsPage: vi.fn(), onMessage: noListeners() },
      tabs: { onActivated: noListeners(), onUpdated: noListeners() },
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: noListeners() },
    });
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

  it('sets the PDF panel document title and empty-state copy from the catalog', async () => {
    await act(async () => root.render(<FixedLang lang="zh-CN"><PdfPanel /></FixedLang>));
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(document.title).toBe(messages('zh-CN').pdfDocumentTitle);
    expect(host.textContent).toContain(messages('zh-CN').pdfOpenHint);
    expect(host.textContent).toContain(messages('zh-CN').pdfStaysInTab);
    expect(host.textContent).toContain(messages('zh-CN').settingsShort);
    expect(host.textContent).not.toContain(messages('en').pdfOpenHint);
  });

  it('renders PDF chat chrome in the UI language', async () => {
    await act(async () => root.render(<FixedLang lang="zh-CN"><PdfChat url="pdf:v1:https://files.example.org/doc" validate={async () => {}} /></FixedLang>));
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(messages('zh-CN').pdfChatLabel);
    expect(host.textContent).toContain(messages('zh-CN').pdfChatEmpty);
    expect(host.textContent).toContain(messages('zh-CN').send);
    expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe(messages('zh-CN').pdfChatInput);
  });

  it('keeps English PDF empty copy when the UI language is en', async () => {
    await act(async () => root.render(<FixedLang lang="en"><PdfPanel /></FixedLang>));
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    expect(document.title).toBe(messages('en').pdfDocumentTitle);
    expect(host.textContent).toContain(messages('en').pdfOpenHint);
    expect(host.querySelector('h1')?.textContent).toContain('Representer');
    expect(host.querySelector('h1')?.textContent).toContain(messages('en').pdfHeaderSuffix.replace(/^\s+/, ''));
  });
});
