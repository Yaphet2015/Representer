/**
 * The page as a read-on-demand attachment ("page.md"): the defuddle Markdown with its `[pN]` block ids.
 * Pure helpers behind the read_page / search_page tools, plus the outline the system prompt carries.
 */
import { MARKER_RE, stripMarkers } from './locate';

export const PAGE_FILE = 'page.md';
/** Most of the text the model may be handed from a page, whatever the page length. */
export const MAX_PAGE_CHARS = 400_000;
/** Pages up to this long are embedded in the prompt instead of being read through tools. */
export const INLINE_MAX = 8000;
export const READ_DEFAULT = 6000;
export const READ_MAX = 12000;
const SEARCH_MAX = 8;

export const isInline = (content: string) => content.length <= INLINE_MAX;

interface Block { id: number; start: number; end: number }
function blocks(content: string): Block[] {
  const ms = [...content.matchAll(MARKER_RE)];
  return ms.map((m, i) => ({ id: Number(m[1]), start: m.index!, end: ms[i + 1]?.index ?? content.length }));
}

/** Facts for the prompt: size, block id range and the page's headings with the block they start at. */
export function outline(content: string, max = 40): { chars: number; blocks: number; first: number; last: number; headings: string[] } {
  const bs = blocks(content);
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (!m) continue;
    const id = line.match(/\[p(\d+)\]/)?.[1];
    const text = line.replace(MARKER_RE, '').replace(/^#{1,3}\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (text) headings.push(`${'  '.repeat(m[1]!.length - 1)}${text}${id ? ` [p${id}]` : ''}`);
    if (headings.length >= max) break;
  }
  return { chars: content.length, blocks: bs.length, first: bs[0]?.id ?? 0, last: bs.at(-1)?.id ?? 0, headings };
}

const head = (from: number, to: number, total: number, extra = '') => `[${PAGE_FILE} · characters ${from}-${to} of ${total}${extra}]`;

/** `read_page`: a block range ("p12", "p12-p20") or a character window. Always says where to continue. */
export function readPage(content: string, args: { blocks?: string; offset?: number; limit?: number }): string {
  const total = content.length;
  const limit = Math.min(Math.max(Math.floor(args.limit ?? READ_DEFAULT) || READ_DEFAULT, 1), READ_MAX);
  if (args.blocks?.trim()) {
    const m = args.blocks.trim().match(/^p?(\d+)\s*(?:[-–—:]\s*p?(\d+))?$/i);
    if (!m) return `Error: blocks must look like "p12" or "p12-p20" (got "${args.blocks}").`;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    const bs = blocks(content).filter((x) => x.id >= Math.min(a, b) && x.id <= Math.max(a, b));
    if (!bs.length) return `No blocks in range ${args.blocks}. The page has blocks p${outline(content).first}-p${outline(content).last}.`;
    const start = bs[0]!.start, end = bs.at(-1)!.end;
    const cut = Math.min(end, start + limit);
    return `${head(start, cut, total, cut < end ? ` · truncated, continue with offset=${cut}` : '')}\n${content.slice(start, cut)}`;
  }
  const offset = Math.min(Math.max(Math.floor(args.offset ?? 0) || 0, 0), total);
  const end = Math.min(total, offset + limit);
  if (offset >= total) return `${head(offset, offset, total)}\n(end of page)`;
  return `${head(offset, end, total, end < total ? ` · continue with offset=${end}` : ' · end of page')}\n${content.slice(offset, end)}`;
}

/** `search_page`: blocks containing every word of the query (case-insensitive), with a short snippet. */
export function searchPage(content: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Error: query is empty.';
  const hits: string[] = [];
  let count = 0;
  for (const b of blocks(content)) {
    const text = content.slice(b.start, b.end).replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
    const low = text.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    count++;
    if (hits.length >= SEARCH_MAX) continue;
    const at = Math.max(0, low.indexOf(words[0]!) - 60);
    hits.push(`[p${b.id}] ${at ? '…' : ''}${text.slice(at, at + 220)}${at + 220 < text.length ? '…' : ''}`);
  }
  if (!count) return `No block contains "${query}". Try fewer or different words, or read the outline sections.`;
  return `${count} block(s) match${count > hits.length ? `, showing the first ${hits.length}` : ''}:\n${hits.join('\n')}`;
}

/** The prompt section describing the attachment: embedded for short pages, tool-read for long ones. */
export function attachmentPrompt(title: string, content: string): string {
  const text = content.slice(0, MAX_PAGE_CHARS);
  if (isInline(text)) {
    return `The page "${title}" is attached as ${PAGE_FILE} (Markdown, ${text.length} characters, embedded below). Answer from it; if it does not say, say so.
<attachment name="${PAGE_FILE}">
${stripMarkers(text)}
</attachment>`;
  }
  const o = outline(text);
  return `The page "${title}" is attached as ${PAGE_FILE}: Markdown of its main content, ${o.chars} characters in ${o.blocks} blocks. Each block starts with an id like [p12] (p${o.first}-p${o.last}). It is NOT included in this prompt; read it on demand with your tools:
- read_page({ blocks: "p12-p20" }) reads blocks by id; read_page({ offset, limit }) reads a character window (default ${READ_DEFAULT}, at most ${READ_MAX} per call; the result says where to continue).
- search_page({ query }) lists the blocks that contain all the words, with snippets.
Before answering anything about the page's content, find and read the relevant parts instead of guessing, and read more when the first part is not enough. Never show the [pN] ids in your reply; refer to sections by their heading or by quoting.
<attachment_outline name="${PAGE_FILE}">
${o.headings.length ? o.headings.join('\n') : '(no headings; use search_page or read from the start)'}
</attachment_outline>`;
}
