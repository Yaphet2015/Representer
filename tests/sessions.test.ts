import { describe, expect, it } from 'vitest';
import { appendMessages, closeSession, forkSession, initialState, MAIN_ID, newSession, parseNew, parseSide, setActive, sessionLabel } from '../lib/sessions';
import { createCache } from '../lib/cache';
import { memKV } from '../lib/storage';


describe('parseSide', () => {
  it('parses /side with and without a message', () => {
    expect(parseSide('/side')).toEqual({ message: '' });
    expect(parseSide('  /side   换个角度说说 ')).toEqual({ message: '换个角度说说' });
    expect(parseSide('/SIDE hi\nthere')).toEqual({ message: 'hi\nthere' });
    expect(parseSide('/sidebar')).toBeNull();
    expect(parseSide('hello /side')).toBeNull();
  });
});

describe('parseNew', () => {
  it('parses /new with and without a draft, and rejects lookalikes', () => {
    expect(parseNew('/new')).toEqual({ draft: '' });
    expect(parseNew('  /NEW   keep this ')).toEqual({ draft: 'keep this' });
    expect(parseNew('/new line1\nline2')).toEqual({ draft: 'line1\nline2' });
    expect(parseNew('/newest')).toBeNull();
    expect(parseNew('hello /new')).toBeNull();
  });
});

describe('newSession', () => {
  const base = initialState([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }], 1);
  it('opens a blank tab, focuses it, and does not copy history', () => {
    const { state, id } = newSession(base, 2, 'chat-a');
    expect(state.active).toBe('chat-a');
    const chat = state.sessions.find((s) => s.id === id)!;
    expect(chat.name).toBe('对话 1');
    expect(chat.parent).toBeUndefined();
    expect(chat.messages).toEqual([]);
    expect(state.sessions[0]!.messages).toEqual(base.sessions[0]!.messages);
    expect(sessionLabel(chat, 'en')).toBe('Chat 1');
    expect(sessionLabel(chat, 'zh-CN')).toBe('对话 1');
    const second = newSession(state, 3, 'chat-b');
    expect(second.state.sessions.map((s) => s.name)).toEqual(['主线', '对话 1', '对话 2']);
    expect(second.state.active).toBe('chat-b');
  });
  it('stays independent of side chats and keeps numbering after a close', () => {
    const forked = forkSession(base, MAIN_ID, 2, 'side-a').state;
    const opened = newSession(forked, 3, 'chat-a').state;
    expect(opened.sessions.map((s) => s.name)).toEqual(['主线', '支线 1', '对话 1']);
    const closed = closeSession(opened, 'chat-a');
    expect(closed.active).toBe(MAIN_ID);
    expect(newSession(closed, 4, 'chat-b').state.sessions.at(-1)!.name).toBe('对话 1');
    const later = forkSession(closed, MAIN_ID, 5, 'side-b').state;
    expect(later.sessions.at(-1)!.name).toBe('支线 2');
  });
});

describe('forkSession', () => {
  const base = initialState([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'assistant', content: '' }], 1);
  it('copies history (dropping empty placeholders), names sequentially, activates the side', () => {
    const { state, id } = forkSession(base, MAIN_ID, 2, 'side-a');
    expect(state.active).toBe('side-a');
    const side = state.sessions.find((s) => s.id === id)!;
    expect(side.name).toBe('支线 1'); expect(side.parent).toBe(MAIN_ID);
    expect(side.messages).toEqual([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }]);
    const second = forkSession(state, 'side-a', 3, 'side-b');
    expect(second.state.sessions.map((s) => s.name)).toEqual(['主线', '支线 1', '支线 2']);
    expect(second.state.sessions[2]!.parent).toBe('side-a');
  });
  it('diverges after the fork (no shared references)', () => {
    const { state, id } = forkSession(base, MAIN_ID, 2, 'side-a');
    const s2 = appendMessages(state, id, [{ role: 'user', content: 'only in side' }]);
    expect(s2.sessions[0]!.messages).toHaveLength(3);
    expect(s2.sessions[1]!.messages.at(-1)!.content).toBe('only in side');
    s2.sessions[1]!.messages[0]!.content = 'mutated';
    expect(base.sessions[0]!.messages[0]!.content).toBe('q1');
  });
  it('close falls back to main; main cannot be closed; numbering continues after close', () => {
    const a = forkSession(base, MAIN_ID, 2, 'a').state;
    const b = forkSession(a, MAIN_ID, 3, 'b').state;
    const closed = closeSession(b, 'b');
    expect(closed.active).toBe(MAIN_ID); expect(closed.sessions.map((s) => s.id)).toEqual([MAIN_ID, 'a']);
    expect(closeSession(closed, MAIN_ID)).toBe(closed);
    expect(setActive(closed, 'a').active).toBe('a');
    expect(setActive(closed, 'nope').active).toBe(MAIN_ID);
    expect(forkSession(closed, MAIN_ID, 4, 'c').state.sessions.at(-1)!.name).toBe('支线 2');
  });
  it('persists per page and migrates the legacy chat key; re-summarize clears sessions', async () => {
    const kv = memKV(); const c = createCache(kv);
    await kv.set('chat:u', [{ role: 'user', content: 'legacy' }]);
    const s = await c.getSessions('u');
    expect(s.sessions[0]!.messages[0]!.content).toBe('legacy');
    const { state } = forkSession(s, MAIN_ID, 5, 'x');
    await c.setSessions('u', state);
    expect((await c.getSessions('u')).sessions.map((x) => x.id)).toEqual([MAIN_ID, 'x']);
    expect((await c.getSessions('other')).sessions).toHaveLength(1);
    await c.clearSummary('u');
    expect((await c.getSessions('u')).sessions).toHaveLength(1);
  });
});
