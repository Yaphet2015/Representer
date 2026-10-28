/** Typed message contract between the content script / options page and the background worker. */
import type { CachedSummary } from './cache';
import type { TestResult } from './models';
import type { SessionsState } from './sessions';
import type { Settings, Summary } from './types';
import type { Anchors } from './locate';

/** request → response payload, keyed by message type */
export interface Api {
  getCached: { req: { url: string }; res: { cached: CachedSummary | null } };
  summarize: { req: { url: string; title: string; content: string; force: boolean; anchors?: Anchors }; res: { summary: Summary; anchors?: Anchors } | { cancelled: true } };
  /** abort the running summarize of this page (no cache write, no error) */
  cancelSummarize: { req: { url: string }; res: {} };
  getShortcut: { req: {}; res: { shortcut: string } };
  listModels: { req: { settings: Pick<Settings, 'baseUrl' | 'apiKey'> }; res: { models: string[] } };
  testConnection: { req: { settings: Settings }; res: { result: TestResult } };
  getSessions: { req: { url: string }; res: { state: SessionsState } };
  forkSession: { req: { url: string; from: string }; res: { state: SessionsState; id: string } };
  closeSession: { req: { url: string; id: string }; res: { state: SessionsState } };
  setActiveSession: { req: { url: string; id: string }; res: { state: SessionsState } };
}
export type MsgType = keyof Api;
export type Request = { [K in MsgType]: { type: K } & Api[K]['req'] }[MsgType];
export type Reply<K extends MsgType> = ({ ok: true } & Api[K]['res']) | { ok: false; error: string };

/** Content → background message telling a tab to toggle the overlay. */
export const TOGGLE = { type: 'toggle' } as const;

/** Call the background. Resolves with the typed reply (never rejects on handler errors). */
export async function rpc<K extends MsgType>(type: K, req: Api[K]['req']): Promise<Reply<K>> {
  try {
    return ((await chrome.runtime.sendMessage({ type, ...req })) as Reply<K>) ?? { ok: false, error: 'No response' };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Streaming chat over a long-lived port. */
export const CHAT_PORT = 'chat';
/** `page` is sent when the page has no summary: its text becomes the chat's attachment */
export interface ChatRequest { url: string; text: string; sid: string; label?: string; page?: { title: string; content: string } }
export type ChatEvent = { delta: string } | { done: true; text?: string } | { error: string };
