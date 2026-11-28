import { CONTENT_ENTRY_TRACE, isContentEntryStage, recordEntryTrace, type EntryErrorCode, type EntryTraceReason } from './pdf-entry-trace';
import { PDF_CONTEXT, PDF_DOCUMENT, PDF_PING, PDF_VISUAL_CLOSE, publicPdfUrl, pdfCacheUrl, samePublicDocument, type PdfContext, isPdfAuthorization, type PdfAuthorization, isPdfPanelUrl } from './pdf-contract';
import { PDF_MAX_PAGES } from './pdf-text';
import { closeVisualSession, setVisualSession } from './pdf-visual-sessions';
import { createPdfVisualSession } from './pdf-visual';
import { PDF_VISUAL_PORT, isPdfVisualRegister, panelRenderBackend } from './pdf-visual-port';
import { messages, resolveLang, uiLanguage, type Lang } from './i18n';
import { KEYS, loadSettings, onStorageChange } from './storage';

const ENTRY_TRACE = import.meta.env.VITE_RP_ENTRY_DIAG === '1';

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
  if (ENTRY_TRACE) recordEntryTrace({ stage: 'entry-install' });
  let lang: Lang = resolveLang('auto', uiLanguage());
  const refreshLang = () => loadSettings().then((s) => { lang = resolveLang(s.lang, uiLanguage()); }).catch(() => {});
  const changed = (chrome.storage as { onChanged?: unknown } | undefined)?.onChanged;
  if (changed) onStorageChange([KEYS.settings], () => { void refreshLang(); });
  const t = () => messages(lang);
  type EntryMsg = 'pdfEntryShortcutRejected' | 'pdfEntryPanelOpenFailed' | 'pdfEntryWebpageUnavailable' | 'pdfEntryDocumentLoading' | 'pdfEntryDocumentUnavailable';
  type DocumentKind = { url: string; kind: 'html' | 'pdf' };
  const documents = new Map<number, DocumentKind>();
  const inspectedDocuments = ENTRY_TRACE ? new Map<number, string>() : undefined;
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
  const disableTabPanel = (id: number, reason: EntryTraceReason) => {
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'disable-request', tabId: id, reason, knownKind: documents.get(id)?.kind, hasGrant: grants.has(id) });
    const result = chrome.sidePanel.setOptions({ tabId: id, enabled: false });
    if (ENTRY_TRACE) void result.then(() => recordEntryTrace({ stage: 'disable-resolved', tabId: id, reason }), (error: unknown) => {
      recordEntryTrace({ stage: 'disable-rejected', tabId: id, reason }); throw error;
    });
  };
  const closeTabPanel = (id: number, reason: EntryTraceReason) => {
    disableTabPanel(id, reason);
    if (chrome.sidePanel.close) {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'close-request', tabId: id, reason });
      if (ENTRY_TRACE) void chrome.sidePanel.close({ tabId: id }).then(
        () => recordEntryTrace({ stage: 'close-resolved', tabId: id, reason }),
        () => recordEntryTrace({ stage: 'close-rejected', tabId: id, reason }));
      else void chrome.sidePanel.close({ tabId: id }).catch(() => {});
    }
  };
  const disableGlobalPanel = (reason: EntryTraceReason) => {
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'global-disable-request', reason });
    const result = chrome.sidePanel.setOptions({ enabled: false });
    if (ENTRY_TRACE) void result.then(() => recordEntryTrace({ stage: 'global-disable-resolved', reason }), (error: unknown) => {
      recordEntryTrace({ stage: 'global-disable-rejected', reason }); throw error;
    });
  };
  const remember = (id: number, rec: DocumentKind) => {
    touched.add(id);
    documents.set(id, rec);
    void chrome.storage.session.set({ [documentKey(id)]: { tabId: id, url: rec.url, kind: rec.kind } });
  };
  const dropDocument = (id: number) => {
    touched.add(id);
    documents.delete(id);
    inspectedDocuments?.delete(id);
    void chrome.storage.session.remove(documentKey(id));
  };
  const forget = (id: number, reason: EntryTraceReason) => {
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'forget', tabId: id, reason, knownKind: documents.get(id)?.kind, hasGrant: grants.has(id) });
    const url = grants.get(id)?.url;
    navigationVersions.set(id, (navigationVersions.get(id) ?? 0) + 1);
    dropDocument(id); grants.delete(id); generations.set(id, (generations.get(id) ?? 0) + 1);
    void chrome.storage.session.remove(key(id));
    closeTabPanel(id, reason);
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
  disableGlobalPanel('startup');
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  // Re-hydrate in-memory grants after a worker restart so visual sessions can use the same token.
  void chrome.storage.session.get(null).then((all) => {
    for (const v of Object.values(all ?? {})) {
      if (isPdfAuthorization(v) && !grants.has(v.tabId)) adopt(v);
      if (isDocumentKind(v) && !touched.has(v.tabId) && !documents.has(v.tabId)) documents.set(v.tabId, { url: v.url, kind: v.kind });
    }
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'hydrate-done' });
  });

  chrome.tabs.onRemoved.addListener((id) => forget(id, 'tab-removed'));
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
    if (next) { forget(id, 'navigation-public'); return; }
    void chrome.tabs.get(id).then((t) => {
      if (!stillGranted(id, grant, generations.get(id))) return;
      if (!t.url || publicPdfUrl(t.url) !== grant.url) forget(id, 'navigation-checked');
    }).catch(() => { if (stillGranted(id, grant, generations.get(id))) forget(id, 'navigation-tab-missing'); });
  });

  const clearError = (id: number) => {
    void chrome.action.setBadgeText({ tabId: id, text: '' }).catch(() => {});
    void chrome.action.setTitle({ tabId: id, title: 'Representer' }).catch(() => {});
  };
  const entryError = (id: number, code: EntryErrorCode, key: EntryMsg) => {
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'entry-error', tabId: id, code });
    // Do not log URLs, document contents, authorization tokens, or raw API errors.
    const previous = warnings.get(id);
    if (previous === undefined || Date.now() - previous >= 60_000) {
      warnings.set(id, Date.now());
      console.warn('[representer] entry failed', { code });
    }
    void chrome.action.setBadgeText({ tabId: id, text: '!' }).catch(() => {});
    void refreshLang().finally(() => {
      const m = t();
      void chrome.action.setTitle({ tabId: id, title: m.pdfToolbarTitle(m[key]) }).catch(() => {});
    });
  };
  chrome.tabs.onRemoved.addListener((id) => { warnings.delete(id); recovering.delete(id); });

  const openSidebar = (id: number, url: string, version: number) => {
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'open-request', tabId: id });
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    const failed = (error: unknown) => {
      if (grants.get(id) !== grant || (navigationVersions.get(id) ?? 0) !== version) return;
      grants.delete(id);
      void chrome.storage.session.remove(key(id));
      const gesture = error instanceof Error && error.message.includes('user gesture');
      entryError(id, gesture ? 'pdf-user-gesture' : 'pdf-open', gesture
        ? 'pdfEntryShortcutRejected'
        : 'pdfEntryPanelOpenFailed');
    };
    // Configure and open in the gestured API callback; no Promise continuation before open().
    void chrome.sidePanel.setOptions({ tabId: id, path: panelPath(id), enabled: true }).then(ENTRY_TRACE ? () => {
      recordEntryTrace({ stage: 'options-resolved', tabId: id });
    } : undefined).catch(ENTRY_TRACE ? (error: unknown) => {
      recordEntryTrace({ stage: 'options-rejected', tabId: id }); failed(error);
    } : failed);
    void chrome.sidePanel.open({ tabId: id }).then(() => {
      if (ENTRY_TRACE) {
        recordEntryTrace({ stage: 'open-resolved', tabId: id });
        // After the gestured call only: whether Chrome still treats this tab as active, which
        // decides between showing now and only setting the tab registry's active entry.
        void chrome.tabs.get(id).then((t) => recordEntryTrace({ stage: 'open-tab-state', tabId: id, active: t.active }), () => {});
      }
      if (grants.get(id) === grant && (navigationVersions.get(id) ?? 0) === version) {
        remember(id, { url, kind: 'pdf' });
        clearError(id);
      }
    }, ENTRY_TRACE ? (error: unknown) => {
      recordEntryTrace({ stage: 'open-rejected', tabId: id }); failed(error);
    } : failed);
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
      disableTabPanel(id, 'webpage-route');
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'web-toggle-request', tabId: id });
      await toggle(id, documentId);
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'web-toggle-resolved', tabId: id });
      if (current()) clearError(id);
    } catch {
      if (current()) entryError(id, 'webpage-unavailable', 'pdfEntryWebpageUnavailable');
    } finally { if (recovering.get(id) === version) recovering.delete(id); }
  };

  const activate = (tab?: { id?: number; url?: string; status?: string }) => {
    // Keep the original command tab. Do not guess a different active tab/window.
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'activate', tabId: tab?.id, hasTab: !!tab, hasUrl: !!tab?.url,
      status: tab?.status === 'loading' || tab?.status === 'complete' ? tab.status : 'other' });
    if (tab?.id === undefined) {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'skip-no-tab' });
      return;
    }
    const id = tab.id;
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'skip-url', tabId: id });
      return;
    }
    if (tab.status === 'loading') {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'skip-loading', tabId: id });
      entryError(id, 'document-loading', 'pdfEntryDocumentLoading');
      return;
    }
    const version = navigationVersions.get(id) ?? 0;
    const known = documents.get(id);
    if (known?.kind === 'pdf' && samePublicDocument(known.url, url)) {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'cached-pdf', tabId: id });
      openSidebar(id, url, version);
      return;
    }
    // First API request in this user action. No receiver, injection failure, filename, and
    // HTTP(S) URL are never evidence of PDF. Read the top document's actual MIME instead.
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'mime-request', tabId: id });
    chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      injectImmediately: true,
      func: () => ({ url: location.href, mime: document.contentType }),
    }, (results) => {
      const error = chrome.runtime.lastError;
      if ((navigationVersions.get(id) ?? 0) !== version) {
        if (ENTRY_TRACE) recordEntryTrace({ stage: 'mime-stale', tabId: id });
        return;
      }
      const top = results?.find((r) => r.frameId === 0);
      const value: unknown = top?.result;
      if (error || !top || !value || typeof value !== 'object'
        || !('url' in value) || typeof value.url !== 'string' || !samePublicDocument(value.url, url)
        || !('mime' in value) || typeof value.mime !== 'string' || !value.mime) {
        entryError(id, 'document-unavailable', 'pdfEntryDocumentUnavailable');
        return;
      }
      if (ENTRY_TRACE && top.documentId) inspectedDocuments?.set(id, top.documentId);
      if (value.mime.toLowerCase() === 'application/pdf') {
        if (ENTRY_TRACE) recordEntryTrace({ stage: 'mime-pdf', tabId: id });
        // Positive MIME remains useful if Chrome rejects this first callback's gesture:
        // a retry can open synchronously, without reclassifying an already confirmed PDF.
        remember(id, { url: value.url, kind: 'pdf' });
        openSidebar(id, url, version);
      } else {
        if (ENTRY_TRACE) recordEntryTrace({ stage: 'mime-web', tabId: id });
        void showWebpage(id, value.url, version, top.documentId);
      }
    });
  };
  chrome.action.onClicked.addListener(ENTRY_TRACE ? (tab) => {
    recordEntryTrace({ stage: 'toolbar', tabId: tab.id, active: tab.active });
    activate(tab);
  } : activate);
  chrome.commands.onCommand.addListener(ENTRY_TRACE ? (cmd, tab) => {
    if (cmd !== TOGGLE_COMMAND) return;
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'command', tabId: tab?.id, hasTab: !!tab, hasUrl: !!tab?.url, active: tab?.active,
      publicUrl: !!tab?.url && !!publicPdfUrl(tab.url),
      status: tab?.status === 'loading' || tab?.status === 'complete' ? tab.status : 'other' });
    activate(tab);
  } : (cmd, tab) => { if (cmd === TOGGLE_COMMAND) activate(tab); });
  if (ENTRY_TRACE) recordEntryTrace({ stage: 'listeners-ready' });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (ENTRY_TRACE && msg.type === CONTENT_ENTRY_TRACE && sender.frameId === 0 && sender.tab?.id !== undefined
      && 'stage' in msg && isContentEntryStage(msg.stage)) {
      recordEntryTrace({ stage: msg.stage, tabId: sender.tab.id }); return false;
    }
    if (msg.type === PDF_DOCUMENT && sender.frameId === 0 && sender.tab?.id !== undefined && sender.url && 'kind' in msg && (msg.kind === 'html' || msg.kind === 'pdf')) {
      if (ENTRY_TRACE) {
        const known = documents.get(sender.tab.id), inspected = inspectedDocuments?.get(sender.tab.id);
        recordEntryTrace({ stage: msg.kind === 'html' ? 'announce-html' : 'announce-pdf', tabId: sender.tab.id,
          knownKind: known?.kind, hasGrant: grants.has(sender.tab.id),
          sameDocument: known ? samePublicDocument(known.url, sender.url) : undefined,
          sameInspectedDocument: inspected && sender.documentId ? inspected === sender.documentId : undefined });
      }
      remember(sender.tab.id, { url: sender.url, kind: msg.kind });
      if (msg.kind === 'html') disableTabPanel(sender.tab.id, 'html-announce');
      return false;
    }
    if (msg.type !== PDF_CONTEXT || !fromPanel(sender)) return false;
    const requested = 'tabId' in msg && typeof msg.tabId === 'number' && Number.isInteger(msg.tabId) ? msg.tabId : undefined;
    if (ENTRY_TRACE) recordEntryTrace({ stage: 'context-request', tabId: requested });
    const none = (reason: EntryTraceReason): PdfContext => {
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'context-none', tabId: requested, reason });
      return { kind: 'none' };
    };
    void (async (): Promise<PdfContext> => {
      // The panel is tab-specific. Do not use active/lastFocusedWindow: when the sidebar has
      // focus, that query can return a different tab (or none) and look like an expired grant.
      if (requested === undefined) return none('no-request-tab');
      const grant = await loadGrant(requested);
      const generation = generations.get(requested);
      if (!grant || grant.tabId !== requested || Date.now() - grant.at > 30 * 60_000 || grant.at > Date.now() + 1000) return none('no-valid-grant');
      let tab: chrome.tabs.Tab;
      try { tab = await chrome.tabs.get(requested); } catch { return none('context-tab-missing'); }
      if (!tab.url || publicPdfUrl(tab.url) !== grant.url) return none('context-url-mismatch');
      let doc: unknown; let receiver = false;
      try { doc = await chrome.tabs.sendMessage(requested, { type: PDF_PING }, { frameId: 0 }); receiver = true; } catch { /* native PDF has no receiver */ }
      if (ENTRY_TRACE) recordEntryTrace({ stage: !receiver ? 'context-no-receiver'
        : doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'pdf' ? 'context-ping-pdf'
        : doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'html' ? 'context-ping-html' : 'context-ping-other', tabId: requested });
      try {
        const current = await chrome.tabs.get(requested);
        if (!current.url || publicPdfUrl(current.url) !== grant.url) return none('context-url-recheck');
      } catch { return none('context-tab-recheck-missing'); }
      // Re-check and consume after the last await so two in-flight context requests cannot
      // both toggle the overlay (the 200ms content-script de-dupe is not a grant lock).
      if (!stillGranted(requested, grant, generation)) return none('grant-replaced');
      if (receiver && !(doc && typeof doc === 'object' && 'kind' in doc && doc.kind === 'pdf')) {
        forget(requested, 'context-handoff');
        remember(requested, { url: tab.url, kind: 'html' });
        disableGlobalPanel('context-handoff');
        await toggle(requested);
        if (ENTRY_TRACE) recordEntryTrace({ stage: 'context-web', tabId: requested });
        return { kind: 'web' };
      }
      if (ENTRY_TRACE) recordEntryTrace({ stage: 'context-pdf', tabId: requested });
      return { kind: 'pdf', grant: { tabId: grant.tabId, url: grant.url, token: grant.token } };
    })().then(reply, () => reply(none('context-error')));
    return true;
  });

  const grantFor = (url: string, token: string) => [...grants.values()].find((g) => g.url === url && g.token === token && Date.now() - g.at <= 30 * 60_000 && g.at <= Date.now() + 1000);
  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg) || !fromPanel(sender)) return false;
    if (msg.type === PDF_VISUAL_CLOSE && 'url' in msg && typeof msg.url === 'string' && 'token' in msg && typeof msg.token === 'string') {
      if (!grantFor(msg.url, msg.token)) { reply({ ok: false, error: t().pdfAuthExpiredShort }); return true; }
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
      void refreshLang().finally(() => {
        if (!grantFor(msg.url, msg.token) || msg.catalog.length < 1 || msg.catalog.length > PDF_MAX_PAGES) {
          port.postMessage({ type: 'error', id: 0, error: t().pdfAuthExpiredShort });
          return;
        }
        const session = createPdfVisualSession({ catalog: msg.catalog, pageByAnchor: msg.pageByAnchor, backend: panelRenderBackend(port, lang) });
        void setVisualSession(pdfCacheUrl(msg.url), session);
      });
    };
    port.onMessage.addListener(onMessage);
  });
  return { activate };
}
