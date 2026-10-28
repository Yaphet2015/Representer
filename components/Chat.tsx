import { bus } from './bus';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang, useT } from './i18n';
import { CHAT_PORT, rpc, type ChatEvent, type ChatRequest } from '@/lib/messages';
import { chromeKV, KEYS, onStorageChange } from '@/lib/storage';
import { getSession, MAIN_ID, parseSide, sessionLabel, type SessionsState } from '@/lib/sessions';
import { createSkillStore, localizeSkill, renderTemplate, type Skill } from '@/lib/skills';
import type { ChatMessage } from '@/lib/types';
import { SessionChips } from './SessionChips';
import { SkillsRow } from './SkillsRow';
import { Composer } from './Composer';
import { Markdown } from './Markdown';
import { CopyButton } from './CopyButton';
import { messageMarkdown } from '@/lib/copy';
import { slashItems, type SlashItem } from './SlashMenu';


export function Chat({ url, pageTitle, disabled = false, hasSummary, getPage, onBusy, reloadKey, onSideCount, draft, onDraftUsed }: { url: string; pageTitle: string; disabled?: boolean; /** without a summary the page text goes along with each message and serves as the attachment */ hasSummary: boolean; getPage: () => { title: string; content: string }; onBusy?: (busy: boolean) => void; reloadKey: number; onSideCount?: (n: number) => void; /** text to put into the input (never sent for the user) */ draft?: { text: string; id: number } | null; onDraftUsed?: () => void }) {
  const t = useT();
  const [state, setState] = useState<SessionsState | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSelection = useRef('');
  const lang = useLang();
  const skillStore = useRef(createSkillStore(chromeKV)).current;

  useEffect(() => { // a clicked term in the overview: prefill the input and focus it, the user decides whether to send
    if (!draft) return;
    setInput(draft.text); onDraftUsed?.();
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const sid = state?.active ?? MAIN_ID;
  const messages: ChatMessage[] = (state && getSession(state, sid)?.messages) || [];

  useEffect(() => { rpc('getSessions', { url }).then((r) => r.ok && setState(r.state)); }, [url, reloadKey]);
  const loadSkills = useCallback(() => skillStore.ordered().then((l) => setSkills(l.map((s) => localizeSkill(s, lang)))), [skillStore, lang]);
  useEffect(() => {
    loadSkills();
    return onStorageChange([KEYS.skills, KEYS.skillsRecent], loadSkills);
  }, [loadSkills]);
  useEffect(() => { // remember the page selection for {{selection}}
    const onSel = () => { const t = window.getSelection()?.toString().trim(); if (t) lastSelection.current = t; };
    document.addEventListener('selectionchange', onSel); return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  // Scroll the list itself to the very bottom: scrollIntoView on the end marker would stop short of the
  // bottom padding, leaving the last message under the floating skills row. Also re-run on session switch/fork.
  useEffect(() => { const el = end.current?.parentElement; if (el) el.scrollTop = el.scrollHeight; }, [sid, messages.length, messages[messages.length - 1]?.content]);

  const patchMessages = (id: string, f: (m: ChatMessage[]) => ChatMessage[]) =>
    setState((s) => s && { ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, messages: f(x.messages) } : x)) });

  const stream = (text: string, targetSid: string, label?: string) => {
    setBusy(true);
    patchMessages(targetSid, (m) => [...m, { role: 'user', content: text, ...(label ? { label } : {}) }, { role: 'assistant', content: '' }]);
    const port = chrome.runtime.connect({ name: CHAT_PORT });
    const patch = (f: (s: string) => string) => patchMessages(targetSid, (m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', content: f(c[c.length - 1]!.content) }; return c; });
    port.onMessage.addListener((msg: ChatEvent) => {
      if ('delta' in msg) patch((s) => s + msg.delta);
      else {
        if ('done' in msg && msg.text) { const full = msg.text; patch(() => full); }
        if ('error' in msg) { const err = msg.error; patch((s) => s + (s ? '\n\n' : '') + '⚠️ ' + err); }
        setBusy(false); port.disconnect();
      }
    });
    let page: ChatRequest['page'];
    if (!hasSummary) { const p = getPage(); page = { title: p.title, content: p.content }; }
    port.postMessage({ url, text, sid: targetSid, label, ...(page ? { page } : {}) } satisfies ChatRequest);
  };

  const fork = async (firstMessage = '') => {
    const r = await rpc('forkSession', { url, from: sid });
    if (!r.ok) return;
    setState(r.state);
    if (firstMessage) stream(firstMessage, r.id);
  };
  const switchTo = async (id: string) => { const r = await rpc('setActiveSession', { url, id }); if (r.ok) setState(r.state); };
  const closeIt = async (id: string) => { const r = await rpc('closeSession', { url, id }); if (r.ok) setState(r.state); };

  const runSkill = async (s: Skill, rawInput = input) => {
    if (busy || disabled) return;
    const prompt = renderTemplate(s.template, { input: rawInput, selection: lastSelection.current, page_title: pageTitle });
    setInput('');
    await skillStore.markUsed(s.id);
    stream(prompt, sid, `${s.icon ? s.icon + ' ' : ''}${s.name}${rawInput.trim() ? '：' + rawInput.trim() : ''}`);
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy || disabled) return;
    const side = parseSide(text);
    setInput('');
    if (side) { fork(side.message); return; }
    stream(text, sid);
  };

  const items = slashItems(input, skills, t);
  const showSlash = items.length > 0 && !busy;
  const pickSlash = (it: SlashItem) => {
    if (it.skill) { runSkill(it.skill, ''); return; }
    setInput('/side '); inputRef.current?.focus();
  };

  const canSend = !!input.trim() && !busy && !disabled;

  // With no side chats the "new side chat" button lives in the panel header (see App).
  const sideCount = (state?.sessions.length ?? 1) - 1;
  useEffect(() => { onSideCount?.(sideCount); }, [sideCount, onSideCount]);
  const forkRef = useRef(() => {}); forkRef.current = () => { if (!busy && !disabled) fork(); };
  useEffect(() => bus.on('fork', () => forkRef.current()), []);

  return (
    <div className="flex h-full flex-col">
      {state && state.sessions.length > 1 && <SessionChips state={state} onSwitch={switchTo} onClose={closeIt} onFork={() => fork()} disabled={busy || disabled} />}
      <div className={`rp-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-3 ${skills.length ? 'pb-11' : 'pb-3'}`}>
        {!messages.length && (
          <p className="pt-8 text-center text-[13px] leading-relaxed text-ink-3">
            {sid === MAIN_ID ? t.emptyMain : t.emptySide}<br />{!hasSummary && <><span data-no-summary-note>{t.noSummaryChat}</span><br /></>}{t.slashHintPre}<span className="text-ink-2">/</span>{t.slashHintPost}
          </p>
        )}
        {messages.map((m, i) => {
          const streaming = busy && i === messages.length - 1 && m.role === 'assistant';
          return m.role === 'user' ? (
            <div key={i} data-msg="user" className="group flex items-end justify-end gap-1 pl-8" style={{ animation: 'pop-in 200ms cubic-bezier(0.23,1,0.32,1) both' }}>
              <CopyButton reveal tip="bottom" className="mb-0.5" label={t.copyMessage} getText={() => messageMarkdown(m.content)} />
              <div className={`min-w-0 whitespace-pre-wrap break-words rounded-xl px-3 py-1.5 text-[13px] leading-[1.4] ${m.label ? 'bg-accent-tint text-accent-ink' : 'bg-field text-ink'}`} title={m.label ? m.content : undefined}>
                {m.label ?? m.content}
              </div>
            </div>
          ) : (
            <div key={i} data-msg="assistant" className="group">
              <div className="break-words text-[13px] leading-[1.65] text-ink">
                {streaming && !m.content ? (
                  <span className="rp-thinking" role="status"><i /><i /><i /><span>{t.thinking}</span></span>
                ) : (
                  <Markdown text={m.content} streaming={streaming} />
                )}
              </div>
              {/* fixed-height row under the message so the button appearing (after streaming) never moves the layout */}
              <div className="-mb-0.5 mt-0.5 h-5">
                {!streaming && m.content.trim() && <CopyButton reveal label={t.copyMessage} getText={() => messageMarkdown(m.content)} />}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="relative shrink-0">
        <SkillsRow skills={skills} onRun={(s) => runSkill(s)} disabled={busy || disabled} />
        <Composer
          value={input} onChange={setInput} onSubmit={submit} disabled={disabled} canSend={canSend}
          slashItems={showSlash ? items : []} onPickSlash={pickSlash} inputRef={inputRef}
          status={sid === MAIN_ID ? '' : t.current(sessionLabel(getSession(state!, sid)!, lang))}
        />
      </div>
    </div>
  );
}
