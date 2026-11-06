/**
 * Read-only rich text (contenteditable="false", e.g. a Draft.js article view with a cover image) is the
 * article and must reach the summarizer; only regions the reader can actually type into are scrubbed.
 * Synthetic markup; not copied from any real page.
 */
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractDocument } from '../lib/extract';

function page(body: string) {
  const { document, window } = parseHTML(`<!doctype html><html><head><title>Post</title></head><body>${body}</body></html>`);
  (window.Element.prototype as any).getClientRects = function () { return [{}]; };
  return document as unknown as Document;
}

const P = ['First synthetic paragraph about agents writing code and reviewing it carefully in teams.',
  'Second synthetic paragraph explains how engineers spend review time on intent and design.',
  'Third synthetic paragraph closes with advice about tests, lint rules and shared conventions.'];
const draft = (attr: string) => `<main><article>
  <img src="https://img.example/cover.jpg" alt="cover">
  <div data-testid="title">Synthetic article title for testing</div>
  <div class="DraftEditor-root"><div class="public-DraftEditor-content" ${attr} role="textbox"><div data-contents="true">
    ${P.map((p) => `<div class="public-DraftStyleDefault-block"><span>${p}</span></div>`).join('')}
  </div></div></div></article></main>`;

describe('read-only rich text survives the privacy scrub', () => {
  for (const attr of ['contenteditable="false"', 'contenteditable="FALSE"', 'contenteditable=" false "']) {
    it(`keeps a cover-image article whose body is ${attr}`, () => {
      const r = extractDocument(page(draft(attr)), 'https://example.com/article/1');
      for (const p of P) expect(r.content).toContain(p);
    });
  }

  it('an unknown value inherits: read-only when the parent is read-only', () => {
    const r = extractDocument(page(`<article><div contenteditable="false"><p contenteditable="bogus">${P[0]}</p><p>${P[1]}</p></div></article>`), 'https://e.x/');
    expect(r.content).toContain(P[0]);
  });
});

describe('editable regions are still scrubbed', () => {
  const SECRET = 'typed secret draft words that must never be summarized';
  for (const attr of ['contenteditable', 'contenteditable=""', 'contenteditable="true"', 'contenteditable="TRUE"', 'contenteditable="plaintext-only"']) {
    it(`drops text in ${attr}`, () => {
      const r = extractDocument(page(`<article><h1>Public heading for this page</h1><p>${P[0]}</p><p>${P[1]}</p><div ${attr}><p>${SECRET}</p></div></article>`), 'https://e.x/');
      expect(r.content).toContain(P[0]);
      expect(r.content).not.toContain('typed secret');
    });
  }

  it('an editable island inside read-only text is scrubbed, the read-only text kept', () => {
    const r = extractDocument(page(`<article><div contenteditable="false"><p>${P[0]}</p><p>${P[1]}</p><div contenteditable="true"><p>${SECRET}</p></div></div></article>`), 'https://e.x/');
    expect(r.content).toContain(P[0]);
    expect(r.content).not.toContain('typed secret');
  });

  it('a child with an unknown value inherits editability from an editable parent', () => {
    const r = extractDocument(page(`<article><p>${P[0]}</p><p>${P[1]}</p><div contenteditable="true"><p contenteditable="bogus">${SECRET}</p></div></article>`), 'https://e.x/');
    expect(r.content).not.toContain('typed secret');
  });

  it('form fields stay scrubbed next to read-only text', () => {
    const r = extractDocument(page(`${draft('contenteditable="false"')}<input type="password" value="pw-value-123456"><textarea>private notes typed by the user</textarea>`), 'https://e.x/');
    expect(r.content).toContain(P[0]);
    expect(r.content).not.toMatch(/pw-value|private notes/);
  });
});
