import type { Lang } from './i18n';
import { mockText } from './mock-text';
import { applyMarks } from './parse';
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

/** `[pN]` ids of the content's blocks, each with the id of the heading it sits under (and the block's text). */
function blockIds(content: string): { id: string; heading: string; text: string }[] {
  const out: { id: string; heading: string; text: string }[] = []; let heading = '';
  for (const line of content.split(/\n+/)) {
    const m = line.match(/\[(p\d+)\]\s*(.*)$/);
    if (!m) continue;
    if (/^\s*#{1,6}\s/.test(line)) heading = m[1]!;
    else if (m[2]!.length >= 40) out.push({ id: m[1]!, heading, text: m[2]! });
  }
  return out;
}

export function buildMockSummary(title: string, lang: Lang = 'zh-CN', content = ''): Summary {
  const m = mockText(lang);
  const icons = ['target', 'lightbulb', 'check'] as const;
  // Spread the bullets' anchors over the page so jumping to the page can be previewed in mock mode.
  const ids = blockIds(content);
  const n = m.mockSections.reduce((a, [, b]) => a + b.length, 0);
  const pick = (k: number) => ids[Math.min(ids.length - 1, Math.floor((k * ids.length) / n))]!;
  let k = 0;
  // a sample quote: the start of a plain-text block (markdown syntax would fail the check against the block)
  const q = ids.find((b) => /^[^*_`\[\]<>#|]{40,}$/.test(b.text.slice(0, 120)));
  const summary: Summary = {
    overview: m.mockOverview(title.trim() || m.mockPage),
    sections: m.mockSections.map(([title, bullets], i) => {
      const sec: Summary['sections'][number] = { title, icon: icons[i]!, bullets: [...bullets] };
      if (ids.length) {
        const first = pick(k);
        sec.anchor = first.heading || first.id;
        sec.anchors = bullets.map(() => pick(k++).id);
      }
      return sec;
    }),
  };
  if (q) summary.quote = { text: q.text.slice(0, 120).trim(), anchor: q.id };
  return applyMarks(summary);
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
