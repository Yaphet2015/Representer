/**
 * The overview as a small agent loop on pi-durable: instead of one long JSON reply (which a reasoning model could
 * run out of budget in, leaving cut-off JSON), the model submits the summary piece by piece through tools.
 * Each tool checks its input against the page and answers with the exact problem, so the model repairs it
 * itself; the summary built from the accepted pieces has the same shape (and cache format) as before.
 */
import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { AbortError } from './abort';
import { MAX_PAGE_CHARS } from './attachment';
import { isMaxTokensError, isToolsUnsupportedError, MAX_OUTPUT_CEILING, maxOutputFor, SAFE_MAX_OUTPUT } from './budget';
import { blockTexts, MARKER_RE } from './locate';
import { anchorId, normalizeSummary, parseSummary, validateQuote } from './parse';
import { readTools } from './page-tools';
import { partialFromObject } from './partial-json';
import { MAX_CONTENT_CHARS } from './prompts';
import { detectSteps, missingSteps } from './steps';
import { ICON_TYPES, type Summary } from './types';

/** `read`/`total`: a long page's chunks read so far, before the overview is written (lib/chunked-overview.ts) */
export type OverviewStatus = 'reading' | 'repairing' | { read: number; total: number } | null;
export interface RawBullet { text: string; anchor: string }
export interface RawSection { title: string; anchor: string; icon: string; bullets: RawBullet[] }
export type ToolResult = { ok: true; message: string } | { ok: false; error: string };

/** the prompt asks for 3-6 sections; a model that writes a few more is not worth a repair round (the JSON path took any number) */
export const MAX_SECTIONS = 10, MAX_BULLETS = 6;
const snippet = (s: string, at: number) => `"…${s.slice(Math.max(0, at - 30), at + 30)}…"`;

/**
 * Highlight markers must be well-formed: `==…==` and `[[…]]` closed, never nested or crossed.
 * Returns the problem (with where it is) or null. A spaced ` == ` (as in `a == b`) is plain text.
 */
export function checkMarks(s: string): string | null {
  let strong = -1, term = -1;
  for (let i = 0; i < s.length - 1; i++) {
    const two = s.slice(i, i + 2);
    if (two === '==') {
      if (/\s/.test(s[i - 1] ?? ' ') && /\s/.test(s[i + 2] ?? ' ')) { i++; continue; } // a == b
      if (term >= 0) return `a key phrase "==" starts inside the term "[[" at ${snippet(s, i)}; marks must not nest`;
      strong = strong >= 0 ? -1 : i; i++;
    } else if (two === '[[') {
      if (term >= 0) return `"[[" opens again before the previous "[[" is closed at ${snippet(s, i)}`;
      if (strong >= 0) return `a term "[[" starts inside the key phrase "==" at ${snippet(s, i)}; marks must not nest`;
      term = i; i++;
    } else if (two === ']]') {
      if (term < 0) return `"]]" has no opening "[[" at ${snippet(s, i)}`;
      term = -1; i++;
    }
  }
  if (strong >= 0) return `the key phrase "==" is never closed at ${snippet(s, strong)}`;
  if (term >= 0) return `the term "[[" is never closed at ${snippet(s, term)}`;
  return null;
}

