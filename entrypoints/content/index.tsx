import { claimContentInitialization } from '@/lib/content-init';
import { PDF_DOCUMENT, PDF_PING } from '@/lib/pdf-contract';
import ReactDOM from 'react-dom/client';
import { App } from '@/components/App';
import { LangProvider } from '@/components/i18n';
import { bus } from '@/components/bus';
import { installFrameWorker } from '@/lib/frame-bridge';
import { installDiag } from '@/lib/diag-cs';
import { PANEL_SHADOW } from '@/lib/panel-css';
import { rpc, TOGGLE } from '@/lib/messages';

/*
 * Note (verified in Chrome): none of these currently take effect. WXT's shadow root ships
 * `:host { all: initial !important }`, and for !important declarations a rule in the shadow tree beats the
 * host's inline style, so the host computes to a 0x0 box (blockified to absolute in the top layer). That is
 * harmless: the panel itself is position:fixed, the top layer makes z-index moot, and page CSS can't reach
 * the host either way. Kept as a fallback for browsers without the Popover API.
 */
const HOST_STYLE: Record<string, string> = {
  position: 'fixed', inset: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none',
  margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible',
  display: 'block', 'z-index': '2147483647', isolation: 'isolate', 'pointer-events': 'none',
  transform: 'none', filter: 'none', contain: 'none', visibility: 'visible', opacity: '1',
};

/**
 * Keep the overlay above everything on the page: a full-viewport, click-through fixed host with the max
 * z-index (inline !important so page CSS can't win), promoted to the browser top layer via the Popover API
 * when available, and re-attached as the last child of <html> if the page moves it.
 */
function pinOnTop(host: HTMLElement) {
  for (const [k, v] of Object.entries(HOST_STYLE)) host.style.setProperty(k, v, 'important');
  const canPopover = typeof (host as any).showPopover === 'function';
  if (canPopover) host.setAttribute('popover', 'manual');
  const raise = () => {
    if (!canPopover || !host.isConnected) return;
    try { if (host.matches(':popover-open')) host.hidePopover(); host.showPopover(); } catch { /* ignore */ }
  };
  const ensureLast = () => {
    const html = document.documentElement;
    if (host.parentNode !== html || html.lastElementChild !== host) { html.append(host); raise(); }
  };
  ensureLast();
  raise();
  const observer = new MutationObserver(ensureLast);
  observer.observe(document.documentElement, { childList: true });
  // Pages can open their own top-layer dialogs/popovers later; re-raise when ours is toggled open.
  const off = bus.on('toggle', () => setTimeout(raise, 0));
  return () => { observer.disconnect(); off(); };
}

/**
 * Keep page translators out of the panel: `translate="no"` (Chrome / Google Translate), and the `notranslate`
 * class, which is what Read Frog and Immersive Translate check (Read Frog walks open shadow roots, so the
 * class goes on the host and on the elements inside the shadow root too).
 */
function noTranslate(host: HTMLElement, container: HTMLElement, shadow: ShadowRoot) {
  const els = new Set<HTMLElement>([host, container, ...(Array.from(shadow.children) as HTMLElement[])]);
  for (let el = container.parentElement; el; el = el.parentElement) els.add(el);
  for (const el of els) { el.setAttribute('translate', 'no'); el.classList.add('notranslate'); }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  // Cross-origin embeds (e.g. HF Spaces on *.hf.space) only yield their DOM when we inject here too.
  // UI still mounts only in the top frame; child frames answer extract/locate messages.
  allFrames: true,
  // No cssInjectionMode: 'ui': that makes WXT fetch() content.css at first mount and, if the fetch fails, mount an
  // unstyled panel. The stylesheet is bundled instead (PANEL_CSS) and handed to the shadow root directly.
  async main(ctx) {
    if (!claimContentInitialization((cleanup) => ctx.onInvalidated(cleanup))) return;
    ctx.onInvalidated(installFrameWorker());
    const isTop = window === window.top;
    if (!isTop) return;
    const kind = document.contentType === 'application/pdf' ? 'pdf' : 'html';
    const ping = (msg: unknown, _sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) => {
      if (msg && typeof msg === 'object' && 'type' in msg && msg.type === PDF_PING) { reply({ kind }); return false; }
    };
    chrome.runtime.onMessage.addListener(ping);
    ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(ping));
    void chrome.runtime.sendMessage({ type: PDF_DOCUMENT, kind }).catch(() => {});
    if (import.meta.env.VITE_RP_DIAG === '1') installDiag(); // dev diagnostics build only

    let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
    let last = 0;
    let disposeOverlay = () => {};
    const toggle = () => {
      if (ctx.isInvalid || kind === 'pdf') return;
      if (Date.now() - last < 200) return; // de-dupe command + keydown fallback
      last = Date.now();
      if (!ui) {
        createShadowRootUi(ctx, {
          ...PANEL_SHADOW,
          onMount(container, _shadow, host) {
            // Cancel any CSS zoom inherited from the host page (e.g. html { zoom: .8 }) so the panel is always 380 CSS px.
            const fixZoom = () => {
              const z = (host.parentElement as any)?.currentCSSZoom ?? 1;
              host.style.setProperty('zoom', String(1 / (z || 1)), 'important');
            };
            fixZoom();
            const unpin = pinOnTop(host);
            disposeOverlay = () => { unpin(); window.removeEventListener('resize', fixZoom); };
            noTranslate(host, container, _shadow);
            window.addEventListener('resize', fixZoom);
            const root = ReactDOM.createRoot(container);
            root.render(<LangProvider><App /></LangProvider>);
            return root;
          },
          onRemove(root) { disposeOverlay(); root?.unmount(); },
        }).then((u) => {
          if (ctx.isInvalid) { u.remove(); return; }
          ui = u; u.mount();
        });
      } else bus.emit('toggle');
    };
    const onToggle = (msg: unknown, _sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) => {
      if (msg && typeof msg === 'object' && 'type' in msg && msg.type === TOGGLE.type) {
        toggle(); reply({ ok: true }); return false;
      }
    };
    chrome.runtime.onMessage.addListener(onToggle);
    ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(onToggle));

    // Fallback: if Chrome didn't assign the Ctrl+E / ⌘E command (conflict, or the user cleared it),
    // handle the key on the page ourselves. Not used when the user assigned a different shortcut.
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    let fallback = false;
    const refresh = () => {
      if (ctx.isInvalid) return;
      return rpc('getShortcut', {}).then((r) => { if (!ctx.isInvalid && r.ok) fallback = !r.shortcut; });
    };
    refresh();
    ctx.addEventListener(document, 'visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('keydown', (e) => {
      // WXT discovers extension reload/disable lazily via isInvalid; a signal alone
      // does not notice orphaned DOM listeners. Never let one consume a shortcut.
      if (ctx.isInvalid || kind === 'pdf') return;
      if (!fallback || e.repeat || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'e') return;
      if (!(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
      e.preventDefault(); e.stopPropagation();
      toggle();
    }, { capture: true, signal: ctx.signal });
  },
});
