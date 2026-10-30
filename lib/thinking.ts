/**
 * The model's reasoning, shown one sentence at a time in the summary's status row while nothing of the answer exists
 * yet. Reasoning is display-only: it never enters the answer, the cache or the chat history.
 */

/** sentence ends: CJK full stops and marks always; Latin . ! ? only before whitespace (so 3.5, e.g. and URLs stay whole); newlines */
const END = /[。！？；…]+[”」』）)]*|[.!?;]+["')\]]*(?=\s)|\n+/g;

/** plain text for the status row: no markdown emphasis, code ticks, highlight marks or list bullets */
const tidy = (s: string) => s.replace(/\*\*|__|`|==|\[\[|\]\]/g, '').replace(/^\s*(?:[-*•]|\d+[.)、]|#+)\s+/, '').replace(/\s+/g, ' ').trim();

/** The finished sentences of `text` (trimmed, non-empty); the unfinished tail is left out. */
export function sentences(text: string): string[] {
  const out: string[] = []; let from = 0;
  for (const m of text.matchAll(END)) {
    const end = m.index! + m[0].length;
    const s = tidy(text.slice(from, end));
    from = end;
    if ((s.match(/\p{L}/gu) ?? []).length >= 3) out.push(s); // not a bare list number or rule
  }
  return out;
}

/** CJK and other wide characters count as two columns */
const wide = (c: string) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c);
/**
 * One line of the status row. At the narrowest panel (320px) the row has room for about 34 columns next to the loader,
 * timer and cancel button (≈17 CJK characters, ≈34 Latin); longer text is cut there with "…" (CSS truncation backs it up).
 */
export const THOUGHT_COLS = 34;
export function clipLine(s: string, cols = THOUGHT_COLS): string {
  let w = 0, i = 0;
  const chars = [...s];
  for (; i < chars.length; i++) { w += wide(chars[i]!) ? 2 : 1; if (w > cols) break; }
  if (i >= chars.length) return s;
  // leave a column for the ellipsis; don't end on a space or dangling punctuation
  let cut = chars.slice(0, i); while (cut.length && (w = cut.reduce((a, c) => a + (wide(c) ? 2 : 1), 0)) > cols - 1) cut.pop();
  return cut.join('').replace(/[\s,，、;；:：]+$/, '') + '…';
}

/**
 * Turns streamed reasoning into a readable carousel: each newly finished sentence becomes the line, but a line stays at
 * least `minMs`; when sentences arrive faster the newest one wins (the ones in between are skipped).
 */
export function createThoughtTicker(show: (line: string) => void, minMs = 1200) {
  let text = '', count = 0, shownAt = -Infinity, current = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const latest = () => { const all = sentences(text); return all.length ? clipLine(all[all.length - 1]!) : ''; };
  const showLatest = () => {
    timer = undefined;
    const line = latest();
    if (!line || line === current) return;
    current = line; shownAt = Date.now(); show(line);
  };
  return {
    push(delta: string) {
      text += delta;
      const n = sentences(text).length;
      if (n === count) return;
      count = n;
      const wait = minMs - (Date.now() - shownAt);
      if (wait <= 0) showLatest(); else timer ??= setTimeout(showLatest, wait);
    },
    stop() { clearTimeout(timer); timer = undefined; },
  };
}
