/**
 * Overview benchmark: runs the real overview path (providerFor(...).summarize) on a corpus and records tokens,
 * time to first content, total time, success, sections and coverage per run.
 *
 *   LLM_TEST_BASE_URL=… LLM_TEST_MODEL=… LLM_TEST_API_KEY=… \
 *   npx tsx scripts/bench-overview.ts --corpus /workspace/bench-corpus --out /workspace/bench-results/baseline --runs 2 --par 4
 *
 * Corpus: <corpus>/manifest.json ([{id,title,url,chars,long}]) plus <corpus>/<id>.txt (extracted `[pN]` content,
 * see scripts/bench-corpus.ts). Writes <out>.csv, <out>.md and <out>.jsonl (raw summaries).
 *
 * Coverage (computed from the returned summary only):
 *  - chunkCov: the content is cut into consecutive 12,000-char chunks by character offset; a chunk is covered when
 *    the `[pN]` marker of at least one cited block (section anchor, bullet anchors, quote anchor) starts in it.
 *    chunkCov = covered chunks / all chunks.
 *  - spread: char-weighted share of blocks that are cited, or lie inside a section's anchor range (min..max block
 *    number among that section's anchor and bullet anchors). Weight = the block's text length.
 */
import './node-polyfills';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { providerFor } from '../lib/provider';
import { MARKER_RE } from '../lib/locate';
import type { Summary } from '../lib/types';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const corpus = arg('corpus', '/workspace/bench-corpus'), out = arg('out', '/workspace/bench-results/baseline');
const runs = +arg('runs', '1'), par = +arg('par', '4'), only = arg('only', '');
const CHUNK = 12_000;

const { LLM_TEST_BASE_URL: baseUrl, LLM_TEST_MODEL: model, LLM_TEST_API_KEY: apiKey } = process.env;
if (!baseUrl || !model || !apiKey) throw new Error('set LLM_TEST_BASE_URL, LLM_TEST_MODEL, LLM_TEST_API_KEY');
const provider = providerFor({ baseUrl, apiKey, model, mock: false, systemPrompt: '' }, 'zh-CN');

interface Page { id: string; title: string; url: string; chars: number; long: boolean }
const pages: Page[] = JSON.parse(readFileSync(`${corpus}/manifest.json`, 'utf8')).filter((p: Page) => !only || only.split(',').includes(p.id));

function cited(s: Summary): Set<number> {
  const ids = new Set<number>();
  const add = (a?: string) => { const m = /^p(\d+)$/.exec(a ?? ''); if (m) ids.add(+m[1]!); };
  for (const sec of s.sections) { add(sec.anchor); sec.anchors?.forEach(add); }
  add(s.quote?.anchor);
  return ids;
}

export function coverage(content: string, s: Summary) {
  const marks = [...content.matchAll(MARKER_RE)].map((m, i, all) => ({ n: +m[1]!, at: m.index!, len: (all[i + 1]?.index ?? content.length) - m.index! - m[0].length }));
  const ids = cited(s);
  const chunks = Math.max(1, Math.ceil(content.length / CHUNK));
  const hit = new Set(marks.filter((m) => ids.has(m.n)).map((m) => Math.floor(m.at / CHUNK)));
  const ranges = s.sections.map((sec) => [sec.anchor, ...(sec.anchors ?? [])].map((a) => /^p(\d+)$/.exec(a ?? '')?.[1]).filter(Boolean).map(Number))
    .filter((r) => r.length).map((r) => [Math.min(...r), Math.max(...r)] as const);
  let tot = 0, cov = 0;
  for (const m of marks) { tot += m.len; if (ids.has(m.n) || ranges.some(([a, b]) => m.n >= a && m.n <= b)) cov += m.len; }
  return { chunks, chunkCov: hit.size / chunks, spread: tot ? cov / tot : 0, cited: ids.size };
}

interface Row { id: string; long: boolean; chars: number; run: number; ok: boolean; err: string; sections: number; bullets: number; ttftS: number | null; totalS: number;
  inTok: number; cacheTok: number; outTok: number; reasonTok: number; calls: number; chunks: number; chunkCov: number; spread: number; cited: number }

