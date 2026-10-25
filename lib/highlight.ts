/**
 * Inline highlights in the overview. The model marks them in the text itself:
 *   ==key phrase==   strong (the sentence-level takeaway: conclusion, number + what it measures, turn, risk, action)
 *   [[term]]         weak (product, command, person, institution, proper concept; clickable)
 * Models are sloppy with markers, so everything here is tolerant and ends in a safe state:
 * marker symbols never survive into displayed text, and a set of limits keeps highlights rare.
 */
export type MarkKind = 'strong' | 'term';
export interface Seg { text: string; kind?: MarkKind }

export const MAX_STRONG = 2; // whole overview
export const MAX_TERMS = 5;
export const MAX_RATIO = 0.2; // highlighted share of the overview text
const STRONG_MAX_CHARS = 80;
const TERM_MAX_CHARS = 40;

const isWs = (c: string | undefined) => !!c && /\s/.test(c);
/** `==` that is exactly two equal signs (not `===`), and not a spaced comparison like `a == b`. */
function eq2(s: string, i: number): boolean {
  if (s[i] !== '=' || s[i + 1] !== '=' || s[i - 1] === '=' || s[i + 2] === '=') return false;
  return !(isWs(s[i - 1]) && isWs(s[i + 2]));
}
const cleanPlain = (s: string) => {
  let out = s.replace(/\[\[|\]\]/g, '');
  out = out.replace(/(?<!=)==(?!=)/g, (m, off: number, all: string) => (isWs(all[off - 1]) && isWs(all[off + 2]) ? m : ''));
  return out;
};
const cleanInner = (s: string) => s.replace(/\[\[|\]\]/g, '').replace(/(?<!=)==(?!=)/g, '');

/**
 * Split one string into plain / strong / term segments.
 * Unpaired markers are dropped (their text stays plain); overlapping or nested markers keep the outer one and
 * drop the inner markers; the result never contains `==`, `[[` or `]]` (apart from a spaced `a == b`).
 */
export function parseMarks(input: string): Seg[] {
  const s = input ?? '';
  const out: Seg[] = [];
  let plain = '';
  const flush = () => { if (plain) { const t = cleanPlain(plain); if (t) out.push({ text: t }); plain = ''; } };
  const push = (kind: MarkKind, raw: string, next: string | undefined) => {
    const content = cleanInner(raw);
    const text = content.trim();
    if (!text) { plain += content; return; }
    // padding inside the marks (`== a ==`) stays as one space between the neighbours, not part of the mark
    if (content !== content.trimStart() && plain && !isWs(plain[plain.length - 1])) plain += ' ';
    flush();
    out.push({ text, kind });
    if (content !== content.trimEnd() && next !== undefined && !isWs(next)) plain += ' ';
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '[' && s[i + 1] === '[') {
      const j = s.indexOf(']]', i + 2);
      if (j < 0) { i += 2; continue; }
      const k = s.lastIndexOf('[[', j - 1);
      if (k > i) { plain += s.slice(i + 2, k); i = k; } // `[[a [[b]]`: the inner pair wins, `[[a ` is plain
      push('term', s.slice(i + 2, j), s[j + 2]);
      i = j + 2; continue;
    }
    if (eq2(s, i)) {
      let j = i + 2;
      while (j < s.length && !eq2(s, j)) j++;
      if (j >= s.length) { i += 2; continue; }
      push('strong', s.slice(i + 2, j), s[j + 2]);
      i = j + 2; continue;
    }
    plain += s[i]; i++;
  }
  flush();
  // merge neighbours of the same kind-less segments
  const merged: Seg[] = [];
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && !last.kind && !seg.kind) last.text += seg.text; else merged.push({ ...seg });
  }
  return merged;
}

export const serializeMarks = (segs: Seg[]) => segs.map((g) => (g.kind === 'strong' ? `==${g.text}==` : g.kind === 'term' ? `[[${g.text}]]` : g.text)).join('');
/** The text without any marker symbols (plain-text copy, chat context). */
export const stripMarks = (s: string) => parseMarks(s).map((g) => g.text).join('');

// ── safeguards ────────────────────────────────────────────────────────────────

/** Words that are never worth highlighting as a term. */
const GENERIC = new Set(`ai,a.i.,llm,llms,gpt,ml,model,models,user,users,system,systems,data,tool,tools,product,products,company,companies,people,app,apps,application,applications,software,technology,tech,platform,service,services,feature,features,method,methods,result,results,problem,problems,solution,solutions,article,page,website,site,web,internet,online,information,content,time,way,work,world,team,project,code,file,files,api,apis,version,example,examples,case,idea,research,study,report,news,market,business,industry,community,machine learning,artificial intelligence,deep learning,language model,large language model,algorithm,network,server,cloud,computer,device,devices,the,this,that,these,those,it,we,they,you,use,using,new,one,two,three,
人工智能,机器学习,深度学习,大模型,模型,语言模型,大语言模型,用户,系统,数据,工具,产品,公司,企业,平台,服务,功能,方法,结果,问题,方案,文章,页面,网站,网页,互联网,信息,内容,时间,团队,项目,代码,文件,版本,例子,案例,想法,研究,报告,新闻,市场,行业,社区,技术,软件,应用,算法,网络,服务器,云,电脑,设备,我们,他们,你,这个,那个,作者,本文,开发者,人们,大家,世界,生活,工作,方式,过程,原因,影响,变化,趋势,未来,目标,需求,能力,质量,效果,性能,成本,价格`.split(/,\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean));

