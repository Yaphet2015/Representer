import { describe, expect, it } from 'vitest';
import { parseMarks, stripMarks } from '../lib/highlight';
import { isSummary, orderByAnchors, parseSummary } from '../lib/parse';
import type { Section } from '../lib/types';

const section = (title: string, anchors: string[], anchor?: string): Section => ({
  title, icon: 'list', bullets: anchors.map((_, i) => `${title}-${i}`), anchors,
  ...(anchor === undefined ? {} : { anchor }),
});
const content = Array.from({ length: 50 }, (_, i) => `[p${i + 1}] Block ${i + 1}`).join('\n\n');
const padding = '说明上下文与使用条件，帮助读者理解每一个条目的依据。'.repeat(20);

describe('overview anchor order', () => {
  it('repairs the five-step case and keeps bullet text, anchors, quotes and marks together', () => {
    const texts = ['第2步 [[pstack]]', '第3步', '第1步内容 ==先说出你的理解==', '第4步', '第5步'];
    const summary = parseSummary(JSON.stringify({ overview: padding, sections: [{
      title: '五步流程', icon: 'list', bullets: [20, 30, 10, 40, 50].map((n, i) => ({
        text: texts[i], anchor: `p${n}`, quote: `source-${n}`,
      })),
    }] }), content);
    expect(summary.sections[0]).toMatchObject({
      bullets: [texts[2], texts[0], texts[1], texts[3], texts[4]],
      anchors: ['p10', 'p20', 'p30', 'p40', 'p50'],
      quotes: ['source-10', 'source-20', 'source-30', 'source-40', 'source-50'],
    });
    expect(isSummary(summary)).toBe(true);
  });

  it('sorts numerically and stably while leaving missing and malformed anchor slots fixed', () => {
    const input = section('S', ['p12', '', 'p2', 'bad', '[P2]', 'p1', 'p0']);
    const [out] = orderByAnchors([input]);
    expect(out!.bullets).toEqual(['S-5', 'S-1', 'S-2', 'S-3', 'S-4', 'S-0', 'S-6']);
    expect(out!.anchors).toEqual(['p1', '', 'p2', 'bad', '[P2]', 'p12', 'p0']);
  });

  it('treats ids absent from the content as unkeyed, including invalid section ids', () => {
    const input = [section('late', ['p20', 'p999', '', 'p10'], 'p999'), section('early', ['p2'], 'p998')];
    const out = orderByAnchors(input, content);
    expect(out.map((s) => s.title)).toEqual(['early', 'late']);
    expect(out[1]!.bullets).toEqual(['late-3', 'late-1', 'late-2', 'late-0']);
    expect(out[1]!.anchors).toEqual(['p10', 'p999', '', 'p20']);
  });

  it('uses the page block registry during parsing and pins empty / nonexistent ids', () => {
    const summary = parseSummary(JSON.stringify({ overview: 'Overview', sections: [{
      title: 'S', bullets: ['p20', '', 'p999', 'not-an-id', 'p10'].map((anchor, i) => ({ text: `b${i}`, anchor })),
    }] }), content);
    expect(summary.sections[0]!.bullets).toEqual(['b4', 'b1', 'b2', 'b3', 'b0']);
    expect(summary.sections[0]!.anchors).toEqual(['p10', '', 'p999', '', 'p20']);
    expect(isSummary(summary)).toBe(true);
  });

  it('orders sections by their own anchor, then their first valid sorted bullet, pinning unkeyed slots', () => {
    const input = [
      section('late', ['p1'], 'p40'), section('fixed', ['', '']),
      section('fallback', ['p30', 'p10']), section('tie', ['p20'], 'p10'),
    ];
    const out = orderByAnchors(input, content);
    expect(out.map((s) => s.title)).toEqual(['fallback', 'fixed', 'tie', 'late']);
    expect(out[0]!.anchors).toEqual(['p10', 'p30']);
  });

  it('keeps section order below 50% coverage but still orders anchored bullets', () => {
    const input = [section('late', ['p30', 'p20', '', '', ''], 'p40'), section('early', ['', 'p1', ''], 'p1')];
    const out = orderByAnchors(input, content);
    expect(out.map((s) => s.title)).toEqual(['late', 'early']);
    expect(out[0]!.anchors).toEqual(['p20', 'p30', '', '', '']);
  });

  it('allows section ordering at exactly 50% coverage, counting only valid bullet ids', () => {
    const input = [section('late', ['p20', 'p999'], 'p20'), section('early', ['p1', ''], 'p1')];
    expect(orderByAnchors(input, content).map((s) => s.title)).toEqual(['early', 'late']);
  });

  it('leaves legacy string / quote formats and summaries without bullet anchors unchanged', () => {
    const old = [
      { title: 'late', icon: 'list' as const, anchor: 'p20', bullets: ['second', 'first'], quotes: ['b', 'a'] },
      { title: 'early', icon: 'list' as const, anchor: 'p1', bullets: ['third'] },
    ];
    expect(orderByAnchors(old, content)).toEqual(old);
    expect(parseSummary(JSON.stringify({ overview: 'Legacy', sections: old })).sections.map((s) => s.bullets))
      .toEqual(old.map((s) => s.bullets));
    expect(orderByAnchors([])).toEqual([]);
    expect(orderByAnchors([section('empty', [], 'p1')])).toEqual([section('empty', [], 'p1')]);
  });

  it('does not mutate input and is idempotent, including all parallel arrays', () => {
    const input = [section('late', ['p30', 'p20'], 'p30'), section('early', ['p2'], 'p1')];
    input[0]!.quotes = ['q30', 'q20'];
    const before = structuredClone(input);
    input.forEach((s) => { Object.freeze(s.bullets); Object.freeze(s.anchors); Object.freeze(s.quotes); Object.freeze(s); });
    Object.freeze(input);
    const out = orderByAnchors(input, content);
    expect(input).toEqual(before);
    expect(out[1]!.quotes).toEqual(['q20', 'q30']);
    expect(orderByAnchors(out, content)).toEqual(out);
  });

  it('applies strong per-section scopes and global strong/term limits in final reading order', () => {
    const point = (n: number, text: string) => ({ anchor: `p${n}`, text: `${text}。${padding}` });
    const summary = parseSummary(JSON.stringify({ overview: padding, sections: [
      { title: 'late', anchor: 'p30', bullets: [point(30, '==晚节核心==，这里介绍 [[LastTerm]]')] },
      { title: 'early', anchor: 'p1', bullets: [
        point(3, '==较晚短句==，这里介绍 [[SharedTerm]]、[[ThirdTerm]]'),
        point(2, '==较早短句==，这里介绍 [[SharedTerm]]、[[FirstTerm]]'),
      ] },
      { title: 'middle', anchor: 'p20', bullets: [point(20, '==中节核心==，这里介绍 [[FourthTerm]]、[[FifthTerm]]')] },
    ] }), content);
    expect(summary.sections.map((s) => s.title)).toEqual(['early', 'middle', 'late']);
    const bullets = summary.sections.flatMap((s) => s.bullets);
    const marked = (kind: 'strong' | 'term') => bullets.flatMap(parseMarks).filter((s) => s.kind === kind).map((s) => s.text);
    expect(marked('strong')).toEqual(['较早短句', '中节核心']);
    expect(marked('term')).toEqual(['SharedTerm', 'FirstTerm', 'ThirdTerm', 'FourthTerm', 'FifthTerm']);
    expect(bullets[1]).not.toContain('[[SharedTerm]]');
    expect(bullets.map(stripMarks)[0]).toContain('较早短句');
    expect(isSummary(summary)).toBe(true);
  });
});