async function one(p: Page, run: number): Promise<Row> {
  const content = readFileSync(`${corpus}/${p.id}.txt`, 'utf8');
  const t0 = performance.now();
  let ttft: number | null = null;
  const u = { inTok: 0, cacheTok: 0, outTok: 0, reasonTok: 0, calls: 0 };
  let s: Summary | null = null, err = '';
  try {
    s = await provider.summarize(p.title, p.url, content, undefined, () => { ttft ??= performance.now(); }, undefined, {
      onPartial: (x) => { if (x.sections.length) ttft ??= performance.now(); },
      onUsage: (x) => { u.inTok += x.input; u.cacheTok += x.cacheRead; u.outTok += x.output; u.reasonTok += x.reasoning ?? 0; u.calls++; },
    });
  } catch (e) { err = String((e as Error)?.message ?? e).slice(0, 120); }
  const totalS = (performance.now() - t0) / 1000;
  const cov = s ? coverage(content, s) : { chunks: Math.ceil(content.length / CHUNK), chunkCov: 0, spread: 0, cited: 0 };
  appendFileSync(`${out}.jsonl`, JSON.stringify({ id: p.id, run, err, summary: s }) + '\n');
  const row: Row = { id: p.id, long: p.long, chars: content.length, run, ok: !!s && s.sections.length > 0, err, sections: s?.sections.length ?? 0,
    bullets: s?.sections.reduce((n, x) => n + x.bullets.length, 0) ?? 0, ttftS: ttft === null ? null : (ttft - t0) / 1000, totalS, ...u, ...cov };
  console.log(JSON.stringify(row));
  return row;
}

const pct = (xs: number[], q: number) => { if (!xs.length) return NaN; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)]!; };

mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.jsonl`, '');
const jobs = pages.flatMap((p) => Array.from({ length: runs }, (_, r) => () => one(p, r + 1)));
const rows: Row[] = [];
await Promise.all(Array.from({ length: par }, async () => { for (let j; (j = jobs.shift()); ) rows.push(await j()); }));
rows.sort((a, b) => +a.long - +b.long || a.id.localeCompare(b.id) || a.run - b.run);

const cols = Object.keys(rows[0]!) as (keyof Row)[];
writeFileSync(`${out}.csv`, [cols.join(','), ...rows.map((r) => cols.map((c) => { const v = r[c]; return typeof v === 'number' ? +v.toFixed(3) : JSON.stringify(v ?? ''); }).join(','))].join('\n') + '\n');

const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const metrics: [string, (r: Row) => number | null, number][] = [
  ['TTFT s', (r) => r.ttftS, 1], ['total s', (r) => r.totalS, 1], ['input tok', (r) => r.inTok + r.cacheTok, 0], ['output tok', (r) => r.outTok, 0],
  ['reasoning tok', (r) => r.reasonTok, 0], ['model calls', (r) => r.calls, 0], ['sections', (r) => r.sections, 0], ['chunk coverage %', (r) => r.chunkCov * 100, 0], ['block spread %', (r) => r.spread * 100, 0],
];
const groups: [string, Row[]][] = [['short (≤60k)', rows.filter((r) => !r.long)], ['long (>60k)', rows.filter((r) => r.long)], ['all', rows]];
let md = `# Overview benchmark — ${model} (zh-CN), ${new Date().toISOString()}\n\n${pages.length} pages × ${runs} runs. Medians/P90 over successful runs (time, tokens: all runs).\n\n`;
md += `| metric | ${groups.map(([g, rs]) => `${g} median | ${g} P90`).join(' | ')} |\n|---|${groups.map(() => '---|---').join('|')}|\n`;
md += `| success | ${groups.map(([, rs]) => `${rs.filter((r) => r.ok).length}/${rs.length} | `).join(' | ')} |\n`;
for (const [name, get, d] of metrics) md += `| ${name} | ${groups.map(([, rs]) => { const v = rs.filter((r) => r.ok || /tok|total|calls/.test(name)).map(get).filter((x): x is number => x !== null); return `${f(pct(v, 0.5), d)} | ${f(pct(v, 0.9), d)}`; }).join(' | ')} |\n`;
md += `\n## Runs\n\n| page | chars | run | ok | sections | TTFT s | total s | in tok | out tok | reason tok | calls | chunks | chunk cov | spread | err |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.id} | ${r.chars} | ${r.run} | ${r.ok ? '✓' : '✗'} | ${r.sections} | ${f(r.ttftS ?? NaN)} | ${f(r.totalS)} | ${r.inTok + r.cacheTok} | ${r.outTok} | ${r.reasonTok} | ${r.calls} | ${r.chunks} | ${f(r.chunkCov * 100, 0)}% | ${f(r.spread * 100, 0)}% | ${r.err} |\n`;
md += `\nCoverage: chunk = share of 12,000-char chunks containing a cited block's marker; spread = char-weighted share of blocks cited or inside a section's anchor range. Input tokens include cache reads.\n`;
writeFileSync(`${out}.md`, md);
console.log(md.split('\n## Runs')[0]);
