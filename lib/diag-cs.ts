/**
 * DEV-ONLY diagnostics for iframe extraction → anchor → locate. Compiled in only when VITE_RP_DIAG=1
 * (see wxt.config.ts); production builds drop the call site and this module. Answers only the extension's
 * own diag page (sender.url is chrome-extension://<own id>/diag.html), only in the top frame, and only
 * runs the product's own extract and jump code — no arbitrary DOM queries or script evaluation.
 */
import { markerChunks, markerReport } from './extract';
import { extractPageWithFrames, getLastMergedPage, jumpToFingerprintTraced } from './frame-bridge';
import { jumpTo, keyOf, liveIndex, resolveItem } from './locate';
import { diagBlockTexts } from './frame-bridge';

declare const __RP_BUILD__: string;
export const DIAG_EXTRACT = 'rp-diag-extract';
export const DIAG_JUMP = 'rp-diag-jump';

const fromDiagPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === 'string'
  && sender.url.startsWith(chrome.runtime.getURL('/diag.html'));

export function installDiag() {
  if (window !== window.top) return;
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || (msg.type !== DIAG_EXTRACT && msg.type !== DIAG_JUMP)) return false;
    if (!fromDiagPage(sender)) { reply({ ok: false, error: 'diag: sender rejected' }); return false; }
    (async () => {
      if (msg.type === DIAG_EXTRACT) {
        const page = await extractPageWithFrames();
        const chunks = markerChunks(page.content);
        const report = markerReport(page.content, page.anchors);
        const blocks = Object.entries(page.anchors).map(([id, fp]) => ({
          id, sk: fp.sk, frameId: fp.f, o: fp.o, head: fp.head,
          chunk: chunks.get(id) ?? '',
          flag: report.missing.includes(id) ? 'missing' : report.mismatched.includes(id) ? 'mismatch' : '',
        })).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
        // Full per-id triple for offline analysis: model text under the id ↔ DOM block text at fp.o in its source.
        const topTexts = diagBlockTexts(document);
        const textsFor = (sk?: string) => (!sk || sk === 'top' ? topTexts : page.sources.find((s) => s.sk === sk)?.diagBlocks ?? []);
        const triples = blocks.map((b) => {
          const modelText = chunks.get(b.id) ?? '';
          const domText = textsFor(b.sk)[b.o] ?? '';
          const mk = keyOf(modelText), dk = keyOf(domText);
          return { id: b.id, sk: b.sk ?? 'top', o: b.o, flag: b.flag, modelText, domText,
            keyEqual: mk === dk, domKeyInModel: !!dk && mk.includes(dk), modelKeyInDom: !!mk && dk.includes(mk) };
        });
        const sources = page.sources.map(({ diagBlocks, ...s }) => ({ ...s, domBlockCount: diagBlocks?.length ?? null }));
        return { ok: true, build: __RP_BUILD__, href: location.href, title: page.title, chars: page.content.length,
          sources, notices: page.notices, report, blocks, triples, content: page.content, anchors: page.anchors, topBlockCount: topTexts.length };
      }
      const page = getLastMergedPage();
      const fp = page?.anchors[String(msg.id)];
      if (!page || !fp) return { ok: false, build: __RP_BUILD__, error: `no anchor ${msg.id} in the last extract; extract first` };
      if (!fp.sk || fp.sk === 'top') {
        // same path as the Overview's top-document click
        const el = resolveItem(liveIndex(document), page.anchors, { anchor: String(msg.id), text: '' });
        if (el) jumpTo(el);
        return { ok: true, build: __RP_BUILD__, trace: { result: el ? 'ok' : 'missing', route: 'top', sk: 'top', matched: (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) } };
      }
      return { ok: true, build: __RP_BUILD__, trace: await jumpToFingerprintTraced(fp) };
    })().then(reply, (e) => reply({ ok: false, build: __RP_BUILD__, error: String(e?.message ?? e) }));
    return true;
  });
}
