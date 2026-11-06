import Defuddle from 'defuddle/full';
import { keyOf, MARKER_RE, numberBlocks, type Anchors } from './locate';

export interface ExtractedDoc {
  title: string;
  content: string;
  anchors: Anchors;
}

/**
 * Clear form controls and contenteditable regions on a cloned tree so Defuddle / fallback text
 * never ships typed secrets. Does not mutate the live page.
 */
export function scrubSensitiveFields(root: ParentNode): void {
  for (const el of root.querySelectorAll('input, textarea, select')) {
    el.setAttribute('value', '');
    el.removeAttribute('checked');
    if ('value' in el) try { (el as HTMLInputElement).value = ''; } catch { /* */ }
    if ('defaultValue' in el) try { (el as HTMLInputElement).defaultValue = ''; } catch { /* */ }
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  // Only regions the reader can type into. contenteditable="false" is read-only page text (rich-text article
  // views render their body that way) and must be kept; an editable root clears everything inside it.
  for (const el of root.querySelectorAll('[contenteditable]')) {
    if (!isEditable(el) || (el.parentElement && isEditable(el.parentElement))) continue;
    el.textContent = '';
    el.removeAttribute('contenteditable');
  }
}

/**
 * HTML's contenteditable state: "", "true" and "plaintext-only" (ASCII case-insensitive) make an element
 * editable, "false" makes it read-only, and anything else (or no attribute) inherits from the parent.
 */
export function isEditable(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const v = e.getAttribute('contenteditable');
    if (v === null) continue;
    const s = v.toLowerCase();
    if (s === '' || s === 'true' || s === 'plaintext-only') return true;
    if (s === 'false') return false;
  }
  return false;
}

/**
 * Run Defuddle on any Document. Block discovery uses the live tree (layout/visibility);
 * Defuddle runs on a scrubbed clone so input values are not serialized.
 */
export function extractDocument(doc: Document, url: string): ExtractedDoc {
  const { blocks, anchors } = numberBlocks(doc);
  const clone = doc.cloneNode(true) as Document;
  scrubSensitiveFields(clone);
  try {
    blocks.forEach((el, i) => {
      const twin = follow(clone, pathOf(el));
      twin?.insertBefore(clone.createTextNode(`[p${i + 1}] `), twin.firstChild);
    });
    const r = new Defuddle(clone, { markdown: true, url } as any).parse();
    const content = (r.contentMarkdown || r.content || '').replace(MARKER_RE, '[p$1] ').trim();
    if (content) return { title: r.title || doc.title || '', content, anchors };
  } catch (e) { console.warn('[representer] defuddle failed', e); }
  // Fallback also reads from the scrubbed clone when possible
  const content = blocks.map((el, i) => {
    const twin = follow(clone, pathOf(el));
    const text = (twin?.textContent ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return `[p${i + 1}] ${text}`;
  }).join('\n\n');
  return { title: doc.title || '', content: content.slice(0, 60000), anchors };
}

export function extractPage(): ExtractedDoc {
  return extractDocument(document, location.href);
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

export interface MarkerReport {
  /** block ids whose marker Defuddle dropped: their text, if kept, sits under the previous id */
  missing: string[];
  /** ids whose text in the content does not contain the DOM block's leading text */
  mismatched: string[];
}

/** Split extracted content into `[pN]` chunks (id → text up to the next marker). */
export function markerChunks(content: string): Map<string, string> {
  const out = new Map<string, string>();
  const ms = [...content.matchAll(/\[p(\d+)\]\s?/g)];
  ms.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < ms.length ? ms[i + 1]!.index! : content.length;
    out.set(`p${m[1]}`, content.slice(start, end).trim());
  });
  return out;
}

/** Does each id's text in `content` really start from the DOM block its fingerprint describes? */
export function markerReport(content: string, anchors: Anchors): MarkerReport {
  const chunks = markerChunks(content);
  const missing: string[] = [], mismatched: string[] = [];
  for (const [id, fp] of Object.entries(anchors)) {
    const chunk = chunks.get(id);
    if (chunk === undefined) { missing.push(id); continue; }
    const head = keyOf(fp.head).slice(0, 16);
    if (head.length >= 6 && !keyOf(chunk).includes(head)) mismatched.push(id);
  }
  return { missing, mismatched };
}
