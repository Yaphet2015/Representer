import type { Lang } from './i18n';
import { mockText } from './mock-text';
import type { Settings, Summary } from './types';
import { isLocalUrl } from './url';

export const MOCK_DELAY_MS = 1200;

/** Mock mode is used when toggled on, or when no API key is set (local servers like Ollama excepted). */
export function useMock(s: Settings): boolean {
  if (s.mock) return true;
  return !s.apiKey && !isLocalUrl(s.baseUrl);
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
});

/** Plain-text paragraphs of the extracted Markdown, each with the heading it sits under. */
function paragraphs(md: string): { text: string; heading: string }[] {
  const out: { text: string; heading: string }[] = []; let heading = '';
  for (const block of md.split(/\n\s*\n/)) {
    const raw = block.trim();
    const h = raw.match(/^#{1,6}\s+(.+)$/m);
    if (h && raw.split('\n').length === 1) { heading = plain(h[1]!); continue; }
    const text = plain(raw);
    if (text.length >= 60 && !/^(\||```)/.test(raw)) out.push({ text, heading });
  }
  return out;
}
const plain = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(?:[-*+>]|\d+\.)\s+/gm, '').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
/** First ~10 words of a paragraph: a verbatim excerpt like the real model is asked to return. */
const excerpt = (p: string) => { const w = p.split(' '); return w.length > 3 ? w.slice(0, 10).join(' ') : p.slice(0, 30); };

export function buildMockSummary(title: string, lang: Lang = 'zh-CN', content = ''): Summary {
  const m = mockText(lang);
  const icons = ['target', 'lightbulb', 'check'] as const;
  // Spread the bullets over the page so "jump to source" can be previewed in mock mode.
  const paras = paragraphs(content);
  const n = m.mockSections.reduce((a, [, b]) => a + b.length, 0);
  const pick = (k: number) => paras.length ? paras[Math.min(paras.length - 1, Math.floor((k * paras.length) / n))]! : null;
  let k = 0;
  return {
    overview: m.mockOverview(title.trim() || m.mockPage),
    keyTerms: [...m.mockTerms],
    sections: m.mockSections.map(([title, bullets], i) => {
      const sec: Summary['sections'][number] = { title, icon: icons[i]!, bullets: [...bullets] };
      if (paras.length) {
        const first = pick(k)!;
        sec.quote = first.heading || excerpt(first.text);
        sec.quotes = bullets.map(() => excerpt(pick(k++)!.text));
      }
      return sec;
    }),
  };
}

export async function mockSummary(title: string, lang: Lang = 'zh-CN', signal?: AbortSignal, content = ''): Promise<Summary> {
  await sleep(MOCK_DELAY_MS, signal);
  return buildMockSummary(title, lang, content);
}

export function mockReplyText(question: string, lang: Lang = 'zh-CN'): string {
  return mockText(lang).mockReply(question.slice(0, 120));
}

/** Stream the mock reply token by token (~30ms each): words for Latin text, 1–2 chars for CJK. */
export async function mockStream(question: string, onDelta: (t: string) => void, signal?: AbortSignal, tokenMs = 30, lang: Lang = 'zh-CN'): Promise<string> {
  const text = mockReplyText(question, lang);
  for (const tok of text.match(/[\u3000-\u9fff\uff00-\uffef]{1,2}|[^\s\u3000-\u9fff\uff00-\uffef]+\s*|\s+/g) ?? []) { await sleep(tokenMs, signal); onDelta(tok); }
  return text;
}