/** The summary being built by the tools; every change is checked against the page first. */
export function createOverviewDraft(content: string) {
  const blocks = blockTexts(content);
  const ids = [...blocks.keys()];
  const range = ids.length ? `${ids[0]}-${ids.at(-1)}` : '';
  const steps = detectSteps(content);
  let overview = '';
  const sections: RawSection[] = [];
  let quote: { text: string; anchor: string } | null = null;
  let finished = false, stepsChecked = false, quoteMisses = 0, rejectedChecked = false;
  /** sections submit_summary rejected: finish reminds once if they were never re-added */
  let rejected: string[] = [];

  const err = (error: string): ToolResult => ({ ok: false, error });
  /** "" is allowed (nothing to point at); anything else must be a block of this page */
  /** "p12", and also a range or list ("p12-p14", "p12, p13"): the first id is the one that counts */
  const idOf = (v: unknown) => anchorId(v) || anchorId(String(v ?? '').match(/\[?p?\d+\]?/i)?.[0]);
  const badAnchor = (v: unknown, what: string): string | null => {
    if (v === undefined || v === null || String(v).trim() === '' || !blocks.size) return null;
    const id = idOf(v);
    return id && blocks.has(id) ? null : `${what} anchor "${String(v)}" is not a block id of this page (valid: ${range}, or "")`;
  };
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const raw = () => ({ overview, sections, quote });
  /** what to do next, so the model neither stops early nor keeps polishing */
  const next = () => sections.length >= MAX_SECTIONS ? 'That is the maximum: now set_quote (optional), then finish.'
    : sections.length >= 3 ? `Add the next section only if the page has another distinct part (${MAX_SECTIONS} at most); otherwise set_quote (optional), then finish.`
    : 'Add the next section.';

  return {
    get finished() { return finished; },
    get sectionCount() { return sections.length; },
    get hasOverview() { return !!overview; },
    titles: () => sections.map((s) => s.title),

    submitOverview(args: { text?: unknown }): ToolResult {
      const t = text(args?.text);
      if (!t) return err('"text" is empty; send the 3-5 sentence overview');
      const bad = checkMarks(t);
      if (bad) return err(`overview: ${bad}. Fix the marks and call submit_overview again`);
      overview = t;
      return { ok: true, message: `Overview saved.${sections.length ? '' : ' Now add the sections in page order with add_section.'}` };
    },

    addSection(args: { title?: unknown; anchor?: unknown; icon?: unknown; bullets?: unknown }): ToolResult {
      const title = text(args?.title).replace(/==|\[\[|\]\]/g, '');
      if (!title) return err('"title" is empty');
      const icon = text(args?.icon) || 'list';
      if (!ICON_TYPES.includes(icon as any)) return err(`"icon" must be one of ${JSON.stringify(ICON_TYPES)}, not "${icon}"`);
      const a = badAnchor(args?.anchor, 'section');
      if (a) return err(a);
      if (!Array.isArray(args?.bullets) || !args.bullets.length) return err('"bullets" must be a non-empty array of {text, anchor}');
      if (args.bullets.length > MAX_BULLETS) return err(`${args.bullets.length} bullets is too many; keep 2-5`);
      const bullets: RawBullet[] = [];
      for (const [i, b] of (args.bullets as unknown[]).entries()) {
        const bt = text(typeof b === 'string' ? b : (b as any)?.text);
        if (!bt) return err(`bullet ${i + 1} has no "text"`);
        const ba = badAnchor((b as any)?.anchor, `bullet ${i + 1}`);
        if (ba) return err(ba);
        const bad = checkMarks(bt);
        if (bad) return err(`bullet ${i + 1}: ${bad}`);
        bullets.push({ text: bt, anchor: idOf((b as any)?.anchor) });
      }
      const sec: RawSection = { title, anchor: idOf(args?.anchor), icon, bullets };
      const same = sections.findIndex((s) => s.title === title);
      if (same >= 0) { sections[same] = sec; return { ok: true, message: `Section "${title}" replaced. ${next()}` }; }
      if (sections.length >= MAX_SECTIONS) return err(`there are already ${MAX_SECTIONS} sections, the most allowed. Do not add more: call set_quote (optional) and then finish`);
      sections.push(sec);
      return { ok: true, message: `Section ${sections.length} "${title}" saved. ${next()}` };
    },

    setQuote(args: { text?: unknown; anchor?: unknown }): ToolResult {
      const t = text(args?.text);
      if (!t) { quote = null; return { ok: true, message: 'No quote. Now call finish.' }; }
      const a = badAnchor(args?.anchor, 'quote');
      if (a) return err(a);
      if (!idOf(args?.anchor)) return err('the quote needs the "anchor" of the block it is copied from');
      let q = { text: t, anchor: idOf(args?.anchor) };
      // models often name the heading just before the quoted paragraph: look a few blocks on before calling it wrong
      if (!validateQuote(q, content)) {
        const at = ids.indexOf(q.anchor);
        const near = ids.slice(at + 1, at + 4).find((id) => validateQuote({ text: t, anchor: id }, content));
        if (near) q = { text: t, anchor: near };
      }
      if (!validateQuote(q, content)) {
        // one repair round for the optional quote; a second miss just leaves it out
        if (quoteMisses++) { quote = null; return { ok: true, message: 'Quote left out (not found on the page). Call finish.' }; }
        return err(`the quote is not found word for word in block ${q.anchor}, or is not 8-200 characters. Copy it exactly from that block (keep its language), or skip the quote`);
      }
      quote = q;
      return { ok: true, message: 'Quote saved. Now call finish.' };
    },

    /** the whole summary in one call: whatever is valid is kept, the rest comes back as errors to fix with the small tools */
    submitSummary(args: { overview?: unknown; sections?: unknown; quote?: unknown }): ToolResult {
      const errors: string[] = [];
      const o = this.submitOverview({ text: args?.overview });
      if (!o.ok) errors.push(o.error);
      sections.length = 0; rejected = [];
      const list = Array.isArray(args?.sections) ? args.sections as any[] : [];
      if (!list.length) errors.push('"sections" is empty; send 3-6 sections');
      list.forEach((x, i) => {
        const r = this.addSection(x ?? {});
        if (!r.ok) rejected.push(typeof x?.title === 'string' && x.title.trim() ? x.title.trim() : `section ${i + 1}`);
        if (!r.ok) errors.push(`section ${i + 1}${typeof x?.title === 'string' ? ` "${x.title}"` : ''}: ${r.error}`);
      });
      const qa = args?.quote as any;
      let note = '';
      quote = null;
      if (qa && typeof qa === 'object' && typeof qa.text === 'string' && qa.text.trim()) {
        // the quote is optional: when everything else is fine, a quote that is not on the page is dropped, not repaired
        const r = this.setQuote(qa);
        if (!r.ok) { note = ' (the quote was not found on the page and is left out)'; }
      }
      if (errors.length) return err(`saved what was valid (${overview ? 'the overview, ' : ''}${sections.length} section(s)); fix these and nothing else:\n- ${errors.join('\n- ')}\nUse submit_overview / add_section (the same title replaces a section) / set_quote, then call finish.`);
      const f = this.finish();
      return f.ok ? { ok: true, message: `Done${note}. Stop now; do not write anything else.` } : err(`${f.error.replace(/call finish again$/, 'then call finish')}`);
    },

    finish(): ToolResult {
      if (!overview) return err('there is no overview yet; call submit_overview first');
      if (!sections.length) return err('there are no sections yet; add 3-6 with add_section');
      const missingSecs = rejected.filter((t) => !sections.some((x) => x.title === t));
      if (missingSecs.length && !rejectedChecked) {
        rejectedChecked = true;
        return err(`these rejected sections were not added again: ${missingSecs.map((t) => `"${t}"`).join(', ')}. Fix and add them with add_section, or call finish again to leave them out`);
      }
      if (!stepsChecked && steps.length) {
        stepsChecked = true; // one reminder; a second finish is accepted as it is
        const missing = missingSteps(steps, normalizeSummary(raw(), content));
        if (missing.length) return err(`the page has ${steps.length} ordered steps; these are not covered: ${missing.map((s) => `${s.title} [p${s.start}]`).join('; ')}. Add an anchored bullet or section for each (add_section with an existing title replaces it), in order, then call finish again`);
      }
      finished = true;
      return { ok: true, message: 'Done. Stop now; do not write anything else.' };
    },

    /** the Summary so far (exactly what parseSummary would make of the same JSON), or null without an overview */
    summary(): Summary | null {
      if (!overview) return null;
      return normalizeSummary(raw(), content);
    },
    /** the same pieces as the JSON a single-call model would have written */
    json: () => JSON.stringify(raw()),
  };
}
export type OverviewDraft = ReturnType<typeof createOverviewDraft>;