const NUM_UNITS = /^(?:%|％|x|×|倍|万|亿|千|百|元|块|美元|刀|usd|rmb|cny|k|m|b|g|t|gb|mb|kb|tb|ms|s|秒|分钟|小时|天|年|月|日|个|次|人|条|页|行|million|billion|thousand|percent|dollars?|hours?|minutes?|days?|years?)$/i;
/** `40%`, `$1.2M`, `3x`, `10 倍`, `2024`: a number with nothing it measures. */
export function isBareNumber(s: string): boolean {
  const t = s.replace(/[\s\p{P}\p{S}]/gu, (c) => (c === '%' || c === '％' || c === '×' ? c : '')).trim();
  if (!t) return true; // only punctuation
  if (!/\p{N}/u.test(t)) return false;
  const rest = t.replace(/\p{N}+/gu, '#').split('#').map((x) => x.trim()).filter(Boolean);
  return rest.every((x) => NUM_UNITS.test(x));
}

const termKey = (s: string) => s.toLowerCase().replace(/^[\s"'`“”‘’「」《》]+|[\s"'`“”‘’「」《》.。,，]+$/g, '');
export const isGenericTerm = (s: string) => GENERIC.has(termKey(s)) || isBareNumber(s) || termKey(s).length < 2;

interface Ref { p: number; k: number }

/**
 * Apply the global limits to the marked parts of one overview, in reading order.
 * `scopeOf(i)` groups parts (the paragraph, each section) so a scope keeps at most one strong phrase.
 * Returns the parts with marks re-serialized (always safe to render or re-parse).
 */
export function normalizeMarks(parts: string[], scopeOf: (i: number) => number = (i) => i): string[] {
  const segs = parts.map(parseMarks);
  const refs = (kind: MarkKind): Ref[] => segs.flatMap((ss, p) => ss.map((g, k) => (g.kind === kind ? { p, k } : null)).filter((r): r is Ref => !!r));
  const at = (r: Ref) => segs[r.p]![r.k]!;
  const demote = (r: Ref) => { delete at(r).kind; };

  // strong: a phrase, not a lone number, not a whole paragraph
  for (const r of refs('strong')) { const t = at(r).text; if (t.length < 2 || t.length > STRONG_MAX_CHARS || isBareNumber(t)) demote(r); }
  const best = new Map<number, Ref>();
  for (const r of refs('strong')) { const sc = scopeOf(r.p), cur = best.get(sc); if (!cur || at(r).text.length > at(cur).text.length) best.set(sc, r); }
  for (const r of refs('strong')) { const b = best.get(scopeOf(r.p))!; if (b.p !== r.p || b.k !== r.k) demote(r); }
  refs('strong').slice(MAX_STRONG).forEach(demote);

  // terms: not generic, only the first occurrence, never touching a strong phrase
  const seen = new Set<string>();
  for (const r of refs('term')) {
    const t = at(r).text;
    if (t.length > TERM_MAX_CHARS || isGenericTerm(t)) { demote(r); continue; }
    const key = termKey(t);
    if (seen.has(key)) demote(r); else seen.add(key);
  }
  const shortGap = (g: Seg | undefined) => !!g && !g.kind && g.text.replace(/\s/g, '').length <= 2;
  for (const r of refs('term')) {
    const ss = segs[r.p]!;
    const near = (dir: -1 | 1) => { const a = ss[r.k + dir]; if (a?.kind === 'strong') return true; return shortGap(a) && ss[r.k + 2 * dir]?.kind === 'strong'; };
    if (near(-1) || near(1)) demote(r);
  }
  refs('term').slice(MAX_TERMS).forEach(demote);

  // too much highlighted text: weak first (last ones first), then extra strong ones
  const total = segs.flat().reduce((n, g) => n + g.text.replace(/\s/g, '').length, 0) || 1;
  const marked = () => segs.flat().reduce((n, g) => n + (g.kind ? g.text.replace(/\s/g, '').length : 0), 0);
  for (const r of refs('term').reverse()) { if (marked() / total <= MAX_RATIO) break; demote(r); }
  for (const r of refs('strong').slice(1).reverse()) { if (marked() / total <= MAX_RATIO) break; demote(r); }

  return segs.map(serializeMarks);
}
