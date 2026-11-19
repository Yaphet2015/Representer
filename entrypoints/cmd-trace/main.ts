// TEST-ONLY page; compiled only when VITE_RP_CMD_DIAG=1. Values are written with textContent.
import { clearCommandTrace, COMMAND_TRACE_KEY, loadCommandTrace, type CommandTraceEvent } from '@/lib/command-trace';

declare const __RP_BUILD__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const manifest = chrome.runtime.getManifest();
$('build').textContent = `${manifest.version_name ?? manifest.version} (${__RP_BUILD__})`;

function fmt(at: number): string {
  try {
    return new Date(at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', hour12: false }) + ' Asia/Singapore';
  } catch {
    return String(at);
  }
}

function render(events: CommandTraceEvent[]) {
  $('empty').hidden = events.length > 0;
  $('json').textContent = JSON.stringify(events, null, 2);
  $('rows').replaceChildren(...events.map((e) => {
    const tr = document.createElement('tr');
    for (const v of [e.seq, fmt(e.at), e.source, e.command ?? '', e.hasTab ? 'yes' : 'no', e.tabId ?? '', e.urlKind, e.outcome, e.openError ?? '']) {
      const td = document.createElement('td');
      td.className = 'mono';
      td.textContent = String(v);
      tr.append(td);
    }
    return tr;
  }));
}

async function refresh(label = 'updated') {
  const events = await loadCommandTrace();
  render(events);
  $('status').textContent = `${label} · ${events.length} event(s)`;
}

$('refresh').onclick = () => { void refresh('manual'); };
$('clear').onclick = () => { void clearCommandTrace().then(() => refresh('cleared')); };
$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('json').textContent ?? '[]');
  $('status').textContent = 'copied';
};

void refresh('loaded');
setInterval(() => { void refresh('auto'); }, 1000);
chrome.storage.session.onChanged.addListener((c) => {
  if (COMMAND_TRACE_KEY in c) void refresh('live');
});