const out = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });

/** The tools over a draft (plus read_page / search_page for pages too long to embed). */
export function overviewTools(draft: OverviewDraft, page: string, withRead: boolean, hooks: { onResult?(name: string, r: ToolResult): void; onRead?(): void } = {}) {
  const wrap = (name: string, f: () => ToolResult) => {
    const r = f();
    hooks.onResult?.(name, r);
    return out(r.ok ? r.message : `Error: ${r.error}`);
  };
  const bullet = Type.Object({ text: Type.String(), anchor: Type.String({ description: 'Block id the point is based on, e.g. "p12", or ""' }) });
  return defineExtension({
    name: 'overview',
    tools: [
      ...(withRead ? readTools(page).map((t: any) => ({ ...t, execute: async (args: any) => { hooks.onRead?.(); return t.execute(args); } })) : []),
      defineTool({
        name: 'submit_summary', description: 'Submit the whole summary at once. Pieces that fail the checks come back as errors; fix them with the other tools.',
        parameters: Type.Object({
          overview: Type.String({ description: '3-5 sentences with inline highlights' }),
          sections: Type.Array(Type.Object({
            title: Type.String(), anchor: Type.String({ description: 'Block id the section starts at, e.g. "p12", or ""' }),
            icon: Type.String({ description: `One of ${ICON_TYPES.join(', ')}` }), bullets: Type.Array(bullet),
          })),
          quote: Type.Optional(Type.Union([Type.Object({ text: Type.String(), anchor: Type.String() }), Type.Null()])),
        }), replay: 'safe',
        execute: async (args) => wrap('submit_summary', () => draft.submitSummary(args)),
      }),
      defineTool({
        name: 'submit_overview', description: 'Save (or replace) the overview paragraph, 3-5 sentences with inline highlights.',
        parameters: Type.Object({ text: Type.String() }), replay: 'safe',
        execute: async (args) => wrap('submit_overview', () => draft.submitOverview(args)),
      }),
      defineTool({
        name: 'add_section', description: 'Add one section (or replace the one with the same title). Sections go in page order.',
        parameters: Type.Object({
          title: Type.String(), anchor: Type.String({ description: 'Block id the section starts at, e.g. "p12", or ""' }),
          icon: Type.String({ description: `One of ${ICON_TYPES.join(', ')}` }), bullets: Type.Array(bullet),
        }), replay: 'safe',
        execute: async (args) => wrap('add_section', () => draft.addSection(args)),
      }),
      defineTool({
        name: 'set_quote', description: 'Optional: one line copied word for word from one block of the page. Empty text means no quote.',
        parameters: Type.Object({ text: Type.String(), anchor: Type.String() }), replay: 'safe',
        execute: async (args) => wrap('set_quote', () => draft.setQuote(args)),
      }),
      defineTool({
        name: 'finish', description: 'Call once everything is submitted.', parameters: Type.Object({}), replay: 'safe',
        execute: async () => wrap('finish', () => draft.finish()),
      }),
    ],
  });
}

