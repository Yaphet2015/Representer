import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { App } from '@/components/App';
import { LangProvider } from '@/components/i18n';
import { bus } from '@/components/bus';
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
  new MutationObserver(ensureLast).observe(document.documentElement, { childList: true });
  // Pages can open their own top-layer dialogs/popovers later; re-raise when ours is toggled open.
  bus.on('toggle', () => setTimeout(raise, 0));
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
  cssInjectionMode: 'ui',
  async main(ctx) {
    let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
    let last = 0;
    const toggle = () => {
      if (Date.now() - last < 200) return; // de-dupe command + keydown fallback
      last = Date.now();
      if (!ui) {
        createShadowRootUi(ctx, {
          name: 'representer-overlay',
          position: 'overlay',
          zIndex: 2147483647,
          anchor: 'html', // outside <body>, so body-level zoom/transform on the host page can't affect us
          onMount(container, _shadow, host) {
            // Cancel any CSS zoom inherited from the host page (e.g. html { zoom: .8 }) so the panel is always 380 CSS px.
            const fixZoom = () => {
              const z = (host.parentElement as any)?.currentCSSZoom ?? 1;
              host.style.setProperty('zoom', String(1 / (z || 1)), 'important');
            };
            fixZoom();
            pinOnTop(host);
            noTranslate(host, container, _shadow);
            window.addEventListener('resize', fixZoom);
            const root = ReactDOM.createRoot(container);
            root.render(<LangProvider><App /></LangProvider>);
            return root;
          },
          onRemove(root) { root?.unmount(); },
        }).then((u) => { ui = u; u.mount(); });
      } else bus.emit('toggle');
    };
    chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === TOGGLE.type) toggle(); });

    // Fallback: if Chrome didn't assign the Ctrl+E / ⌘E command (conflict, or the user cleared it),
    // handle the key on the page ourselves. Not used when the user assigned a different shortcut.
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    let fallback = false;
    const refresh = () => rpc('getShortcut', {}).then((r) => { if (r.ok) fallback = !r.shortcut; });
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('keydown', (e) => {
      if (!fallback || e.repeat || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'e') return;
      if (!(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
      e.preventDefault(); e.stopPropagation();
      toggle();
    }, true);
  },
});
