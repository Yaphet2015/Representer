import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractDocument, scrubSensitiveFields } from '../lib/extract';
import { numberBlocks } from '../lib/locate';

function page(body: string) {
  const { document, window } = parseHTML(`<!doctype html><html><head><title>Hello</title></head><body>${body}</body></html>`);
  (window.Element.prototype as any).getClientRects = function () { return [{}]; };
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) { return this.getAttribute('contenteditable') === 'true' || this.getAttribute('contenteditable') === ''; },
  });
  return document as unknown as Document;
}

describe('extractDocument', () => {
  it('still returns marked blocks for an ordinary article (Defuddle or fallback)', () => {
    const doc = page(`
      <article>
        <h1>Hello world article title for tests</h1>
        <p>First paragraph explains the topic with enough letters to keep.</p>
        <p>Second paragraph continues the idea for readers and summarizers alike.</p>
      </article>`);
    const r = extractDocument(doc, 'https://example.com/post');
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.content).toMatch(/\[p\d+\]/);
    expect(r.content.toLowerCase()).toMatch(/paragraph/);
    expect(Object.keys(r.anchors).length).toBeGreaterThan(0);
  });

  it('does not include input/textarea/contenteditable values in extracted text', () => {
    const doc = page(`
      <article>
        <h1>Public heading with enough text yes</h1>
        <p>Public paragraph that should remain visible to the summarizer today.</p>
        <input type="password" value="s3cret-password-value" />
        <textarea>private notes typed by the user go here</textarea>
        <div contenteditable="true">secret draft that must not be summarized</div>
      </article>`);
    const live = doc.body!.innerHTML;
    const r = extractDocument(doc, 'https://example.com/form');
    expect(doc.body!.innerHTML).toBe(live); // live page untouched
    expect(r.content).not.toMatch(/s3cret-password-value/);
    expect(r.content).not.toMatch(/private notes typed/);
    expect(r.content).not.toMatch(/secret draft/);
    expect(r.content).toMatch(/Public paragraph/);
  });
});

describe('scrubSensitiveFields', () => {
  it('clears controls on a clone only', () => {
    const doc = page(`<input value="abc" /><textarea>xyz</textarea><div contenteditable="true">draft</div>`);
    const clone = doc.cloneNode(true) as Document;
    scrubSensitiveFields(clone);
    expect((clone.querySelector('input') as HTMLInputElement).getAttribute('value')).toBe('');
    expect(clone.querySelector('textarea')!.textContent).toBe('');
    expect(clone.querySelector('div')!.textContent).toBe('');
    expect(clone.querySelector('div')!.hasAttribute('contenteditable')).toBe(false);
    expect((doc.querySelector('input') as HTMLInputElement).getAttribute('value')).toBe('abc');
  });
});

describe('numberBlocks skips contenteditable', () => {
  it('does not treat contenteditable regions as locatable blocks', () => {
    const doc = page(`<p>Visible paragraph with enough letters for a block.</p><div contenteditable="true">secret</div>`);
    const { blocks } = numberBlocks(doc);
    expect(blocks.map((b) => b.textContent)).toEqual(['Visible paragraph with enough letters for a block.']);
  });
});
