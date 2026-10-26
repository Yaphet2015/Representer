import { blockTexts, MARKER_RE } from './locate';
import { anchorId, parseSummary } from './parse';
import type { Summary } from './types';

export interface Step { number: number; title: string; start: number; end: number }

/** Conservative block-start sequences. A gap invalidates the whole run, rather than its prefix. */
export function detectSteps(content: string): Step[] {
  const blocks = [...blockTexts(content)].map(([id, text]) => ({ id: Number(id.slice(1)), text }));
  const excluded = new Set<number>();
  let referenceLevel: number | undefined;
  let fenced = false;
  for (const line of content.split('\n')) {
    const clean = line.replace(MARKER_RE, '').trim();
    if (/^(```|~~~)/.test(clean)) fenced = !fenced;
    const heading = clean.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading && referenceLevel !== undefined && heading[1]!.length <= referenceLevel) referenceLevel = undefined;
    if (/^(?:#{1,6}\s+)?(?:references|bibliography|footnotes|table of contents|contents|目录|参考文献|脚注)\s*[:：]?$/i.test(clean)) referenceLevel = heading?.[1]?.length ?? 6;
    if (fenced || referenceLevel !== undefined) for (const m of line.matchAll(MARKER_RE)) excluded.add(Number(m[1]));
  }
  const candidates: (Step & { family: string })[] = [];
  for (const { id, text } of blocks) {
    if (excluded.has(id)) continue;
    const line = text.trim().split('\n')[0]!.replace(/^#{1,6}\s+/, '').replace(/^\*\*|\*\*$/g, '').trim();
    const match = line.match(/^(?:(Step|Phase|Part)\s+(\d+)\b|第\s*(\d+)\s*([步章])|步骤\s*(\d+)|([0-9]+)[.)、](?!\d)\s*)\s*[:：.、)\-–—]?\s*(.*)$/i);
    if (!match) continue;
    const title = match[7]!.replace(/\*\*/g, '').trim();
    // Link-only TOCs, footnote definitions and bibliography entries aren't procedure steps.
    if (!title || /^\[\^?\d+\]:/.test(line) || /https?:\/\/|doi:|\b(?:19|20)\d{2}\b/.test(title)
      || !title.replace(/!?\[[^\]]*\]\([^)]*\)|<[^>]*>|[\s\d.、:：()\-]/g, '')) continue;
    const number = Number(match[2] ?? match[3] ?? match[5] ?? match[6]);
    const family = match[1]?.toLowerCase() ?? (match[4] ? `第${match[4]}` : match[5] ? '步骤' : 'numeric');
    candidates.push({ number, title: line.replace(/\*\*/g, ''), start: id, end: 0, family });
  }
  const groups: typeof candidates[] = [];
  // Nested numeric lists must not split an outer Step/Phase sequence.
  for (const family of new Set(candidates.map((s) => s.family))) {
    let group: typeof candidates = [];
    for (const step of candidates.filter((s) => s.family === family)) {
      if (group.length && step.number <= group.at(-1)!.number) { groups.push(group); group = []; }
      group.push(step);
    }
    if (group.length) groups.push(group);
  }
  const best = groups.filter((g) => g.length >= 3 && g[0]!.number <= 1 && g.every((s, i) => !i || s.number === g[i - 1]!.number + 1))
    .sort((a, b) => b.length - a.length || a[0]!.start - b[0]!.start)[0];
  const end = Math.max(0, ...blocks.map((b) => b.id)) + 1;
  return best?.map((s, i) => ({ number: s.number, title: s.title, start: s.start, end: best[i + 1]?.start ?? end })) ?? [];
}

/** Only section/bullet anchors count; the overview and decorative excerpt do not. */
export function missingSteps(steps: Step[], summary: Summary): Step[] {
  if (steps.length < 3) return [];
  const anchors = summary.sections.flatMap((s) => [s.anchor, ...s.bullets.map((_, i) => s.anchors?.[i])])
    .map((a) => Number(anchorId(a).slice(1))).filter((n) => n > 0);
  return steps.filter((s) => !anchors.some((n) => n >= s.start && n < s.end));
}

/** The caller reuses its original instructions, input, transport and cancellation signal. */
export async function summarizeWithSteps(content: string, generate: (feedback?: string, signal?: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<Summary> {
  const first = parseSummary(await generate(undefined, signal), content);
  const steps = detectSteps(content);
  const missing = missingSteps(steps, first);
  if (!missing.length || signal?.aborted) return first;
  const retry = new AbortController();
  const cancel = () => retry.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 90_000);
  try {
    const feedback = `The page has ${steps.length} ordered steps. Your summary did not cover these steps: ${missing.map((s) => `${s.title} [p${s.start}]`).join('; ')}. Output the complete JSON again. Include a corresponding anchored bullet or section for EVERY step, in original order. Do not merge steps.`;
    // Also bound injected transports that fail to settle when their signal aborts.
    const text = await new Promise<string>((resolve, reject) => {
      retry.signal.addEventListener('abort', () => reject(new Error('Step retry cancelled or timed out')), { once: true });
      generate(feedback, retry.signal).then(resolve, reject);
    });
    const second = parseSummary(text, content);
    return missingSteps(steps, second).length <= missing.length ? second : first;
  } catch {
    // This quality check must never turn a usable first response into a failed summary.
    return first;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
