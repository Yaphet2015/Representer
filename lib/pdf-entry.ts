import { PDF_CONTEXT, PDF_DOCUMENT, PDF_PING, publicPdfUrl, type PdfContext, isPdfAuthorization, type PdfAuthorization } from './pdf-contract';

/** Session-scoped user-action grants. No free-form fetch RPC, no automatic network requests. */
export function installPdfEntry(toggle: (id?: number) => Promise<void>) {
  const documents = new Map<number, { url: string; kind: 'html' | 'pdf' }>();
  const grants = new Map<number, PdfAuthorization>();
  const generations = new Map<number, number>();
  const key = (id: number) => `pdf-authorization:${id}`;
  // Session storage survives service-worker suspension, not a browser restart. No PDF bytes/text or settings here.
  const forget = (id: number) => {
    documents.delete(id); grants.delete(id); generations.set(id, (generations.get(id) ?? 0) + 1);
    void chrome.storage.session.remove(key(id));
  };
  chrome.tabs.onRemoved.addListener(forget);
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'loading' || (info.url && publicPdfUrl(info.url) !== grants.get(id)?.url)) forget(id); });
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    const id = tab.id, known = documents.get(id);
    if (known?.kind === 'html' && known.url === tab.url) { void toggle(id); return; }
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) return;
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    // Must be called directly in this gesture, not after HEAD/fetch. Unknown pages are identified in the panel.
    void chrome.sidePanel.open({ tabId: id }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'rp-pdf-selected' }).catch(() => {});
  });
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (msg.type === PDF_DOCUMENT && sender.frameId === 0 && sender.tab?.id !== undefined && sender.url && 'kind' in msg && (msg.kind === 'html' || msg.kind === 'pdf')) {
      documents.set(sender.tab.id, { url: sender.url, kind: msg.kind }); return false;
    }
    if (msg.type !== PDF_CONTEXT || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('/pdf-panel.html')) return false;
    void (async (): Promise<PdfContext> => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id === undefined || !tab.url) return { kind: 'none' };
      const generation = generations.get(tab.id);
      const stored: unknown = grants.get(tab.id) ?? (await chrome.storage.session.get(key(tab.id)))[key(tab.id)];
      const grant = isPdfAuthorization(stored) ? stored : null;
      if (!grant || grant.tabId !== tab.id || publicPdfUrl(tab.url) !== grant.url || Date.now() - grant.at > 30 * 60_000 || grant.at > Date.now() + 1000 || generations.get(tab.id) !== generation) return { kind: 'none' };
      let doc: unknown; let receiver = false;
      try { doc = await chrome.tabs.sendMessage(tab.id, { type: PDF_PING }, { frameId: 0 }); receiver = true; } catch { /* native PDF has no receiver */ }
      const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (generations.get(tab.id) !== generation || current?.id !== tab.id || !current.url || publicPdfUrl(current.url) !== grant.url) return { kind: 'none' }; // navigation while checking
      if (receiver && !(doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'pdf')) {
        forget(tab.id);
        documents.set(tab.id, { url: tab.url, kind: 'html' });
        await toggle(tab.id);
        // Chrome 141+ can close a temporary classification sidebar. On 116–140 show a clear close instruction.
        if (chrome.sidePanel.close) void chrome.sidePanel.close({ tabId: tab.id }).catch(() => {});
        return { kind: 'web' };
      }
      return { kind: 'pdf', grant: { tabId: grant.tabId, url: grant.url, token: grant.token } };
    })().then(reply, () => reply({ kind: 'none' }));
    return true;
  });
}
