import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { messages, resolveLang, uiLanguage, type Lang, type Messages } from '@/lib/i18n';
import { KEYS, loadSettings, onStorageChange } from '@/lib/storage';

const LangContext = createContext<Lang>('en');

/** Resolves the UI language from settings (auto/zh-CN/en) and the browser, and follows changes live. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => resolveLang('auto', uiLanguage()));
  useEffect(() => {
    const load = () => loadSettings().then((s) => setLang(resolveLang(s.lang, uiLanguage())));
    load();
    return onStorageChange([KEYS.settings], load);
  }, []);
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** Fixed language, used in tests so a tree can be rendered without reading settings. */
export function FixedLang({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = (): Lang => useContext(LangContext);
export const useT = (): Messages => messages(useContext(LangContext));
