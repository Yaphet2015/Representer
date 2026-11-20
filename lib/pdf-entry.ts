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
  const disablePanel = (id: number) => {
    void chrome.sidePanel.setOptions({ tabId: id, enabled: false });
    if (!chrome.sidePanel.close) return;
    // Official close() is Chrome 141+. tabId closes a tab-specific panel; from 145, close({ tabId })
    // rejects if only the global default_path panel is open, in which case windowId is the documented fallback.
    void chrome.sidePanel.close({ tabId: id }).catch(() => {
      void chrome.tabs.get(id).then((t) => {
        if (t.windowId !== undefined) return chrome.sidePanel.close({ windowId: t.windowId });
      }).catch(() => {});
    });
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
    disablePanel(id);
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
    if (info.url && known && !samePublicDocument(known.url, info.url)) {
      // A real document load reports status loading. Hash-only and same-document viewer URLs
      // keep the cached kind. History URL changes keep the kind and record the new URL (SPA).
      if (info.status === 'loading') dropDocument(id);
      else remember(id, { url: info.url, kind: known.kind });
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

  // Shared toolbar / keyboard path. Must stay synchronous through sidePanel.open(): that method
  // requires a user gesture (https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
  // and an `await` before open() drops it. `onCommand` provides the active tab; do not query first.
  const activate = (tab?: { id?: number; url?: string }) => {
    if (tab?.id === undefined) return;
    const id = tab.id, known = documents.get(id);
    // Kind is per tab: hash differences and same-tab history changes must not fall through
    // to the PDF classification sidebar. Real navigations clear the cache above.
    if (known?.kind === 'html') { disablePanel(id); void toggle(id); return; }
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) return;
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    // setOptions must not be awaited: open() has to stay in the user-gesture turn.
    void chrome.sidePanel.setOptions({ tabId: id, path: panelPath(id), enabled: true });
    void chrome.sidePanel.open({ tabId: id }).catch(() => {});
    void chrome.runtime.sendMessage({ type: 'rp-pdf-selected' }).catch(() => {});
  };
  chrome.action.onClicked.addListener(activate);
  chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === TOGGLE_COMMAND) activate(tab); });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (msg.type === PDF_DOCUMENT && sender.frameId === 0 && sender.tab?.id !== undefined && sender.url && 'kind' in msg && (msg.kind === 'html' || msg.kind === 'pdf')) {
      remember(sender.tab.id, { url: sender.url, kind: msg.kind });
      if (msg.kind === 'html') disablePanel(sender.tab.id);
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
      if (!stillGranted(requested, grant, generation)) return { kind: 'none' };
      try {
        const current = await chrome.tabs.get(requested);
        if (!current.url || publicPdfUrl(current.url) !== grant.url) return { kind: 'none' };
      } catch { return { kind: 'none' }; }
      if (receiver && !(doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'pdf')) {
        forget(requested);
        remember(requested, { url: tab.url, kind: 'html' });
        // Re-assert the global default is off in case open() raced ahead of tab-specific options
        // and enabled the manifest default_path panel.
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
