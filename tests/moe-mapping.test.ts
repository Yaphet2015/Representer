/**
 * Real extract→fingerprint→locate must land on the cited *text*, not merely a non-null element.
 * Each [pN] the model sees must map to its own DOM block: the 90% policy and the neighbouring
 * gpu-sniff paragraph get different ids that resolve to different elements.
 */
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractDocument, markerReport } from '../lib/extract';
import {
  liveIndex, resolveFingerprint,
} from '../lib/locate';
import { isContentCandidate, listCandidateIframes } from '../lib/frames';

// Synthetic stand-in for the handbook's structure: a header block Defuddle drops, a section heading, a paragraph
// with the policy mid-sentence, two neighbours, and a caption-less table — short invented text, not page content.
const fixture = `<!doctype html><html><head><title>MoE</title></head><body>
<header><p>Synthetic Handbook</p><p>Author A, Author B</p><p>Published Nov. 1</p></header>
<main><article>
<h4>Choose a baseline for each allocation size</h4>
<p>Baselines fall with node count: 77.14 GB/s on two nodes and 30.91 GB/s on eight, so compare like with like.</p>
<p>Repeat the check on a known-good setup first. A practical starting policy is to require 90% of the baseline bandwidth and a passing correctness check.</p>
<p>Record the chosen threshold next to the allocation so later runs can be compared against it.</p>
<p>For periodic checks during training, use --gpu-sniff-test-interval so the watchdog repeats the all-to-all test.</p>
<table><tr><td>nodes</td><td>busbw</td></tr><tr><td>2</td><td>77.14</td></tr></table>
</article></main></body></html>`;

function load(html = fixture) {
  const { document, window } = parseHTML(html);
  (document as any).URL = 'https://huggingface-moe-blogpost.hf.space/';
  (window.Element.prototype as any).getClientRects = function () { return [{}]; };
  (window.HTMLElement.prototype as any).getBoundingClientRect = function () {
    return { width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', {
    configurable: true, get() { return false; },
  });
  (window.Element.prototype as any).scrollIntoView = function () {};
  return document as unknown as Document;
}


describe('MoE baseline: extract → fingerprint mapping', () => {
  it('extract associates 90% text with a marker whose DOM fingerprint resolves to that paragraph', () => {
    const doc = load();
    const extracted = extractDocument(doc, 'https://huggingface-moe-blogpost.hf.space/');
    expect(extracted.content).toMatch(/90%\s+of\s+the\s+baseline\s+bandwidth/);
    expect(extracted.content).toMatch(/gpu-sniff-test-interval/);

    const ms = [...extracted.content.matchAll(/\[p(\d+)\]\s*/g)];
    const parts = ms.map((mm, i) => {
      const start = mm.index! + mm[0].length;
      const end = i + 1 < ms.length ? ms[i + 1]!.index! : extracted.content.length;
      return { id: `p${mm[1]}`, text: extracted.content.slice(start, end) };
    });
    const part90 = parts.find((p) => /90%\s+of\s+the\s+baseline/i.test(p.text));
    const partSniff = parts.find((p) => /gpu-sniff-test-interval/i.test(p.text));
    expect(part90?.id).toBeTruthy();
    expect(partSniff?.id).toBeTruthy();
    expect(part90!.id).not.toBe(partSniff!.id);

    const live = liveIndex(doc);
    const el90 = resolveFingerprint(live, extracted.anchors[part90!.id]!);
    const elSniff = resolveFingerprint(live, extracted.anchors[partSniff!.id]!);
    expect(el90?.textContent).toMatch(/90%\s+of\s+the\s+baseline/);
    expect(el90?.textContent).not.toMatch(/gpu-sniff/);
    expect(elSniff?.textContent).toMatch(/gpu-sniff-test-interval/);
    expect(elSniff?.textContent).not.toMatch(/90%\s+of\s+the\s+baseline/);
  });

  it('every id in the real extract maps to its own DOM block (no dropped/mismatched markers)', () => {
    const doc = load();
    const extracted = extractDocument(doc, 'https://huggingface-moe-blogpost.hf.space/');
    const r = markerReport(extracted.content, extracted.anchors);
    expect(r.mismatched).toEqual([]);
  });
});

describe('nested decorative frames', () => {
  it('does not treat empty-src / about:blank iframes as unread content candidates', () => {
    const doc = load(`<!doctype html><html><body>
      <iframe src="" style="width:900px;height:700px"></iframe>
      <iframe src="about:blank" style="width:900px;height:700px"></iframe>
      <iframe src="https://app.example.com/doc" style="width:900px;height:700px"></iframe>
    </body></html>`);
    const frames = [...doc.querySelectorAll('iframe')] as HTMLIFrameElement[];
    for (const el of frames) {
      (el as any).getBoundingClientRect = () => ({ width: 900, height: 700, top: 0, left: 0, bottom: 700, right: 900, x: 0, y: 0, toJSON() {} });
    }
    expect(isContentCandidate(frames[0]!)).toBe(false);
    expect(isContentCandidate(frames[1]!)).toBe(false);
    expect(isContentCandidate(frames[2]!)).toBe(true);
    expect(listCandidateIframes(doc).map((e) => e.src)).toEqual([frames[2]!.src]);
  });
});