/**
 * Pages up to this long go into the prompt whole, as before (reading them through tools costs a model round trip
 * per read: on a 22k-character article that was ~70s to the first section instead of ~20s). Longer pages, which the
 * single JSON call used to cut off at this length, become an outline the model reads from.
 */
export const OVERVIEW_INLINE_MAX = MAX_CONTENT_CHARS;
const PREVIEW = 70, OUTLINE_BLOCKS = 240;

/** The page for the first message: inline, or its outline (headings, then each block id with a short preview). */
export function overviewInput(title: string, url: string, content: string): { input: string; withRead: boolean } {
  const page = content.slice(0, MAX_PAGE_CHARS);
  if (page.length <= OVERVIEW_INLINE_MAX) return { input: `Title: ${title}\nURL: ${url}\n\n${page}`, withRead: false };
  const blocks = [...blockTexts(page)];
  const step = Math.max(1, Math.ceil(blocks.length / OUTLINE_BLOCKS));
  const lines = blocks.filter((_, i) => i % step === 0).map(([id, t]) => {
    const flat = t.replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
    return `${id} (${flat.length}): ${flat.slice(0, PREVIEW)}${flat.length > PREVIEW ? '…' : ''}`;
  });
  return {
    withRead: true,
    input: `Title: ${title}\nURL: ${url}\n\nThe page is ${page.length} characters in ${blocks.length} blocks and is NOT included here. Below is its outline: each block id with its length and first words${step > 1 ? ` (every ${step}th block)` : ''}. Read the parts you need with read_page({blocks: "p3-p12"}) (several blocks per call; up to about 12000 characters) or search_page({query}) before writing; read the whole page when it is short enough.
<outline>
${lines.join('\n')}
</outline>`,
  };
}

export class ToolsUnsupported extends Error {}

export interface AgentDeps {
  /** one model turn with the tools installed: resolves with the reply text, and reports its stop reason */
  turn(instructions: string, input: string, tools: ReturnType<typeof overviewTools>, signal: AbortSignal, maxTokens: number, onStop: (reason: string) => void, onToolArgs: (name: string, args: unknown) => void): Promise<string>;
}
export interface AgentOptions {
  instructions: string; title: string; url: string; content: string; model: string;
  signal?: AbortSignal;
  onPartial?(s: Summary): void; onStatus?(s: OverviewStatus): void;
  /** limits for the whole run: model turns, tool calls and wall time */
  maxTurns?: number; maxToolCalls?: number; deadlineMs?: number;
  /** the first message, when it is not the page itself (a long page's chunk notes) */
  input?: string;
}

