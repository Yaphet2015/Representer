import ReactDOM from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '@/assets/tailwind.css';
import { loadSettings, saveSettings } from '@/lib/storage';
import { rpc } from '@/lib/messages';
import { isLocalUrl } from '@/lib/url';
import { Button } from '@/components/bui/Button';
import { useMock } from '@/lib/mock';
import { mockText } from '@/lib/mock-text';
import { ModelCombobox } from '@/components/ModelCombobox';
import { SkillsManager } from '@/components/SkillsManager';
import { LangProvider, useLang, useT } from '@/components/i18n';
import type { TestResult } from '@/lib/models';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types';

function Options() {
  const t = useT();
  const lang = useLang();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [shortcut, setShortcut] = useState('');
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const isLocal = isLocalUrl(s.baseUrl);
  const canFetch = /^https?:\/\//.test(s.baseUrl) && (!!s.apiKey || isLocal);
  const reqId = useRef(0);
  const fetchModels = async () => {
    if (!canFetch) return;
    const id = ++reqId.current;
    setMLoading(true); setMError('');
    const r = await rpc('listModels', { settings: { baseUrl: s.baseUrl, apiKey: s.apiKey } });
    if (id !== reqId.current) return; // stale
    setMLoading(false);
    if (r.ok) setModels(r.models); else { setModels([]); setMError(r.error || t.unknownError); }
  };
  useEffect(() => { // debounced auto-fetch when Base URL / key change
    if (!canFetch) { setModels([]); setMError(''); return; }
    setMLoading(true); setMError(''); reqId.current++; // show loading immediately; drop in-flight results
    const t = setTimeout(fetchModels, 600);
    return () => clearTimeout(t);
  }, [s.baseUrl, s.apiKey]);
  const runTest = async () => {
    setTesting(true); setTest(null);
    const r = await rpc('testConnection', { settings: s });
    setTesting(false);
    setTest(r.ok ? r.result : { ok: false, ms: 0, error: r.error || t.unknownError });
  };
  useEffect(() => {
    loadSettings().then(setS);
    chrome.commands.getAll((c) => setShortcut(c.find((x) => x.name === 'toggle-overlay')?.shortcut || ''));
  }, []);
  const field = (k: 'baseUrl' | 'apiKey' | 'model', label: string, type = 'text', ph = '') => (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium text-zinc-700">{label}</span>
      <input type={type} value={s[k]} placeholder={ph} onChange={(e) => setS({ ...s, [k]: e.target.value })}
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-[14px] outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-ring)]" />
    </label>
  );
  return (
    <div className="mx-auto max-w-lg space-y-6 p-10 font-sans text-zinc-900">
      <div className="flex items-center justify-between gap-4">
        <h1 className="whitespace-nowrap text-xl font-semibold">{t.settingsTitle}</h1>
        <label className="flex shrink-0 items-center text-[13px] text-zinc-600"><span className="sr-only">{t.language}</span>
          <select aria-label={t.language} value={s.lang ?? 'auto'} data-lang-select
            onChange={async (e) => { const lang = e.target.value as Settings['lang']; setS({ ...s, lang }); await saveSettings({ ...(await loadSettings()), lang }); }}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[13px] outline-none focus:border-accent">
            <option value="auto">{t.langAuto}</option><option value="zh-CN">中文</option><option value="en">English</option>
          </select>
        </label>
      </div>
      <section className="space-y-4">
        {field('baseUrl', t.baseUrl, 'text', 'https://api.openai.com/v1')}
        {field('apiKey', t.apiKey, 'password', 'sk-...')}
        <div className="space-y-1">
          <span className="text-[13px] font-medium text-zinc-700">{t.model}</span>
          <ModelCombobox value={s.model} onChange={(model) => setS({ ...s, model })} models={models} loading={mLoading} error={mError} onRefresh={fetchModels} canFetch={canFetch} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={runTest} disabled={testing || !s.model || !canFetch}>{testing ? t.testing : t.testConnection}</Button>
          <span data-test-result className="text-[13px]">
            {testing && <span className="text-zinc-500">{t.testSending(s.model)}</span>}
            {test?.ok && <span className="text-green-700">{t.testOk(test.ms, test.reply)}</span>}
            {test && !test.ok && <span className="text-red-600">{t.testFail(test.error ?? '')}</span>}
          </span>
        </div>
        <div className="space-y-1 border-t border-zinc-200 pt-4" data-system-prompt>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-700">{t.systemPrompt}</span>
            <Button variant="quiet" size="sm" onClick={() => setS({ ...s, systemPrompt: '' })} disabled={!s.systemPrompt}>{t.systemPromptReset}</Button>
          </div>
          <textarea
            value={s.systemPrompt ?? ''} onChange={(e) => setS({ ...s, systemPrompt: e.target.value })} rows={4} maxLength={4000}
            placeholder={t.systemPromptPlaceholder} aria-label={t.systemPrompt}
            className="block w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
          />
        </div>
        {import.meta.env.DEV && (() => {
          const m = mockText(lang);
          const auto = !s.mock && useMock(s); // no key (and not a local server) → mock is used automatically
          return (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                <input type="checkbox" checked={s.mock || auto} disabled={auto} onChange={(e) => setS({ ...s, mock: e.target.checked })} />
                <span className="font-medium">{m.mockMode}</span>
                {auto && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{m.mockAuto}</span>}
                {s.mock && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700">{m.mockManual}</span>}
              </label>
              <p className="pl-6 text-[12px] leading-relaxed text-zinc-500">
                {m.mockDesc} {auto ? m.mockAutoDesc : m.mockHint}
              </p>
            </div>
          );
        })()}
        <Button variant="primary" onClick={async () => { await saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
          {saved ? t.saved : t.save}</Button>
      </section>
      <SkillsManager />
      <section className="space-y-2 border-t border-zinc-100 pt-6 text-[13px] text-zinc-700">
        <p>{t.shortcutNow}<kbd className="rounded bg-zinc-100 px-1.5 py-0.5">{shortcut || t.shortcutFallback(/Mac/.test(navigator.platform) ? '⌘E' : 'Ctrl+E')}</kbd></p>
        <p className="text-[12px] text-zinc-500">
          {t.shortcutDesc}
          {shortcut ? '' : t.shortcutMissing}
        </p>
        <button onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })} className="text-accent underline">
          {t.shortcutLink}
        </button>
      </section>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<LangProvider><Options /></LangProvider>);
