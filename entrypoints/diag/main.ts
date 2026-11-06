// DEV-ONLY page; see lib/diag-cs.ts. All page-derived text is written with textContent.
declare const __RP_BUILD__: string;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$('build').textContent = `${chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version} (${__RP_BUILD__})`;

type Block = { id: string; sk?: string; frameId?: number; o: number; head: string; chunk: string; flag: string };
let blocks: Block[] = [];
let lastExtract: unknown = null;

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  const sel = $<HTMLSelectElement>('tab');
  sel.replaceChildren(...tabs.filter((t) => t.id != null && /^https?:/.test(t.url ?? '')).map((t) => {
    const o = document.createElement('option'); o.value = String(t.id); o.textContent = `${t.title} — ${t.url}`; return o;
  }));
}

const send = (msg: object) => chrome.tabs.sendMessage(Number($<HTMLSelectElement>('tab').value), msg, { frameId: 0 });

function render() {
  const f = $<HTMLInputElement>('filter').value.trim().toLowerCase();
  const rows = blocks.filter((b) => !f || b.chunk.replace(/\\/g, '').toLowerCase().includes(f) || b.head.toLowerCase().includes(f)).map((b) => {
    const tr = document.createElement('tr'); if (b.flag) tr.className = 'bad';
    for (const v of [b.id, `${b.sk ?? 'top'} (frameId ${b.frameId ?? 0})`, String(b.o), b.flag, b.chunk.length > 400 ? `${b.chunk.slice(0, 400)}…` : b.chunk, b.head]) {
      const td = document.createElement('td'); td.textContent = v; tr.append(td);
    }
    const td = document.createElement('td'); const btn = document.createElement('button'); btn.textContent = 'Jump';
    btn.onclick = () => jump(b.id); td.append(btn); tr.append(td);
    return tr;
  });
  $('rows').replaceChildren(...rows);
}

async function jump(id: string) {
  $('trace').textContent = `jumping ${id}…`;
  try {
    const r: any = await send({ type: 'rp-diag-jump', id });
    $('csbuild').textContent = r?.build ?? '?';
    const b = blocks.find((x) => x.id === id);
    $('trace').textContent = JSON.stringify({ id, expectedText: b?.chunk.slice(0, 160), ...r }, null, 2);
  } catch (e) { $('trace').textContent = String(e); }
}

$('refresh').onclick = loadTabs;
// Public page text + its block mapping only: the extract never carries settings, keys or model output.
$('download').onclick = () => {
  if (!lastExtract) return;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), extensionBuild: __RP_BUILD__, ...(lastExtract as object) }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `representer-diag-${__RP_BUILD__}-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('filter').oninput = render;
$('jump').onclick = () => jump($<HTMLInputElement>('jid').value.trim());
$('extract').onclick = async () => {
  $('meta').textContent = 'extracting…';
  try {
    const r: any = await send({ type: 'rp-diag-extract' });
    $('csbuild').textContent = r?.build ?? '? (old content script: reload the tab)';
    if (!r?.ok) { $('meta').textContent = JSON.stringify(r, null, 2); return; }
    blocks = r.blocks; lastExtract = r; $<HTMLButtonElement>('download').disabled = false;
    $('meta').textContent = JSON.stringify({ href: r.href, title: r.title, chars: r.chars, sources: r.sources, notices: r.notices, markerReport: r.report }, null, 2);
    render();
  } catch (e) { $('meta').textContent = `${e} — no diag content script in this tab (reload the tab after loading the dev build)`; }
};
loadTabs();
