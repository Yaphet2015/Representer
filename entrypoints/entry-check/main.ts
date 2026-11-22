import { ENTRY_TRACE_KEY, PANEL_TRACE_KEY, readEntryTrace } from '@/lib/pdf-entry-trace';
const build = document.getElementById('build');
const snapshot = document.getElementById('snapshot');
const refresh = document.getElementById('refresh');
if (!build || !snapshot || !refresh) throw new Error('Missing shortcut-check elements');
build.textContent = `${chrome.runtime.id} — ${chrome.runtime.getManifest().version_name}`;
const read = async () => {
  const stored = await chrome.storage.session.get([ENTRY_TRACE_KEY, PANEL_TRACE_KEY]);
  const rows = [...readEntryTrace(stored[ENTRY_TRACE_KEY]), ...readEntryTrace(stored[PANEL_TRACE_KEY])].sort((a, b) => a.at - b.at);
  snapshot.textContent = rows.map((row) => JSON.stringify({
    ...row,
    timeSGT: new Date(row.at).toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }) + ' SGT',
    bootSGT: new Date(row.boot).toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }) + ' SGT',
  })).join('\n');
};
refresh.addEventListener('click', () => { void read(); });
void read();
