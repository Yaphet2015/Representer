import { PDF_CONTEXT, PDF_DOCUMENT, PDF_PING, PDF_VISUAL_CLOSE, publicPdfUrl, pdfCacheUrl, type PdfContext, isPdfAuthorization, type PdfAuthorization, isPdfPanelUrl } from './pdf-contract';
import { PDF_MAX_PAGES } from './pdf-text';
import { closeVisualSession, setVisualSession } from './pdf-visual-sessions';
import { createPdfVisualSession } from './pdf-visual';
import { PDF_VISUAL_PORT, isPdfVisualRegister, panelRenderBackend } from './pdf-visual-port';
import { commandTraceEnabled, recordCommandTrace, urlKindOf } from './command-trace';

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
  const documents = new Map<number, { url: string; kind: 'html' | 'pdf' }>();
  const grants = new Map<number, PdfAuthorization>();
  const generations = new Map<number, number>();
  const key = (id: number) => `pdf-authorization:${id}`;
  // Session storage survives service-worker suspension, not a browser restart. No PDF bytes/text or settings here.
  const disablePanel = (id: number) => {
    void chrome.sidePanel.setOptions({ tabId: id, enabled: false });
    if (chrome.sidePanel.close) void chrome.sidePanel.close({ tabId: id }).catch(() => {});
  };
  const forget = (id: number) => {
    const url = grants.get(id)?.url;
    documents.delete(id); grants.delete(id); generations.set(id, (generations.get(id) ?? 0) + 1);
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
    for (const v of Object.values(all ?? {})) if (isPdfAuthorization(v) && !grants.has(v.tabId)) adopt(v);
  });

  chrome.tabs.onRemoved.addListener(forget);
  // Revoke only when this tab leaves the granted document. `status: 'loading'` alone is not a
  // navigation: Chrome's PDF viewer (and hash-only updates) emit it without a new document, and
  // forgetting here is what made every Read fail after the first context() succeeded.
  chrome.tabs.onUpdated.addListener((id, info) => {
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
  const trace = (tab: { id?: number; url?: string } | undefined, source: 'command' | 'action', outcome: 'no-tab' | 'no-usable-url' | 'overlay' | 'open-called' | 'open-ok' | 'open-failed', openError?: string) => {
    if (!commandTraceEnabled) return;
    void recordCommandTrace({
      source, command: source === 'command' ? TOGGLE_COMMAND : undefined,
      hasTab: tab?.id !== undefined, tabId: tab?.id, urlKind: urlKindOf(tab?.url), outcome, openError,
    });
  };
  const activate = (tab?: { id?: number; url?: string }, source: 'command' | 'action' = 'action') => {
    if (tab?.id === undefined) { trace(tab, source, 'no-tab'); return; }
    const id = tab.id, known = documents.get(id);
    if (known?.kind === 'html' && known.url === tab.url) { trace(tab, source, 'overlay'); void toggle(id); return; }
    const url = tab.url ? publicPdfUrl(tab.url) : null;
    if (!url) { trace(tab, source, 'no-usable-url'); return; }
    const grant: PdfAuthorization = { tabId: id, url, token: crypto.randomUUID(), at: Date.now() };
    generations.set(id, (generations.get(id) ?? 0) + 1); grants.set(id, grant);
    void chrome.storage.session.set({ [key(id)]: grant });
    // setOptions must not be awaited: open() has to stay in the user-gesture turn.
    void chrome.sidePanel.setOptions({ tabId: id, path: panelPath(id), enabled: true });
    const opening = Promise.resolve(chrome.sidePanel.open({ tabId: id }));
    if (commandTraceEnabled) {
      trace(tab, source, 'open-called');
      void opening.then(() => trace(tab, source, 'open-ok'), (e) => trace(tab, source, 'open-failed', String((e as Error)?.message ?? e)));
    } else {
      void opening.catch(() => {});
    }
    void chrome.runtime.sendMessage({ type: 'rp-pdf-selected' }).catch(() => {});
  };
  chrome.action.onClicked.addListener((tab) => activate(tab, 'action'));
  chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === TOGGLE_COMMAND) activate(tab, 'command'); });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return false;
    if (msg.type === PDF_DOCUMENT && sender.frameId === 0 && sender.tab?.id !== undefined && sender.url && 'kind' in msg && (msg.kind === 'html' || msg.kind === 'pdf')) {
      documents.set(sender.tab.id, { url: sender.url, kind: msg.kind }); return false;
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
        documents.set(requested, { url: tab.url, kind: 'html' });
        await toggle(requested);
        // Chrome 141+ can close a temporary classification sidebar. On 116–140 show a close instruction.
        if (chrome.sidePanel.close) void chrome.sidePanel.close({ tabId: requested }).catch(() => {});
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
