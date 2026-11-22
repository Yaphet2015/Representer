import { ENTRY_TRACE_KEY, readEntryTrace } from '@/lib/pdf-entry-trace';
const build = document.getElementById('build');
const snapshot = document.getElementById('snapshot');
const refresh = document.getElementById('refresh');
if (!build || !snapshot || !refresh) throw new Error('Missing shortcut-check elements');
build.textContent = `${chrome.runtime.id} — ${chrome.runtime.getManifest().version_name}`;
const read = async () => {
  const value: unknown = (await chrome.storage.session.get(ENTRY_TRACE_KEY))[ENTRY_TRACE_KEY];
  snapshot.textContent = readEntryTrace(value).map((row) => JSON.stringify({
    ...row,
    timeSGT: new Date(row.at).toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }) + ' SGT',
    bootSGT: new Date(row.boot).toLocaleString('sv-SE', { timeZone: 'Asia/Singapore' }) + ' SGT',
  })).join('\n');
};
refresh.addEventListener('click', () => { void read(); });
void read();
