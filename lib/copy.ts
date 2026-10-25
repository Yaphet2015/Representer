/** What the copy buttons put on the clipboard: Markdown without marks and without internal block ids. */
import { stripMarks } from './highlight';
import { cleanQuoteText } from './parse';
import type { Summary } from './types';

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();

/** Remove internal `[pN]` block ids (and the space after them) from text that goes to the clipboard. */
export const withoutBlockIds = (s: string) =>
  s.replace(/[ \t]*\\?\[p\d+\\?\][ \t]*(?=\n|$)/g, '') // at the end of a line: also the space before it
    .replace(/\\?\[p\d+\\?\][ \t]?/g, ''); // inline: the one space after it (never the line break)

/** A chat message as Markdown source: exactly what was written, minus internal block ids. */
export const messageMarkdown = (text: string) => withoutBlockIds(text).trim();

export interface OverviewCopyOpts {
  /** page title, becomes the `#` heading when given */
  pageTitle?: string;
  /** heading of the excerpt section */
  excerptTitle?: string;
  /** "title · site" shown under the excerpt */
  excerptFrom?: string;
}

/**
 * The whole overview as Markdown: `#` page title, the overview paragraph, a `##` heading with `-` bullets per
 * section, then the excerpt from the page (when there is one) as a `>` quote with its source.
 * Highlight marks (`==x==`, `[[x]]`) are dropped and their text kept.
 */
export function overviewMarkdown(summary: Summary, opts: OverviewCopyOpts = {}): string {
  const clean = (s: string) => oneLine(withoutBlockIds(stripMarks(s)));
  const blocks: string[] = [];
  const title = opts.pageTitle ? clean(opts.pageTitle) : '';
  if (title) blocks.push(`# ${title}`);
  const intro = clean(summary.overview ?? '');
  if (intro) blocks.push(intro);
  for (const sec of summary.sections ?? []) {
    const heading = clean(sec.title ?? '');
    const bullets = (sec.bullets ?? []).map(clean).filter(Boolean);
    if (!heading && !bullets.length) continue; // nothing to show
    blocks.push([heading && `## ${heading}`, ...bullets.map((b) => `- ${b}`)].filter(Boolean).join('\n'));
  }
  const quote = summary.quote ? clean(cleanQuoteText(summary.quote.text)) : ''; // also tidies quotes cached by earlier versions
  if (quote) {
    const from = opts.excerptFrom ? clean(opts.excerptFrom) : '';
    blocks.push([opts.excerptTitle && `## ${clean(opts.excerptTitle)}`, [`> “${quote}”`, ...(from ? ['>', `> — ${from}`] : [])].join('\n')].filter(Boolean).join('\n\n'));
  }
  return blocks.join('\n\n');
}
