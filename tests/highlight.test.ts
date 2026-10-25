import { describe, expect, it } from 'vitest';
import { isBareNumber, MAX_STRONG, MAX_TERMS, normalizeMarks, parseMarks, serializeMarks, stripMarks } from '../lib/highlight';
import { parseSummary, validateQuote } from '../lib/parse';

const kinds = (s: string) => parseMarks(s).filter((g) => g.kind).map((g) => `${g.kind}:${g.text}`);
// highlights are limited to 20% of the text, so realistic samples need some plain text around them
const FILL = ' The rest of this sentence is ordinary prose that nobody would want highlighted, and it goes on long enough to keep the ratio low across the whole paragraph, with plenty of words.';
const norm = (...parts: string[]) => normalizeMarks(parts);
const noMarkers = (s: string) => expect(s).not.toMatch(/\[\[|\]\]|(?<!=)==(?!=)/);

describe('parseMarks (tolerant)', () => {
  it('reads strong and term marks', () => {
    expect(parseMarks('A ==key phrase== and [[pstack]] ok')).toEqual([
      { text: 'A ' }, { text: 'key phrase', kind: 'strong' }, { text: ' and ' }, { text: 'pstack', kind: 'term' }, { text: ' ok' },
    ]);
  });
  it('plain text and old unmarked overviews pass through unchanged', () => {
    expect(parseMarks('Nothing marked here, 1 + 1 = 2.')).toEqual([{ text: 'Nothing marked here, 1 + 1 = 2.' }]);
    expect(parseMarks('')).toEqual([]);
  });
  it('half-written and unpaired markers become plain text without marker symbols', () => {
    for (const s of ['cost ==cut by half', 'see [[pstack', 'oops ]] and', 'x ==', '==', '[[', '[[]]', '====']) {
      const out = stripMarks(s); noMarkers(out);
    }
    expect(stripMarks('cost ==cut by half')).toBe('cost cut by half');
    expect(stripMarks('see [[pstack')).toBe('see pstack');
    expect(parseMarks('see [[pstack').every((g) => !g.kind)).toBe(true);
  });
  it('keeps a spaced comparison like a == b as text', () => {
    expect(stripMarks('a == b')).toBe('a == b');
    expect(stripMarks('x === y')).toBe('x === y');
  });
  it('leaves version pins and comparisons between ASCII words alone', () => {
    expect(stripMarks('pip install requests==2.6.0 now')).toBe('pip install requests==2.6.0 now');
    expect(stripMarks('if a==b then ==pin requests==2.6.0== ok').replace(/\s+/g, ' ')).toBe('if a==b then pin requests==2.6.0 ok');
    expect(kinds('==pin requests==2.6.0 for stability== now')).toEqual(['strong:pin requests==2.6.0 for stability']);
    expect(kinds('加包名==版本号（如 requests==2.6.0）可锁定')).toEqual([]);
    expect(stripMarks('加包名==版本号（如 requests==2.6.0）可锁定')).toBe('加包名版本号（如 requests==2.6.0）可锁定');
  });
  it('nested and overlapping marks resolve to the outer mark, with no symbols left', () => {
    expect(kinds('==use [[pstack]] today==')).toEqual(['strong:use pstack today']);
    expect(kinds('[[a ==b== c]]')).toEqual(['term:a b c']);
    expect(kinds('==a [[b== c]]')).toEqual(['strong:a b']);
    expect(kinds('[[a [[b]]')).toEqual(['term:b']);
    for (const s of ['==a [[b== c]]', '[[a ==b]] c==', '[[[x]]]', '==[[==']) noMarkers(stripMarks(s));
  });
  it('trims padded marks and drops empty ones', () => {
    expect(parseMarks('a [[ x ]] b')).toEqual([{ text: 'a ' }, { text: 'x', kind: 'term' }, { text: ' b' }]);
    expect(stripMarks('a [[ x ]] b')).toBe('a x b');
    expect(kinds('a [[ ]] b')).toEqual([]);
  });
  it('drops Markdown emphasis or code ticks the model put inside a mark', () => {
    expect(kinds('a ==*the phrase*== b')).toEqual(['strong:the phrase']);
    expect(kinds('a [[`/setup-pstack`]] b')).toEqual(['term:/setup-pstack']);
    expect(kinds('a [[__init__]] b')).toEqual(['term:__init__']);
    expect(kinds('a [[*args]] b')).toEqual(['term:*args']);
  });
  it('is idempotent on its own output', () => {
    const s = 'x ==phrase one== y [[T]] z ==open';
    const once = serializeMarks(parseMarks(s));
    expect(serializeMarks(parseMarks(once))).toBe(once);
  });
  it('a whole /command is one term', () => {
    expect(kinds('run [[/setup-pstack]] first')).toEqual(['term:/setup-pstack']);
    expect(kinds('run /setup-[[pstack]] first')).toEqual(['term:pstack']); // the model got it wrong; the stricter rule is in the prompt
  });
});

