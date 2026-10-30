/**
 * Incremental reading of a JSON object the model is still writing. The summary keeps its JSON format (the final text is
 * parsed by parseSummary exactly as before, so the cached result is unchanged); while it streams, each prefix is closed
 * into valid JSON and read leniently, so the overview can render progressively.
 */
import { applyMarks } from './parse';
import { ICON_TYPES, type IconType, type Section, type Summary } from './types';

/**
 * Parse the longest valid reading of a JSON prefix: open strings are closed (a half-written value shows what is there
 * so far), open arrays/objects are closed, and a dangling key, colon, comma or half-written literal is cut back to the
 * last structural boundary. Leading prose or a ``` fence before the first `{` is skipped. undefined if nothing parses yet.
 */
export function parsePartialJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  const s = text.slice(start);
  const stack: string[] = [];
  /** cut points: [position, stack depth snapshot] where cutting leaves a well-formed prefix */
  const cuts: [number, string[]][] = [];
  let inStr = false, esc = false, end = s.length;
  /** a `\uXXXX` escape still being written: where it starts and how many hex digits are missing */
  let uStart = -1, hexLeft = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (hexLeft) hexLeft--;
      else if (esc) { esc = false; if (c === 'u') { uStart = i - 1; hexLeft = 4; } }
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); cuts.push([i + 1, [...stack]]); }
    else if (c === '}' || c === ']') {
      stack.pop(); cuts.push([i + 1, [...stack]]);
      if (!stack.length) { end = i + 1; break; } // the object is complete; ignore trailing prose / fence
    } else if (c === ',') cuts.push([i, [...stack]]);
  }
  const closeWith = (body: string, open: string[]) => body + [...open].reverse().join('');
  if (end < s.length || (!stack.length && !inStr)) {
    try { return JSON.parse(s.slice(0, end)); } catch { /* fall through */ }
  }
  // 1) as is, closing an open string (minus a half-written escape)
  if (inStr) {
    const body = hexLeft ? s.slice(0, uStart) : esc ? s.slice(0, end - 1) : s.slice(0, end);
    try { return JSON.parse(closeWith(body + '"', stack)); } catch { /* try shorter */ }
  } else {
    try { return JSON.parse(closeWith(s.slice(0, end).replace(/\s+$/, ''), stack)); } catch { /* try shorter */ }
  }
  // 2) back off to structural boundaries, longest first
  for (let k = cuts.length - 1; k >= 0; k--) {
    const [pos, open] = cuts[k]!;
    try { return JSON.parse(closeWith(s.slice(0, pos), open)); } catch { /* keep backing off */ }
  }
  return undefined;
}

/** Hide marks that are not closed yet (`==half a phrase`, `[[half`), and half-typed mark tokens at the very end. */
export function tidyPartialMarks(s: string): string {
  let out = /(?:==|\[\[|\]\])$/.test(s) ? s : s.replace(/[=[\]]$/, '');
  if (((out.match(/==/g) ?? []).length) % 2) { const i = out.lastIndexOf('=='); out = out.slice(0, i) + out.slice(i + 2); }
  const open = out.lastIndexOf('[['), close = out.lastIndexOf(']]');
  if (open > close) out = out.slice(0, open) + out.slice(open + 2);
  return out;
}

/**
 * What can be shown of a summary still streaming: the overview so far and every section that has a title, with the
 * bullets written so far. Anchors and the quote wait for the final, validated result. null until there is any text.
 */
export function partialSummary(text: string): Summary | null {
  const raw = parsePartialJson(text) as any;
  if (!raw || typeof raw !== 'object') return null;
  const overview = typeof raw.overview === 'string' ? tidyPartialMarks(raw.overview.trimStart()) : '';
  const sections: Section[] = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((x: any) => x && typeof x.title === 'string' && x.title.trim())
    .map((x: any) => ({
      title: x.title.trim(),
      icon: (ICON_TYPES.includes(x.icon) ? x.icon : 'list') as IconType,
      bullets: (Array.isArray(x.bullets) ? x.bullets : [])
        .map((b: any) => (typeof b === 'string' ? b : b && typeof b.text === 'string' ? b.text : ''))
        .map((b: string) => tidyPartialMarks(b.trimStart()))
        .filter((b: string) => b.trim()),
    }));
  if (!overview && !sections.length) return null;
  return applyMarks({ overview, sections });
}

/**
 * Accumulates streamed deltas and re-reads the summary at most every `everyMs` (parsing a long prefix on every token
 * would be wasteful; a trailing timer picks up the rest). `emit` only fires when the readable summary changed.
 */
export function createPartialReader(emit: (s: Summary) => void, everyMs = 80) {
  let text = '', last = '', lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = () => {
    clearTimeout(timer); timer = undefined; lastAt = Date.now();
    const p = partialSummary(text);
    if (!p) return;
    const key = JSON.stringify(p);
    if (key !== last) { last = key; emit(p); }
  };
  return {
    push(delta: string) {
      text += delta;
      const wait = everyMs - (Date.now() - lastAt);
      if (wait <= 0) read(); else timer ??= setTimeout(read, wait);
    },
    /** start over (the model is retrying from scratch) */
    reset() { clearTimeout(timer); timer = undefined; text = ''; last = ''; },
    stop() { clearTimeout(timer); timer = undefined; },
    get text() { return text; },
  };
}
