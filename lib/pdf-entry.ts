import { PDF_CONTEXT, PDF_DOCUMENT, PDF_PING, PDF_VISUAL_CLOSE, publicPdfUrl, pdfCacheUrl, samePublicDocument, type PdfContext, isPdfAuthorization, type PdfAuthorization, isPdfPanelUrl } from './pdf-contract';
import { PDF_MAX_PAGES } from './pdf-text';
import { closeVisualSession, setVisualSession } from './pdf-visual-sessions';
import { createPdfVisualSession } from './pdf-visual';
import { PDF_VISUAL_PORT, isPdfVisualRegister, panelRenderBackend } from './pdf-visual-port';

/** Same manifest command as the webpage overlay (chrome.commands). Reserved `_execute_action` is not used: it does not fire onCommand and would drop existing user bindings. */
export const TOGGLE_COMMAND = 'toggle-overlay';

function panelPath(tabId: number): string {
  return `pdf-panel.html?tab=${tabId}`;
}

function fromPanel(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && isPdfPanelUrl(sender.url, chrome.runtime.getURL('/pdf-panel.html'));
}

/** Session-scoped user-action grants. No free-form fetch RPC, no automatic network requests. */
export function installPdfEntry(toggle: (id?: number) => Promise<void>) {
  type DocumentKind = { url: string; kind: 'html' | 'pdf' };
  const documents = new Map<number, DocumentKind>();
  const grants = new Map<number, PdfAuthorization>();
  const generations = new Map<number, number>();
  const key = (id: number) => `pdf-authorization:${id}`;
  const documentKey = (id: number) => `pdf-document:${id}`;
  const isDocumentKind = (v: unknown): v is DocumentKind & { tabId: number } =>
    !!v && typeof v === 'object' && 'tabId' in v && Number.isInteger(v.tabId)
    && 'url' in v && typeof v.url === 'string'
    && 'kind' in v && (v.kind === 'html' || v.kind === 'pdf');
  // Session storage survives service-worker suspension, not a browser restart. No PDF bytes/text or settings here.
  // HTML announcements only disable this tab's panel. Do not close({ windowId }): that can
  // affect a global panel, and a background announce is not evidence we opened one.
  const disableTabPanel = (id: number) => {
    void chrome.sidePanel.setOptions({ tabId: id, enabled: false });
  };
  const closeTabPanel = (id: number) => {
    disableTabPanel(id);
    if (chrome.sidePanel.close) void chrome.sidePanel.close({ tabId: id }).catch(() => {});
  };
  const remember = (id: number, rec: DocumentKind) => {
    documents.set(id, rec);
    void chrome.storage.session.set({ [documentKey(id)]: { tabId: id, url: rec.url, kind: rec.kind } });
  };
  const dropDocument = (id: number) => {
    documents.delete(id);
    void chrome.storage.session.remove(documentKey(id));
  };
  const forget = (id: number) => {
    const url = grants.get(id)?.url;
    dropDocument(id); grants.delete(id); generations.set(id, (generations.get(id) ?? 0) + 1);
    void chrome.storage.session.remove(key(id));
    closeTabPanel(id);
    if (url) void closeVisualSession(pdfCacheUrl(url));
  };
  const adopt = (grant: PdfAuthorization) => {
    grants.set(grant.tabId, grant);
    if (!generations.has(grant.tabId)) generations.set(grant.tabId, 0);
  };
  const loadGrant = async (id: number): Promise<PdfAuthorization | null> => {
    const memory = grants.get(id);
    if (memory) return memory;
    const stored: unknown = (await chrome.storage.session.get(key(id)))[key(id)];
    if (!isPdfAuthorization(stored) || stored.tabId !== id) return null;
    adopt(stored);
    return stored;
  };
  const stillGranted = (id: number, grant: PdfAuthorization, generation: number | undefined) =>
    grants.get(id) === grant && generations.get(id) === generation;

  // Manifest default_path would otherwise open a global panel that follows ordinary tabs.
  void chrome.sidePanel.setOptions({ enabled: false });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  // Re-hydrate in-memory grants after a worker restart so visual sessions can use the same token.
  void chrome.storage.session.get(null).then((all) => {
    for (const v of Object.values(all ?? {})) {
      if (isPdfAuthorization(v) && !grants.has(v.tabId)) adopt(v);
      if (isDocumentKind(v) && !documents.has(v.tabId)) documents.set(v.tabId, { url: v.url, kind: v.kind });
    }
  });

  chrome.tabs.onRemoved.addListener(forget);
  // Revoke only when this tab leaves the granted document. `status: 'loading'` alone is not a
  // navigation: Chrome's PDF viewer (and hash-only updates) emit it without a new document, and
  // forgetting here is what made every Read fail after the first context() succeeded.
  chrome.tabs.onUpdated.addListener((id, info) => {
    const known = documents.get(id);
    // Kind cache follows the document, not the grant. A same-URL reload can become a native
    // PDF (or the reverse); loading starts a new document, so drop the kind. Do not forget a
    // grant on loading alone — that older bug is independent of this cache.
    if (info.status === 'loading') dropDocument(id);
    else if (info.url && known && !samePublicDocument(known.url, info.url)) {
      remember(id, { url: info.url, kind: known.kind });
    }
    const grant = grants.get(id);
    if (!grant || !info.url) return;
    const next = publicPdfUrl(info.url);
    if (next === grant.url) return;
    if (next) { forget(id); return; }
    void chrome.tabs.get(id).then((t) => {
      if (!stillGranted(id, grant, generations.get(id))) return;
      if (!t.url || publicPdfUrl(t.url) !== grant.url) forget(id);
    }).catch(() => { if (stillGranted(id, grant, generations.get(id))) forget(id); });
  });

  // Open the tab-specific panel in the current turn only after we already know this is a PDF
  // (cached kind, or a classify callback with no HTML receiver). Do not await here: sidePanel.open()
  // needs the user-gesture token still active in this turn
  // (https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
  const openSidebar = (id: number, url: string) => {
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    void chrome.sidePanel.setOptions({ tabId: id, path: panelPath(id), enabled: true });
    void chrome.sidePanel.open({ tabId: id }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'rp-pdf-selected' }).catch(() => {});
  };
  // Callback-form tabs.sendMessage, not await. APIRequestHandler captures the interaction token
  // when the request starts and CreateScopedInteraction around the callback in CompleteRequestImpl;
  // an `await` continuation can run after that scope ends. Chrome 119 includes this path
  // (callback overload since 99; sidePanel.open since 116). Unconditional open-then-classify was
  // the HTML dual-UI root cause and is not used.
  const classify = (id: number, done: (result: { receiver: false } | { receiver: true; kind: 'html' | 'pdf' | 'other' }) => void) => {
    let settled = false;
    const finish = (result: { receiver: false } | { receiver: true; kind: 'html' | 'pdf' | 'other' }) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    try {
      chrome.tabs.sendMessage(id, { type: PDF_PING }, { frameId: 0 }, (doc) => {
        if (chrome.runtime.lastError) { finish({ receiver: false }); return; }
        if (doc && typeof doc === 'object' && 'kind' in doc && (doc.kind === 'html' || doc.kind === 'pdf')) {
          finish({ receiver: true, kind: doc.kind });
          return;
        }
        finish({ receiver: true, kind: 'other' });
      });
    } catch {
      finish({ receiver: false });
    }
  };
  const activate = (tab?: { id?: number; url?: string; status?: string }) => {
    if (tab?.id === undefined) return;
    const id = tab.id, known = documents.get(id);
    if (known?.kind === 'html') { void toggle(id); return; }
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) return;
    // A still-loading document is not "a PDF we can open". Do not guess from a public HTTP(S) URL.
    if (tab.status === 'loading') return;
    if (known?.kind === 'pdf') { openSidebar(id, url); return; }
    classify(id, (result) => {
      if (result.receiver && result.kind === 'html') {
        remember(id, { url: tab.url ?? url, kind: 'html' });
        void toggle(id);
        return;
      }
      if (result.receiver && result.kind === 'pdf') {
        remember(id, { url: tab.url ?? url, kind: 'pdf' });
        openSidebar(id, url);
        return;
      }
      // Fully loaded (or status omitted by onCommand) with no content-script receiver: native PDF
      // fallback, including public URLs with no .pdf suffix. A receiver that did not report a kind
      // is treated as a webpage, not a PDF.
      if (!result.receiver) { openSidebar(id, url); return; }
      remember(id, { url: tab.url ?? url, kind: 'html' });
      void toggle(id);
    });
  };
  chrome.action.onClicked.addListener(activate);
  chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === TOGGLE_COMMAND) activate(tab); });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (msg.type === PDF_DOCUMENT && sender.frameId === 0 && sender.tab?.id !== undefined && sender.url && 'kind' in msg && (msg.kind === 'html' || msg.kind === 'pdf')) {
      remember(sender.tab.id, { url: sender.url, kind: msg.kind });
      if (msg.kind === 'html') disableTabPanel(sender.tab.id);
      return false;
    }
    if (msg.type !== PDF_CONTEXT || !fromPanel(sender)) return false;
    const requested = 'tabId' in msg && typeof msg.tabId === 'number' && Number.isInteger(msg.tabId) ? msg.tabId : undefined;
    void (async (): Promise<PdfContext> => {
      // The panel is tab-specific. Do not use active/lastFocusedWindow: when the sidebar has
      // focus, that query can return a different tab (or none) and look like an expired grant.
      if (requested === undefined) return { kind: 'none' };
      const grant = await loadGrant(requested);
      const generation = generations.get(requested);
      if (!grant || grant.tabId !== requested || Date.now() - grant.at > 30 * 60_000 || grant.at > Date.now() + 1000) return { kind: 'none' };
      let tab: chrome.tabs.Tab;
      try { tab = await chrome.tabs.get(requested); } catch { return { kind: 'none' }; }
      if (!tab.url || publicPdfUrl(tab.url) !== grant.url) return { kind: 'none' };
      let doc: unknown; let receiver = false;
      try { doc = await chrome.tabs.sendMessage(requested, { type: PDF_PING }, { frameId: 0 }); receiver = true; } catch { /* native PDF has no receiver */ }
      try {
        const current = await chrome.tabs.get(requested);
        if (!current.url || publicPdfUrl(current.url) !== grant.url) return { kind: 'none' };
      } catch { return { kind: 'none' }; }
      // Re-check and consume after the last await so two in-flight context requests cannot
      // both toggle the overlay (the 200ms content-script de-dupe is not a grant lock).
      if (!stillGranted(requested, grant, generation)) return { kind: 'none' };
      if (receiver && !(doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'pdf')) {
        forget(requested);
        remember(requested, { url: tab.url, kind: 'html' });
        void chrome.sidePanel.setOptions({ enabled: false });
        await toggle(requested);
        return { kind: 'web' };
      }
      return { kind: 'pdf', grant: { tabId: grant.tabId, url: grant.url, token: grant.token } };
    })().then(reply, () => reply({ kind: 'none' }));
    return true;
  });

  const grantFor = (url: string, token: string) => [...grants.values()].find((g) => g.url === url && g.token === token && Date.now() - g.at <= 30 * 60_000 && g.at <= Date.now() + 1000);
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg) || !fromPanel(sender)) return false;
    if (msg.type === PDF_VISUAL_CLOSE && 'url' in msg && typeof msg.url === 'string' && 'token' in msg && typeof msg.token === 'string') {
      if (!grantFor(msg.url, msg.token)) { reply({ ok: false, error: 'Authorization expired.' }); return true; }
      void closeVisualSession(pdfCacheUrl(msg.url)).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String((e as Error).message ?? e) }));
      return true;
    }
    return false;
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PDF_VISUAL_PORT) return;
    const sender = port.sender;
    if (!sender || !fromPanel(sender)) { port.disconnect(); return; }
    const onMessage = (msg: unknown) => {
      if (!isPdfVisualRegister(msg)) return;
      if (!grantFor(msg.url, msg.token) || msg.catalog.length < 1 || msg.catalog.length > PDF_MAX_PAGES) {
        port.postMessage({ type: 'error', id: 0, error: 'Authorization expired.' });
        return;
      }
      const session = createPdfVisualSession({ catalog: msg.catalog, pageByAnchor: msg.pageByAnchor, backend: panelRenderBackend(port) });
      void setVisualSession(pdfCacheUrl(msg.url), session);
    };
    port.onMessage.addListener(onMessage);
  });
  return { activate };
}
