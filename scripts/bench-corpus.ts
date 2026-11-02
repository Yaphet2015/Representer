/**
 * Fetch the overview benchmark corpus: each URL is extracted the way the extension does it (defuddle Markdown with
 * a [pN] marker per block), in Node via linkedom. Writes <dir>/<id>.txt and <dir>/manifest.json.
 * Usage: npx tsx scripts/bench-corpus.ts urls.txt /workspace/bench-corpus   (urls.txt: "id url" per line; "id file:/path" copies a pre-extracted text)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// jsdom is not a project dependency: install it anywhere and point BENCH_JSDOM at that dir (default /tmp/benchdeps).
const { JSDOM } = createRequire(`${process.env.BENCH_JSDOM ?? '/tmp/benchdeps'}/`)('jsdom');
import Defuddle from 'defuddle/full';
import { numberBlocks, MARKER_RE } from '../lib/locate';

async function extract(url: string): Promise<{ title: string; content: string }> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'en,zh;q=0.8' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const { window } = new JSDOM(html, { url });
  const document = window.document;
  // jsdom has no layout: treat every element as rendered so listBlocks' visibility check passes.
  window.Element.prototype.getClientRects = function () { return [{}] as any; };
  // defuddle's Markdown step uses the global DOM.
  Object.assign(globalThis, { document, window, DOMParser: window.DOMParser, Node: window.Node });
  const { blocks } = numberBlocks(document);
  blocks.forEach((el: Element, i: number) => el.insertBefore(document.createTextNode(`[p${i + 1}] `), el.firstChild));
  try {
    const r = new (Defuddle as any)(document, { markdown: true, url }).parse();
    const content = (r.contentMarkdown || r.content || '').replace(MARKER_RE, '[p$1] ').trim();
    if (content) return { title: r.title || document.title, content };
  } catch (e) { console.warn('defuddle failed', url, String(e)); }
  return { title: document.title, content: blocks.map((el: Element, i: number) => `[p${i + 1}] ${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}`).join('\n\n') };
}

const [list, dir = '/workspace/bench-corpus'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const manifest: any[] = [];
for (const line of readFileSync(list!, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
  const [id, url, ...t] = line.split(/\s+/);
  try {
    let title: string, content: string;
    if (url!.startsWith('file:')) { content = readFileSync(url!.slice(5), 'utf8'); title = t.join(' ') || id!; }
    else ({ title, content } = await extract(url!));
    writeFileSync(`${dir}/${id}.txt`, content);
    const blocks = [...content.matchAll(MARKER_RE)].length;
    manifest.push({ id, url, title, chars: content.length, blocks, long: content.length > 60000 });
    console.log(id, content.length, blocks, title.slice(0, 60));
  } catch (e) { console.log('FAIL', id, url, String(e)); }
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
