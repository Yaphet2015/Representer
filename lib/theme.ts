import type { ThemePref } from './types';
export type Theme = 'light' | 'dark';
export const resolveTheme = (pref: ThemePref | undefined, systemDark: boolean): Theme =>
  pref === 'light' || pref === 'dark' ? pref : systemDark ? 'dark' : 'light';