describe('normalizeMarks (safeguards)', () => {
  it('keeps a repeated term only at its first occurrence', () => {
    const [a, b] = norm('[[pstack]] is great. [[pstack]] again.', 'and [[PStack]] once more');
    expect(kinds(a!)).toEqual(['term:pstack']); expect(kinds(b!)).toEqual([]);
    expect(stripMarks(a!)).toBe('pstack is great. pstack again.');
  });
  it('keeps at most one strong phrase per scope (the longest) and two overall (the earliest)', () => {
    const out = normalizeMarks(
      ['==short one== and ==a much longer key phrase here==' + FILL, '==second section phrase==' + FILL, '==third section phrase==' + FILL],
      (i) => i,
    );
    expect(kinds(out[0]!)).toEqual(['strong:a much longer key phrase here']);
    expect(kinds(out[1]!)).toEqual(['strong:second section phrase']);
    expect(kinds(out[2]!)).toEqual([]);
    expect(out.flatMap(kinds).length).toBeLessThanOrEqual(MAX_STRONG);
  });
  it('caps terms at the maximum, earliest first', () => {
    const text = Array.from({ length: 9 }, (_, i) => `[[Name${i}]]`).join(' and ') + ' appear in a longer filler sentence so the ratio stays low. ' + 'filler '.repeat(60);
    expect(kinds(norm(text)[0]!)).toHaveLength(MAX_TERMS);
    expect(kinds(norm(text)[0]!)[0]).toBe('term:Name0');
  });
  it('downgrades strong marks that are only a number', () => {
    expect(kinds(norm('Costs fell ==40%== last year' + FILL)[0]!)).toEqual([]);
    expect(kinds(norm('Costs fell ==$1.2M== last year')[0]!)).toEqual([]);
    expect(kinds(norm('There were ==3x== more')[0]!)).toEqual([]);
    expect(kinds(norm('==cut p99 latency by 40%== for all' + FILL)[0]!)).toEqual(['strong:cut p99 latency by 40%']);
    expect(isBareNumber('2024')).toBe(true); expect(isBareNumber('40% faster')).toBe(false); expect(isBareNumber('增长40%')).toBe(false); expect(isBareNumber('10倍')).toBe(true);
  });
  it('drops generic words (English and Chinese) and bare numbers as terms', () => {
    const out = norm('[[AI]] and [[model]] and [[用户]] and [[人工智能]] and [[2024]] but [[Claude Code]] stays' + FILL)[0]!;
    expect(kinds(out)).toEqual(['term:Claude Code']);
    expect(stripMarks(out)).toBe('AI and model and 用户 and 人工智能 and 2024 but Claude Code stays' + FILL);
  });
  it('never leaves a term inside or right next to a strong phrase', () => {
    expect(kinds(norm('==run [[pstack]] to start== now' + FILL)[0]!)).toEqual(['strong:run pstack to start']);
    expect(kinds(norm('==the big claim==, [[Acme]] says and [[Other]] too' + FILL)[0]!)).toEqual(['strong:the big claim', 'term:Other']);
    expect(kinds(norm('[[Acme]] ==the big claim== here' + FILL)[0]!)).toEqual(['strong:the big claim']);
    expect(kinds(norm('==the big claim== was stated by the CEO of [[Acme]]' + FILL)[0]!)).toEqual(['strong:the big claim', 'term:Acme']);
  });
  it('removes terms first, then extra strong phrases, when more than 20% of the text is highlighted', () => {
    const text = '==这是一个相当长的关键短语用来占据比例== 和 [[甲方公司]] [[乙方机构]] 还有一些其他的普通文字。';
    const out = norm(text)[0]!;
    expect(kinds(out)).toEqual(['strong:这是一个相当长的关键短语用来占据比例']); // the terms went, the one strong stays
    const two = normalizeMarks(['==前半部分很重要的结论==，后面是更多普通文字。', '==另一个相当重要的关键结论=='], (i) => i);
    expect(two.flatMap(kinds).length).toBe(1);
    const plain = norm('==核心结论放在这里== ' + '普通文字'.repeat(40))[0]!;
    expect(kinds(plain)).toHaveLength(1);
  });
  it('rejects absurdly long marks', () => {
    expect(kinds(norm(`==${'long '.repeat(30)}== ok`)[0]!)).toEqual([]);
  });
  it('allows zero highlights', () => {
    expect(norm('Just a plain overview.')).toEqual(['Just a plain overview.']);
  });
  it('output never contains marker symbols outside valid pairs and always round-trips', () => {
    const out = norm('==a [[b== c]] ]] [[x', '== == [[ ]] ==ok phrase== [[Term]]');
    for (const o of out) expect(serializeMarks(parseMarks(o))).toBe(o);
    for (const o of out) noMarkers(stripMarks(o));
  });
});

