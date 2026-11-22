import { PANEL_TRACE_KEY, recordEntryTrace } from './pdf-entry-trace';

/** Test build only: whether Chrome created, showed, hid, or destroyed the panel document. */
export function installPanelTrace(tabId: number | undefined) {
  const visible = () => document.visibilityState === 'visible';
  recordEntryTrace({ stage: 'panel-load', tabId, visible: visible() }, PANEL_TRACE_KEY);
  document.addEventListener('visibilitychange', () => {
    recordEntryTrace({ stage: visible() ? 'panel-visible' : 'panel-hidden', tabId, visible: visible() }, PANEL_TRACE_KEY);
  });
  window.addEventListener('pagehide', () => {
    recordEntryTrace({ stage: 'panel-unload', tabId, visible: visible() }, PANEL_TRACE_KEY);
  });
}
