// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsButton } from '../components/Capsule';
import { messages } from '../lib/i18n';

/** Content-script chrome: sendMessage exists, openOptionsPage does not. */
const sendMessage = vi.fn(async () => ({ ok: true }));

describe('SettingsButton', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    sendMessage.mockClear();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('asks the background to open options and does not call openOptionsPage itself', () => {
    expect((chrome.runtime as { openOptionsPage?: unknown }).openOptionsPage).toBeUndefined();
    act(() => root.render(<SettingsButton />));
    const btn = host.querySelector('[data-settings]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe(messages('en').settingsShort);
    act(() => { btn.click(); });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'openOptions' });
  });
});