describe('parseSummary with marks and quote', () => {
  const content = '[p1] # Title\n\n[p2] The cache rewrite cuts cold builds from 90s to 12s, which is the real headline here.\n\n[p3] See [the docs](https://example.com/docs/cache) for details on migrating.';
  const raw = (extra: object = {}) => JSON.stringify({
    overview: 'Acme 2.0 rewrites the cache, so ==cold builds drop from 90s to 12s==. Run [[acme migrate]] first.' + FILL,
    sections: [{ title: 'Speed ==x==', anchor: 'p2', icon: 'chart', bullets: [{ text: 'Cold build: [[Acme]] now ==12s on CI==', anchor: 'p2' }] }], ...extra,
  });
  it('normalizes marks across the overview and bullets, and strips them from titles', () => {
    const s = parseSummary(raw(), content);
    expect(s.sections[0]!.title).toBe('Speed x');
    expect(kinds(s.overview)).toEqual(['strong:cold builds drop from 90s to 12s', 'term:acme migrate']);
    expect(kinds(s.sections[0]!.bullets[0]!)).toEqual(['term:Acme', 'strong:12s on CI']); // strong phrases: one per scope, two overall
    expect(s).not.toHaveProperty('keyTerms');
  });
  it('accepts a quote that is part of its block', () => {
    const s = parseSummary(raw({ quote: { text: 'cuts cold builds from 90s to 12s, which is the real headline', anchor: 'p2' } }), content);
    expect(s.quote).toEqual({ text: 'cuts cold builds from 90s to 12s, which is the real headline', anchor: 'p2' });
  });
  it('tolerates other anchor spellings, whitespace and punctuation differences', () => {
    const q = validateQuote({ text: 'The  cache rewrite cuts cold builds\nfrom 90s to 12s;', anchor: '[P2]' }, content);
    expect(q?.anchor).toBe('p2');
  });
  it('drops the quote silently when it fails validation', () => {
    const bad: unknown[] = [
      { text: 'cuts cold builds from 90s to 12s, which is the real headline', anchor: 'p3' }, // wrong block
      { text: 'cuts cold builds from 90s to 9s, which is the real headline', anchor: 'p2' }, // not in the block
      { text: 'cuts cold builds from 90s to 12s', anchor: 'p99' }, // no such block
      { text: 'cuts cold builds from 90s to 12s', anchor: '' },
      { text: 'cache', anchor: 'p2' }, // too short
      { text: 'x'.repeat(250), anchor: 'p2' },
      { text: 5, anchor: 'p2' }, 'just a string', null,
    ];
    for (const q of bad) { const s = parseSummary(raw({ quote: q }), content); expect(s.quote, JSON.stringify(q)).toBeUndefined(); }
    expect(parseSummary(raw({ quote: null }), content).quote).toBeUndefined();
  });
  it('ignores link targets in the page markdown and cannot validate without the page content', () => {
    expect(validateQuote({ text: 'for details on migrating', anchor: 'p3' }, content)).toBeTruthy();
    expect(parseSummary(raw({ quote: { text: 'cuts cold builds from 90s to 12s', anchor: 'p2' } })).quote).toBeUndefined();
  });
  it('drops quotation marks wrapped around the quote', () => {
    expect(validateQuote({ text: '“cuts cold builds from 90s to 12s,” he said', anchor: 'p2' }, content)).toBeUndefined(); // the trailing words are not in the block
    expect(validateQuote({ text: '"The cache rewrite cuts cold builds from 90s to 12s"', anchor: 'p2' }, content)?.text).toBe('The cache rewrite cuts cold builds from 90s to 12s');
  });
  it('strips marks from a quote before checking', () => {
    expect(validateQuote({ text: 'cuts ==cold builds== from 90s to 12s', anchor: 'p2' }, content)?.text).toBe('cuts cold builds from 90s to 12s');
  });
});
