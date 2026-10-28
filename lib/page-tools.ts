/** read_page / search_page tools over the page attachment, as a pi-durable extension. */
import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { isInline, MAX_PAGE_CHARS, readPage, searchPage } from './attachment';

const text = (t: string) => ({ output: [{ type: 'text' as const, text: t }] });

/** The extension for a page, or null when the page is short enough to be embedded in the prompt. */
export function pageTools(content: string) {
  const page = content.slice(0, MAX_PAGE_CHARS);
  if (isInline(page)) return null;
  return defineExtension({
    name: 'page',
    tools: [
      defineTool({
        name: 'read_page',
        description: 'Read part of the attached page.md: by block ids ("p12" or "p12-p20") or by character offset/limit.',
        parameters: Type.Object({
          blocks: Type.Optional(Type.String({ description: 'Block id or inclusive range, e.g. "p12" or "p12-p20"' })),
          offset: Type.Optional(Type.Number({ description: 'Character offset to start from (when blocks is not given)' })),
          limit: Type.Optional(Type.Number({ description: 'Maximum characters to return' })),
        }),
        replay: 'safe',
        execute: async (args) => text(readPage(page, args)),
      }),
      defineTool({
        name: 'search_page',
        description: 'Find the blocks of the attached page.md that contain all the words of the query (case-insensitive).',
        parameters: Type.Object({ query: Type.String({ description: 'Words to look for' }) }),
        replay: 'safe',
        execute: async (args) => text(searchPage(page, args.query)),
      }),
    ],
  });
}
