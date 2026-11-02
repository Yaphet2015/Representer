import { useEffect, useState } from 'react';
import { KEYS, loadSettings, onStorageChange } from '@/lib/storage';
import { resolveTheme, type Theme } from '@/lib/theme';
import type { ThemePref } from '@/lib/types';

const mq = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** The resolved theme: the user's setting (system / light / dark), following the OS live when set to system. */
export function useTheme(): Theme {
  const [pref, setPref] = useState<ThemePref>('system');
  const [sys, setSys] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const load = () => loadSettings().then((s) => setPref(s.theme ?? 'system'));
    load();
    const off = onStorageChange([KEYS.settings], load);
    const m = mq(); const on = (e: MediaQueryListEvent) => setSys(e.matches);
    m?.addEventListener('change', on);
    return () => { off(); m?.removeEventListener('change', on); };
  }, []);
  return resolveTheme(pref, sys);
}
