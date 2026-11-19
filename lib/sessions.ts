import { messages, type Lang } from './i18n';
import type { ChatMessage } from './types';

export interface ChatSession { id: string; name: string; messages: ChatMessage[]; parent?: string; createdAt: number }
export interface SessionsState { active: string; sessions: ChatSession[] }

export const MAIN_ID = 'main';

export function initialState(mainMessages: ChatMessage[] = [], now = Date.now()): SessionsState {
  return { active: MAIN_ID, sessions: [{ id: MAIN_ID, name: '主线', messages: mainMessages, createdAt: now }] };
}

/** Parse "/side [message]". Returns null when the text is not a /side command. */
export function parseSide(text: string): { message: string } | null {
  const m = text.trim().match(/^\/side(?:\s+([\s\S]*))?$/i);
  return m ? { message: (m[1] ?? '').trim() } : null;
}

/** Parse "/new [draft]". Returns null when the text is not a /new command. Trailing text is a draft, not a message to send. */
export function parseNew(text: string): { draft: string } | null {
  const m = text.trim().match(/^\/new(?:\s+([\s\S]*))?$/i);
  return m ? { draft: (m[1] ?? '').trim() } : null;
}

function nextNumber(state: SessionsState, re: RegExp): number {
  const nums = state.sessions.map((s) => s.name.match(re)?.[1]).filter(Boolean).map(Number);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
function nextSideNumber(state: SessionsState): number {
  return nextNumber(state, /^(?:支线|Side) (\d+)$/);
}
function nextChatNumber(state: SessionsState): number {
  return nextNumber(state, /^(?:对话|Chat) (\d+)$/);
}

/** Fork `fromId` into a new side session (deep-copied history) and make it active. Pure. */
export function forkSession(state: SessionsState, fromId: string, now = Date.now(), id = `side-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`): { state: SessionsState; id: string } {
  const src = state.sessions.find((s) => s.id === fromId) ?? state.sessions[0]!;
  const side: ChatSession = {
    id, name: `支线 ${nextSideNumber(state)}`, parent: src.id, createdAt: now,
    messages: src.messages.filter((m) => m.content).map((m) => ({ ...m })),
  };
  return { state: { active: id, sessions: [...state.sessions, side] }, id };
}

/** Open a blank conversation tab (no copied history, no parent) and make it active. Pure. */
export function newSession(state: SessionsState, now = Date.now(), id = `chat-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`): { state: SessionsState; id: string } {
  const chat: ChatSession = { id, name: `对话 ${nextChatNumber(state)}`, messages: [], createdAt: now };
  return { state: { active: id, sessions: [...state.sessions, chat] }, id };
}

/** Close a side session (main can't be closed); falls back to main if it was active. Pure. */
export function closeSession(state: SessionsState, id: string): SessionsState {
  if (id === MAIN_ID) return state;
  const sessions = state.sessions.filter((s) => s.id !== id);
  return { sessions, active: state.active === id || !sessions.some((s) => s.id === state.active) ? MAIN_ID : state.active };
}

export function setActive(state: SessionsState, id: string): SessionsState {
  return state.sessions.some((s) => s.id === id) ? { ...state, active: id } : state;
}

export function appendMessages(state: SessionsState, id: string, msgs: ChatMessage[]): SessionsState {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? { ...s, messages: [...s.messages, ...msgs] } : s)) };
}

/** Display name in the UI language. Stored names stay as created ("主线", "支线 N"). */
export function sessionLabel(s: Pick<ChatSession, 'id' | 'name'>, lang: Lang): string {
  const t = messages(lang);
  if (s.id === MAIN_ID) return t.mainSession;
  const side = s.name.match(/^(?:支线|Side) (\d+)$/)?.[1];
  if (side) return t.sideSession(Number(side));
  const chat = s.name.match(/^(?:对话|Chat) (\d+)$/)?.[1];
  return chat ? t.chatSession(Number(chat)) : s.name;
}

export function getSession(state: SessionsState, id: string): ChatSession | undefined {
  return state.sessions.find((s) => s.id === id);
}
