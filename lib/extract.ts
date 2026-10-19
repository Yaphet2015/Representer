import Defuddle from 'defuddle/full';
import { MARKER_RE, numberBlocks, type Anchors } from './locate';

/**
 * Extract the readable content as Markdown, with a `[pN]` marker at the start of every text block so the
 * model can point back at blocks by id. `anchors` holds each id's fingerprint for re-finding it later.
 */
export function extractPage(): { title: string; content: string; anchors: Anchors } {
  const { blocks, anchors } = numberBlocks(document);
  const doc = document.cloneNode(true) as Document;
  try {
    // Same tree, so a block's child-index path finds its twin in the clone.
    blocks.forEach((el, i) => {
      const twin = follow(doc, pathOf(el));
      twin?.insertBefore(doc.createTextNode(`[p${i + 1}] `), twin.firstChild);
    });
    const r = new Defuddle(doc, { markdown: true, url: location.href } as any).parse();
    const content = (r.contentMarkdown || r.content || '').replace(MARKER_RE, '[p$1] ').trim();
    if (content) return { title: r.title || document.title, content, anchors };
  } catch (e) { console.warn('[representer] defuddle failed', e); }
  const content = blocks.map((el, i) => `[p${i + 1}] ${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}`).join('\n\n');
  return { title: document.title, content: content.slice(0, 60000), anchors };
}

function pathOf(el: Element): number[] {
  const path: number[] = [];
  for (let e: Element | null = el; e && e.parentElement; e = e.parentElement) path.unshift([...e.parentElement.children].indexOf(e));
  return path;
}
function follow(doc: Document, path: number[]): Element | null {
  let e: Element | null = doc.documentElement;
  for (const i of path) e = e?.children[i] ?? null;
  return e;
}
