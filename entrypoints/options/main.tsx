import ReactDOM from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import '@/assets/tailwind.css';
import { KEYS, loadSettings, onStorageChange, saveSettings } from '@/lib/storage';
import { rpc } from '@/lib/messages';
import { isLocalUrl } from '@/lib/url';
import { createAutosaver, errorKind, failedField, type SaveStatus } from '@/lib/autosave';
import { cn } from '@/lib/cn';
import { SectionTail, useActiveSection } from '@/components/options/useActiveSection';
import { Button } from '@/components/bui/Button';
import { useMock } from '@/lib/mock';
import { mockText } from '@/lib/mock-text';
import { ModelCombobox } from '@/components/ModelCombobox';
import { SkillsManager } from '@/components/SkillsManager';
import { HistoryCard } from '@/components/options/HistoryCard';
import { LangProvider, useLang, useT } from '@/components/i18n';
import { useTheme } from '@/components/theme';
import { Card, Field, Icon, Ic, Input, Kbd, Select, Switch, Tag } from '@/components/options/ui';
import type { TestResult } from '@/lib/models';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/types';

type Conn = { state: 'idle' } | { state: 'testing' } | { state: 'ok'; ms: number; reply: string } | { state: 'fail'; error: string };
export const SECTIONS = ['general', 'connection', 'instructions', 'skills', 'shortcuts', 'history'] as const;
const MAX_PROMPT = 4000;
/** Mirror the theme into localStorage so public/theme-boot.js can apply it before first paint. */
export const cacheTheme = (pref: Settings['theme']) => { try { localStorage.setItem('rp-theme', pref ?? 'system'); } catch {} };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Options() {
  const t = useT();
  const lang = useLang();
  const theme = useTheme();
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const sRef = useRef(s); sRef.current = s;
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [models, setModels] = useState<string[]>([]);
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState('');
  const [conn, setConn] = useState<Conn>({ state: 'idle' });
  const [showKey, setShowKey] = useState(false);
  const [active, go] = useActiveSection(SECTIONS);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; id: number } | null>(null);
  const saver = useMemo(() => createAutosaver<Settings>((v) => saveSettings(v), setStatus), []);
  const testId = useRef(0);

  // autosave: text fields debounce, everything else writes now
  const update = (patch: Partial<Settings>, mode: 'debounce' | 'now' | 'local' = 'debounce') => {
    const next = { ...sRef.current, ...patch }; sRef.current = next; setS(next);
    if ('baseUrl' in patch || 'apiKey' in patch || 'model' in patch) { testId.current++; setConn({ state: 'idle' }); }
    if (mode === 'debounce') saver.schedule(next); else if (mode === 'now') void saver.flush(next);
  };
  useEffect(() => () => { void saver.flush(); }, [saver]);
  useEffect(() => { const f = () => { void saver.flush(); }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [saver]);

  const showToast = (msg: string, undo?: () => void) => setToast({ msg, undo, id: Date.now() });
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 5000); return () => clearTimeout(h); }, [toast]);

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
    setMLoading(true); setMError(''); reqId.current++;
    const h = setTimeout(fetchModels, 600);
    return () => clearTimeout(h);
  }, [s.baseUrl, s.apiKey]);
  const runTest = async () => {
    if (conn.state === 'testing') { testId.current++; setConn({ state: 'idle' }); return; } // cancel
    const id = ++testId.current;
    setConn({ state: 'testing' });
    await saver.flush(sRef.current);
    const r = await rpc('testConnection', { settings: sRef.current });
    if (id !== testId.current) return;
    const res: TestResult = r.ok ? r.result : { ok: false, ms: 0, error: r.error || t.unknownError };
    setConn(res.ok ? { state: 'ok', ms: res.ms, reply: res.reply ?? '' } : { state: 'fail', error: res.error ?? t.unknownError });
  };
  useEffect(() => {
    const load = () => loadSettings().then((v) => { sRef.current = v; setS(v); cacheTheme(v.theme); });
    load();
    // follow changes made elsewhere (another options tab), unless an edit here is still waiting to be written
    const off = onStorageChange([KEYS.settings], () => { if (!saver.pending()) load(); });
    chrome.commands.getAll((c) => setShortcut(c.find((x) => x.name === 'toggle-overlay')?.shortcut || ''));
    return off;
  }, []);
  const bad = conn.state === 'fail' ? failedField(conn.error) : null;
  const pill = conn.state === 'testing' ? { cls: 'bg-accent-tint text-accent-ink', dot: 'bg-accent animate-pulse', text: t.stTesting }
    : conn.state === 'ok' ? { cls: 'bg-[color-mix(in_srgb,var(--green)_14%,transparent)] text-green', dot: 'bg-green', text: t.stOk(conn.ms) }
    : conn.state === 'fail' ? { cls: 'bg-red-tint text-red', dot: 'bg-red', text: t.stFail }
    : { cls: 'bg-hover text-ink-2', dot: 'bg-ink-3', text: t.stUntested };
  const nav = [
    { id: 'general', label: t.navGeneral, icon: Ic.gear },
    { id: 'connection', label: t.navConnection, icon: Ic.plug }, { id: 'instructions', label: t.navInstructions, icon: Ic.pen },
    { id: 'skills', label: t.navSkills, icon: Ic.bolt }, { id: 'shortcuts', label: t.navShortcuts, icon: Ic.kbd },
    { id: 'history', label: t.navHistory, icon: Ic.clock },
  ];
  const promptLen = (s.systemPrompt ?? '').length;
  const mod = isMac ? '⌘' : 'Ctrl';
  const keys = (sc: string) => (isMac ? sc.replace(/[⌘⇧⌥⌃]/g, (m) => ` ${m} `) : sc.replace(/\+/g, ' ')).trim().split(/\s+/).filter(Boolean);
  const version = typeof chrome !== 'undefined' ? chrome.runtime?.getManifest?.().version : '';

  return (
    <div className="min-h-screen bg-page font-sans text-ink antialiased min-[860px]:flex min-[860px]:bg-[linear-gradient(to_right,var(--canvas)_219px,var(--line)_219px_220px,var(--page)_220px)]">
      {/* left nav (top tab bar under 860px) */}
      <nav aria-label={t.settingsShort} className="sticky top-0 z-20 flex shrink-0 border-line bg-page/90 backdrop-blur max-[859px]:border-b min-[860px]:h-screen min-[860px]:w-[220px] min-[860px]:flex-col min-[860px]:bg-transparent min-[860px]:backdrop-blur-none">
        <div className="hidden items-center gap-2.5 px-5 pb-4 pt-6 min-[860px]:flex">
          <img data-brand-logo src="/icon/128.png" alt="" aria-hidden width={26} height={26} className="size-[26px] shrink-0 rounded-[7px]" />
          <span className="text-[14px] font-[650]">Representer</span>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-3 py-2 min-[860px]:flex-col min-[860px]:gap-0.5 min-[860px]:py-0 rp-noscrollbar">
          {nav.map((n) => (
            <li key={n.id} className="shrink-0">
              <a href={`#${n.id}`} aria-current={active === n.id ? 'true' : undefined} onClick={(e) => { e.preventDefault(); go(n.id); }}
                className={cn('flex h-8 items-center gap-2 whitespace-nowrap rounded-[8px] px-2.5 text-[13px] transition-colors focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]',
                  active === n.id ? 'bg-accent-tint font-medium text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}>
                <Icon d={n.icon} className="size-[15px]" />{n.label}
              </a>
            </li>
          ))}
        </ul>
        {version && <div className="mt-auto hidden px-5 pb-5 text-[12px] text-ink-3 min-[860px]:block">v{version}</div>}
      </nav>

      <main className="relative min-w-0 flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[220px]" style={{ background: 'linear-gradient(to bottom, color-mix(in srgb, var(--accent) 10%, transparent), transparent)' }} />
        <div className="relative mx-auto max-w-[760px] px-6 pb-12 pt-8 min-[860px]:px-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-[22px] font-[650] leading-8">{t.settingsShort}</h1>
            <span data-save-status role="status" className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
              {status === 'saving' && t.savingNow}
              {status === 'saved' && <><Icon d={Ic.check} className="size-3.5 text-green" />{t.autoSaved}</>}
              {status === 'idle' && <><Icon d={Ic.check} className="size-3.5 text-green" />{t.autoSaved}</>}
              {status === 'error' && <button type="button" className="text-red underline-offset-2 hover:underline" onClick={() => saver.retry()}>{t.saveFailedRetry}</button>}
            </span>
          </div>

          <div className="space-y-6">
            <Card id="general" data-general title={t.generalTitle}>
              <div className="space-y-4">
                <Field label={t.language} htmlFor="f-lang">
                  <Select id="f-lang" data-lang-select aria-label={t.language} value={s.lang ?? 'auto'} onChange={(v) => update({ lang: v as Settings['lang'] }, 'now')}>
                    <option value="auto">{t.langAuto}</option><option value="zh-CN">中文</option><option value="en">English</option>
                  </Select>
                </Field>
                <Field label={t.appearance} htmlFor="f-theme">
                  <Select id="f-theme" data-theme-select aria-label={t.appearance} value={s.theme ?? 'system'} onChange={(v) => { cacheTheme(v as Settings['theme']); update({ theme: v as Settings['theme'] }, 'now'); }}>
                    <option value="system">{t.themeSystem}</option><option value="light">{t.themeLight}</option><option value="dark">{t.themeDark}</option>
                  </Select>
                </Field>
              </div>
            </Card>

            <Card id="connection" data-connection title={t.navConnection} desc={t.connDesc}
              action={<span data-conn-status className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium', pill.cls)}><i className={cn('size-[7px] rounded-full', pill.dot)} />{pill.text}</span>}
              foot={<>
                <span data-test-result className={cn('min-w-0 text-[12.5px]', conn.state === 'fail' ? 'text-red' : 'text-ink-2')}>
                  {conn.state === 'idle' && t.footUntested}
                  {conn.state === 'testing' && t.footTesting(s.model)}
                  {conn.state === 'ok' && t.footOk(conn.reply)}
                  {conn.state === 'fail' && <>
                    {t.errKind[errorKind(conn.error)]}
                    <details data-error-details className="mt-1 text-ink-3 [&[open]>summary>svg]:rotate-90">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-[4px] text-[12px] hover:text-ink-2 focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] [&::-webkit-details-marker]:hidden">
                        <svg aria-hidden viewBox="0 0 16 16" className="size-3 transition-transform"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>{t.errDetails}
                      </summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-inset px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">{conn.error}</pre>
                    </details>
                  </>}
                </span>
                <Button variant="secondary" size="sm" className="shrink-0 whitespace-nowrap" onClick={runTest} disabled={conn.state !== 'testing' && (!s.model || !canFetch)}>
                  {conn.state === 'testing' ? t.cancel : t.testConnection}</Button>
              </>}>
              <div className="space-y-4">
                <Field label="Base URL" htmlFor="f-url">
                  <Input id="f-url" invalid={bad === 'baseUrl'} value={s.baseUrl} placeholder="https://api.openai.com/v1" spellCheck={false} className="font-mono text-[13px]"
                    onChange={(e) => update({ baseUrl: e.target.value })} onBlur={() => saver.flush()} />
                </Field>
                <Field label="API Key" htmlFor="f-key">
                  <div className="relative">
                    <Input id="f-key" invalid={bad === 'apiKey'} type={showKey ? 'text' : 'password'} value={s.apiKey} placeholder="sk-..." spellCheck={false} autoComplete="off" className="pr-9 font-mono text-[13px]"
                      onChange={(e) => update({ apiKey: e.target.value }, 'local')} onBlur={() => saver.flush(sRef.current)} />
                    <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t.hideKey : t.showKey} aria-pressed={showKey}
                      className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-ink-3 hover:text-ink-2 focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]">
                      <Icon d={showKey ? Ic.eyeOff : Ic.eye} className="size-[15px]" />
                    </button>
                  </div>
                </Field>
                <Field label={t.modelLabel} htmlFor="f-model">
                  <ModelCombobox id="f-model" value={s.model} invalid={bad === 'model'} onChange={(model) => update({ model })} onCommit={() => saver.flush()}
                    models={models} loading={mLoading} error={mError} onRefresh={fetchModels} canFetch={canFetch} />
                </Field>
              </div>
            </Card>

            <Card id="instructions" data-system-prompt title={t.navInstructions} desc={t.instrDesc}
              action={<Button variant="quiet" size="sm" disabled={!s.systemPrompt} onClick={() => { const prev = s.systemPrompt ?? ''; update({ systemPrompt: '' }, 'now'); showToast(t.restored, () => update({ systemPrompt: prev }, 'now')); }}>{t.systemPromptReset}</Button>}>
              <textarea value={s.systemPrompt ?? ''} onChange={(e) => update({ systemPrompt: e.target.value })} onBlur={() => saver.flush()} maxLength={MAX_PROMPT}
                placeholder={t.systemPromptPlaceholder} aria-label={t.navInstructions}
                className="block min-h-[112px] w-full resize-y rounded-[10px] bg-field px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none shadow-[inset_0_0_0_1px_var(--line)] placeholder:text-ink-3 focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-ring)]" />
              <div className="mt-1.5 flex justify-between text-[12px] text-ink-3">
                <span>{t.instrEmptyHint}</span>
                <span data-prompt-count className={promptLen >= MAX_PROMPT ? 'text-red' : promptLen > 3800 ? 'text-amber' : ''}>{promptLen} / {MAX_PROMPT}</span>
              </div>
              {import.meta.env.DEV && (() => {
                const m = mockText(lang);
                const auto = !s.mock && useMock(s); // no key (and not a local server) → mock is used automatically
                return (
                  <div className="-mx-6 mt-5 flex items-start justify-between gap-4 border-t border-line px-6 pt-4">
                    <div>
                      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">{m.mockMode}
                        {auto && <Tag tone="amber">{m.mockAuto}</Tag>}{s.mock && <Tag>{m.mockManual}</Tag>}</div>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{m.mockDesc} {auto ? m.mockAutoDesc : m.mockHint}</p>
                    </div>
                    <Switch label={m.mockMode} checked={s.mock || auto} disabled={auto} onChange={(v) => update({ mock: v }, 'now')} />
                  </div>
                );
              })()}
            </Card>

            <SkillsManager toast={showToast} />

            <Card id="shortcuts" data-shortcuts title={t.shortcutsTitle} desc={t.shortcutsDesc}
              action={<button type="button" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })} className="flex items-center gap-1 rounded-[6px] text-[12.5px] font-medium text-accent hover:underline focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]">{t.customizeShortcuts.replace(' ↗', '')}<Icon d={Ic.ext} className="size-3" /></button>}>
              <table className="w-full text-[13px]">
                <tbody className="[&>tr+tr]:border-t [&>tr+tr]:border-line">
                  {[
                    { label: t.scToggle, keys: shortcut ? keys(shortcut) : [mod, 'E'], tag: shortcut === '' ? t.scFallbackTag : '' },
                    { label: t.scSend, keys: ['↵'] }, { label: t.scNewline, keys: ['⇧', '↵'] }, { label: t.scSkills, keys: ['/'] },
                  ].map((r) => (
                    <tr key={r.label} className="h-11">
                      <td className="text-ink">{r.label}{r.tag && <span className="ml-2"><Tag>{r.tag}</Tag></span>}</td>
                      <td className="text-right"><span className="inline-flex gap-1">{r.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[12px] text-ink-3">{t.scRestricted}</p>
              {shortcut === '' && <p className="mt-1 text-[12px] text-amber">{t.scMissing}</p>}
            </Card>

            <SectionTail><HistoryCard /></SectionTail>
          </div>
        </div>
      </main>

      {toast && (
        <div role="status" key={toast.id} className="fixed bottom-6 left-1/2 z-40 flex h-10 -translate-x-1/2 items-center gap-3 rounded-full bg-ink pl-4 pr-1.5 text-[13px] text-surface shadow-float">
          {toast.msg}
          {toast.undo && <button type="button" className="h-7 rounded-full px-3 font-medium text-[color-mix(in_srgb,var(--rp-accent)_60%,white)] hover:bg-[rgba(127,127,127,.2)]" onClick={() => { toast.undo!(); setToast(null); }}>{t.undo}</button>}
        </div>
      )}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<LangProvider><Options /></LangProvider>);