/** Run the loop. Returns the finished summary, or the best partial one when the limits run out first. */
export async function runOverviewAgent(o: AgentOptions, deps: AgentDeps): Promise<Summary> {
  const { maxTurns = 4, maxToolCalls = 40, deadlineMs = 150_000 } = o;
  if (o.signal?.aborted) throw new AbortError();
  const draft = createOverviewDraft(o.content);
  const { input, withRead } = o.input ? { input: o.input, withRead: false } : overviewInput(o.title, o.url, o.content);
  let calls = 0, outputs = 0, budget = maxOutputFor(o.model), lastError: unknown = null;
  let run: AbortController | null = null;
  let outOfTime = false, outOfCalls = false;
  const deadline = setTimeout(() => { outOfTime = true; run?.abort(); }, deadlineMs);
  const userAbort = () => run?.abort();
  o.signal?.addEventListener('abort', userAbort);
  let lastPartial = '';
  const emitPartial = () => {
    const s = draft.summary();
    if (!s) return;
    const key = JSON.stringify(s);
    if (key !== lastPartial) { lastPartial = key; o.onPartial?.(s); }
  };
  /** submit_summary's arguments as the model writes them: shown like the streamed JSON was (checked once complete) */
  let argsAt = 0;
  const streamArgs = (name: string, args: unknown) => {
    if (name !== 'submit_summary' || Date.now() - argsAt < 80) return;
    argsAt = Date.now();
    const p = partialFromObject(args);
    if (!p) return;
    const key = JSON.stringify(p);
    if (key !== lastPartial) { lastPartial = key; o.onPartial?.(p); }
  };
  const tools = overviewTools(draft, o.content.slice(0, MAX_PAGE_CHARS), withRead, {
    onRead: () => { if (++calls > maxToolCalls) { outOfCalls = true; run?.abort(); } o.onStatus?.('reading'); },
    onResult: (_name, r) => {
      outputs++;
      if (++calls > maxToolCalls) { outOfCalls = true; run?.abort(); }
      if (!r.ok) { o.onStatus?.('repairing'); return; }
      o.onStatus?.(null);
      emitPartial();
      // finished: the reply the model would still write is not needed; stop the run right after this result
      if (draft.finished) setTimeout(() => run?.abort(), 0);
    },
  });
  try {
    for (let t = 0; t < maxTurns && !draft.finished && !outOfTime && !outOfCalls; t++) {
      run = new AbortController();
      if (o.signal?.aborted) throw new AbortError();
      let stop = 'stop', reply = '';
      const before = outputs;
      try {
        reply = await deps.turn(o.instructions, t === 0 ? input : continuation(draft, input, stop), tools, run.signal, budget, (r) => { stop = r; }, streamArgs);
      } catch (e) {
        if (o.signal?.aborted) throw new AbortError();
        if (draft.finished || outOfTime || outOfCalls) break;
        if (isMaxTokensError(e) && budget > SAFE_MAX_OUTPUT) { budget = SAFE_MAX_OUTPUT; t--; continue; }
        if (t === 0 && outputs === 0 && calls === 0 && isToolsUnsupportedError(e)) throw new ToolsUnsupported(String((e as any)?.message ?? e));
        lastError = e;
        continue;
      }
      if (draft.finished) break;
      // ran out of output budget mid-turn: what the tools accepted stays; go on with a larger budget
      if (stop === 'length') budget = Math.min(budget * 2, MAX_OUTPUT_CEILING);
      // a model that ignored the tools and answered with the JSON itself: use it if it is complete
      if (outputs === before && stop !== 'length' && reply.includes('{')) {
        try { return parseSummary(reply, o.content); } catch { /* not usable: ask again for the tools */ }
      }
      // no tool call at all on the first turn: a model (or server) that does not do tools; the caller falls back to the JSON reply
      if (t === 0 && outputs === 0 && calls === 0 && stop !== 'length') throw new ToolsUnsupported(reply.trim() ? 'The model answered without calling the tools' : 'The model returned nothing');
    }
  } finally {
    clearTimeout(deadline);
    o.signal?.removeEventListener('abort', userAbort);
  }
  if (o.signal?.aborted) throw new AbortError();
  const best = draft.summary();
  if (best && (draft.finished || draft.sectionCount > 0)) return best;
  if (draft.sectionCount === 0 && outputs === 0 && calls === 0 && lastError && isToolsUnsupportedError(lastError)) throw new ToolsUnsupported(String((lastError as any)?.message ?? lastError));
  throw new OverviewIncomplete(lastError);
}

/** No usable summary came out; the message is for people, not a parser error. */
export class OverviewIncomplete extends Error {
  constructor(readonly reason?: unknown) { super('The model did not produce a complete overview'); this.name = 'OverviewIncomplete'; }
}

function continuation(draft: OverviewDraft, input: string, _stop: string): string {
  const have = draft.hasOverview ? `the overview and ${draft.sectionCount} section(s)${draft.sectionCount ? ` (${draft.titles().join('; ')})` : ''}` : `${draft.sectionCount} section(s) and no overview`;
  return `${input}\n\nYou already submitted ${have}; they are kept. Continue with the tools: add what is missing (${draft.hasOverview ? '' : 'submit_overview, '}the remaining sections in page order, an optional quote), then call finish. Keep your reasoning short.`;
}
