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
export function installPdfEntry(toggle: (id?: number, documentId?: string) => Promise<void>) {
  type DocumentKind = { url: string; kind: 'html' | 'pdf' };
  const documents = new Map<number, DocumentKind>();
  const grants = new Map<number, PdfAuthorization>();
  const generations = new Map<number, number>();
  const navigationVersions = new Map<number, number>();
  const touched = new Set<number>();
  const recovering = new Map<number, number>();
  const warnings = new Map<number, number>();
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
    touched.add(id);
    documents.set(id, rec);
    void chrome.storage.session.set({ [documentKey(id)]: { tabId: id, url: rec.url, kind: rec.kind } });
  };
  const dropDocument = (id: number) => {
    touched.add(id);
    documents.delete(id);
    void chrome.storage.session.remove(documentKey(id));
  };
  const forget = (id: number) => {
    const url = grants.get(id)?.url;
    navigationVersions.set(id, (navigationVersions.get(id) ?? 0) + 1);
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
      if (isDocumentKind(v) && !touched.has(v.tabId) && !documents.has(v.tabId)) documents.set(v.tabId, { url: v.url, kind: v.kind });
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
    if (info.status === 'loading') {
      navigationVersions.set(id, (navigationVersions.get(id) ?? 0) + 1);
      dropDocument(id);
    }
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

  const clearError = (id: number) => {
    void chrome.action.setBadgeText({ tabId: id, text: '' }).catch(() => {});
    void chrome.action.setTitle({ tabId: id, title: 'Representer' }).catch(() => {});
  };
  const entryError = (id: number, code: string, message: string) => {
    // Do not log URLs, document contents, authorization tokens, or raw API errors.
    const previous = warnings.get(id);
    if (previous === undefined || Date.now() - previous >= 60_000) {
      warnings.set(id, Date.now());
      console.warn('[representer] entry failed', { code });
    }
    void chrome.action.setBadgeText({ tabId: id, text: '!' }).catch(() => {});
    void chrome.action.setTitle({ tabId: id, title: `Representer: ${message}` }).catch(() => {});
  };
  chrome.tabs.onRemoved.addListener((id) => { warnings.delete(id); recovering.delete(id); });

  const openSidebar = (id: number, url: string, version: number) => {
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    const failed = (error: unknown) => {
      if (grants.get(id) !== grant || (navigationVersions.get(id) ?? 0) !== version) return;
      grants.delete(id);
      void chrome.storage.session.remove(key(id));
      const gesture = error instanceof Error && error.message.includes('user gesture');
      entryError(id, gesture ? 'pdf-user-gesture' : 'pdf-open', gesture
        ? 'Chrome did not accept the shortcut action. Click the toolbar button to open the PDF panel.'
        : 'The PDF panel could not open. Click the toolbar button to retry.');
    };
    // Configure and open in the gestured API callback; no Promise continuation before open().
    void chrome.sidePanel.setOptions({ tabId: id, path: panelPath(id), enabled: true }).catch(failed);
    void chrome.sidePanel.open({ tabId: id }).then(() => {
      if (grants.get(id) === grant && (navigationVersions.get(id) ?? 0) === version) {
        remember(id, { url, kind: 'pdf' });
        clearError(id);
      }
    }, failed);
    void chrome.runtime.sendMessage({ type: 'rp-pdf-selected' }).catch(() => {});
  };

  const showWebpage = async (id: number, url: string, version: number, documentId?: string) => {
    if (recovering.get(id) === version) return;
    recovering.set(id, version);
    const current = () => (navigationVersions.get(id) ?? 0) === version;
    try {
      // A cached HTML kind does not imply that the current extension's script is still alive.
      try { await chrome.tabs.sendMessage(id, { type: PDF_PING }, documentId ? { documentId } : { frameId: 0 }); }
      catch {
        // Only a positively inspected HTML document may reach this recovery path. Pin the
        // injection to its document so a navigation cannot inject into a different page.
        if (!documentId || !current()) throw new Error('Document unavailable');
        await chrome.scripting.executeScript({
          target: { tabId: id, documentIds: [documentId] },
          files: ['content-scripts/content.js'],
        });
      }
      if (!current()) return;
      remember(id, { url, kind: 'html' });
      disableTabPanel(id);
      await toggle(id, documentId);
      if (current()) clearError(id);
    } catch {
      if (current()) entryError(id, 'webpage-unavailable', 'The webpage panel could not load. Chrome may have denied access to this document.');
    } finally { if (recovering.get(id) === version) recovering.delete(id); }
  };

  const activate = (tab?: { id?: number; url?: string; status?: string }) => {
    // Keep the original command tab. Do not guess a different active tab/window.
    if (tab?.id === undefined) return;
    const id = tab.id;
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) return;
    if (tab.status === 'loading') {
      entryError(id, 'document-loading', 'The document is still loading. Try again when it is ready.');
      return;
    }
    const version = navigationVersions.get(id) ?? 0;
    const known = documents.get(id);
    if (known?.kind === 'pdf' && samePublicDocument(known.url, url)) {
      openSidebar(id, url, version);
      return;
    }
    // First API request in this user action. No receiver, injection failure, filename, and
    // HTTP(S) URL are never evidence of PDF. Read the top document's actual MIME instead.
    chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      injectImmediately: true,
      func: () => ({ url: location.href, mime: document.contentType }),
    }, (results) => {
      const error = chrome.runtime.lastError;
      if ((navigationVersions.get(id) ?? 0) !== version) return;
      const top = results?.find((r) => r.frameId === 0);
      const value: unknown = top?.result;
      if (error || !top || !value || typeof value !== 'object'
        || !('url' in value) || typeof value.url !== 'string' || !samePublicDocument(value.url, url)
        || !('mime' in value) || typeof value.mime !== 'string' || !value.mime) {
        entryError(id, 'document-unavailable', 'Chrome could not inspect this document. No PDF panel was opened.');
        return;
      }
      if (value.mime.toLowerCase() === 'application/pdf') {
        // Positive MIME remains useful if Chrome rejects this first callback's gesture:
        // a retry can open synchronously, without reclassifying an already confirmed PDF.
        remember(id, { url: value.url, kind: 'pdf' });
        openSidebar(id, url, version);
      } else {
        void showWebpage(id, value.url, version, top.documentId);
      }
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
