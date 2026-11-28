import { useEffect, useRef, useState } from 'react';
import { CHAT_PORT, rpc, type ChatEvent, type ChatRequest } from '@/lib/messages';
import { MAIN_ID } from '@/lib/sessions';
import type { ChatMessage } from '@/lib/types';
import { Markdown } from '../Markdown';
import { Button } from '../bui/Button';
import { useT } from '../i18n';

/** PDF chat uses the same sessions, settings and background chat protocol as a webpage, with a PDF-namespaced key. */
export function PdfChat({ url, validate, ensureVisual }: { url: string; validate: () => Promise<void>; ensureVisual?: () => Promise<void> }) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const sid = useRef(MAIN_ID), port = useRef<chrome.runtime.Port | null>(null), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void rpc('getSessions', { url }).then((r) => {
      if (r.ok && alive.current) { sid.current = r.state.active; setMessages(r.state.sessions.find((s) => s.id === r.state.active)?.messages ?? []); }
    });
    return () => { alive.current = false; port.current?.disconnect(); };
  }, [url]);
  const send = async () => {
    if (!input.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await validate(); await ensureVisual?.(); if (!alive.current) return;
      const text = input.trim(); setInput('');
      setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
      const p = chrome.runtime.connect({ name: CHAT_PORT }); port.current = p;
      const stop = () => { if (alive.current) setBusy(false); if (port.current === p) port.current = null; };
      p.onDisconnect.addListener(stop);
      p.onMessage.addListener((msg: ChatEvent) => {
        if (!alive.current) return;
        if ('delta' in msg) setMessages((m) => { const last = m.at(-1); return last ? [...m.slice(0, -1), { ...last, content: last.content + msg.delta }] : m; });
        else {
          if ('done' in msg && msg.text) { const text = msg.text; setMessages((m) => [...m.slice(0, -1), { role: 'assistant', content: text }]); }
          if ('error' in msg) setError(msg.error);
          p.disconnect(); stop();
        }
      });
      p.postMessage({ url, text, sid: sid.current } satisfies ChatRequest);
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); } }
  };
  return <section aria-label={t.pdfChatLabel} className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="rp-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-1" aria-live="polite">
      {messages.map((m, i) => <div key={i} className={m.role === 'user' ? 'rounded-[10px] bg-field px-3 py-2 text-ink' : 'text-ink'}><p className="mb-1 text-[11px] font-medium text-ink-3">{m.role === 'user' ? t.pdfChatYou : 'Representer'}</p><Markdown text={m.content} /></div>)}
      {!messages.length && <p className="text-[13px] text-ink-3">{t.pdfChatEmpty}</p>}
    </div>
    {error && <p role="alert" className="text-[12px] text-red">{error}</p>}
    <form className="space-y-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea aria-label={t.pdfChatInput} value={input} disabled={busy} onChange={(e) => setInput(e.target.value)} rows={3} className="w-full resize-y rounded-[10px] bg-field p-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent-ring" />
      {busy ? <Button type="button" variant="secondary" size="sm" onClick={() => { port.current?.disconnect(); setBusy(false); }}>{t.stop}</Button> : <Button type="submit" size="sm" disabled={!input.trim()}>{t.send}</Button>}
    </form>
  </section>;
}
