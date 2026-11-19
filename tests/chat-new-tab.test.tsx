// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../components/Chat';
import { messages } from '../lib/i18n';
import { closeSession, forkSession, initialState, MAIN_ID, newSession, setActive, type SessionsState } from '../lib/sessions';

vi.mock('../lib/messages', () => ({ CHAT_PORT: 'chat', rpc: vi.fn() }));
vi.mock('../lib/skills', () => ({
  createSkillStore: () => ({ ordered: async () => [], markUsed: async () => {} }),
  localizeSkill: (s: unknown) => s,
  renderTemplate: () => '',
}));
vi.mock('../lib/storage', () => ({ chromeKV: {}, KEYS: { skills: 'skills', skillsRecent: 'skillsRecent' }, onStorageChange: () => () => {} }));
import { rpc } from '../lib/messages';

const t = messages('en');
let root: Root;
let host: HTMLElement;
let sessions: SessionsState;
const connect = vi.fn();

function reply(type: string, req: Record<string, unknown>) {
  if (type === 'getSessions') return { ok: true, state: sessions };
  if (type === 'newSession') {
    const r = newSession(sessions, Date.now(), `chat-${sessions.sessions.length}`);
    sessions = r.state;
    return { ok: true, state: r.state, id: r.id };
  }
  if (type === 'forkSession') {
    const r = forkSession(sessions, String(req.from ?? MAIN_ID), Date.now(), `side-${sessions.sessions.length}`);
    sessions = r.state;
    return { ok: true, state: r.state, id: r.id };
  }
  if (type === 'setActiveSession') {
    sessions = setActive(sessions, String(req.id));
    return { ok: true, state: sessions };
  }
  if (type === 'closeSession') {
    sessions = closeSession(sessions, String(req.id));
    return { ok: true, state: sessions };
  }
  return { ok: false, error: `unexpected ${type}` };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  sessions = initialState([{ role: 'user', content: 'already on main' }, { role: 'assistant', content: 'ok' }], 1);
  connect.mockReset();
  vi.stubGlobal('chrome', { runtime: { connect, sendMessage: vi.fn() }, i18n: { getUILanguage: () => 'en' } });
  vi.mocked(rpc).mockImplementation(async (type: string, req: Record<string, unknown>) => reply(type, req) as never);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const renderChat = async () => {
  await act(async () => root.render(<Chat url="https://example.test/page" pageTitle="Page" hasSummary reloadKey={0} getPage={async () => ({ title: 'Page', content: 'body' })} />));
  await settle();
};
const composer = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label]')!;
const setValue = async (value: string) => {
  const el = composer();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  });
  await settle();
  expect(composer().value).toBe(value);
};
const send = async () => {
  const btn = host.querySelector<HTMLButtonElement>('[data-send]');
  expect(btn).toBeTruthy();
  expect(btn!.disabled).toBe(false);
  await act(async () => { btn!.click(); });
  await settle();
};

describe('new conversation tab and slash commands (no model)', () => {
  it('shows an icon-only New button and creates a focused blank tab, without starting a model request', async () => {
    await renderChat();
    const neu = host.querySelector<HTMLButtonElement>('[data-new-tab]');
    expect(neu).toBeTruthy();
    expect(neu!.getAttribute('aria-label')).toBe(t.newConversationTitle);
    expect(neu!.textContent?.replace(/\s+/g, '')).toBe('');
    await act(async () => neu!.click());
    await settle();
    expect(connect).not.toHaveBeenCalled();
    expect(vi.mocked(rpc).mock.calls.some((c) => c[0] === 'newSession')).toBe(true);
    expect(vi.mocked(rpc).mock.calls.some((c) => c[0] === 'forkSession')).toBe(false);
    expect(host.textContent).toContain(t.chatSession(1));
    expect(host.textContent).toContain(t.emptyChat);
    expect(host.textContent).not.toContain('already on main');
    expect(sessions.active.startsWith('chat-')).toBe(true);
    expect(sessions.sessions.find((s) => s.id === sessions.active)?.messages).toEqual([]);
  });

  it('treats /new locally: opens a tab, keeps trailing text as a draft, and does not send the command', async () => {
    await renderChat();
    await setValue('/new keep this draft');
    await send();
    expect(connect).not.toHaveBeenCalled();
    expect(vi.mocked(rpc).mock.calls.map((c) => c[0])).toContain('newSession');
    expect(composer().value).toBe('keep this draft');
    expect(host.textContent).toContain(t.chatSession(1));
    expect(host.querySelector('[data-msg="user"]')).toBeNull();
  });

  it('keeps /side as a fork of the current history and still does not call the model without a first message', async () => {
    await renderChat();
    await setValue('/side');
    await send();
    expect(connect).not.toHaveBeenCalled();
    expect(vi.mocked(rpc).mock.calls.map((c) => c[0])).toContain('forkSession');
    expect(host.textContent).toContain(t.sideSession(1));
    expect(host.textContent).toContain('already on main');
  });

  it('keeps drafts independent when switching tabs', async () => {
    await renderChat();
    await setValue('draft on main');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-new-tab]')!.click());
    await settle();
    expect(composer().value).toBe('');
    await setValue('draft on new');
    const mainChip = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t.mainSession));
    expect(mainChip).toBeTruthy();
    await act(async () => mainChip!.click());
    await settle();
    expect(composer().value).toBe('draft on main');
    const chatChip = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t.chatSession(1)));
    await act(async () => chatChip!.click());
    await settle();
    expect(composer().value).toBe('draft on new');
    expect(connect).not.toHaveBeenCalled();
  });
});
