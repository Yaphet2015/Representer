// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsButton } from '../components/Capsule';
import { messages } from '../lib/i18n';

const openOptionsPage = vi.fn();

describe('SettingsButton', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    openOptionsPage.mockReset();
    vi.stubGlobal('chrome', { runtime: { openOptionsPage } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('opens the options page with the existing chrome API', () => {
    act(() => root.render(<SettingsButton />));
    const btn = host.querySelector('[data-settings]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe(messages('en').settingsShort);
    act(() => { btn.click(); });
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
