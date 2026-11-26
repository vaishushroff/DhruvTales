import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  isSupportedLanguage,
  resolveTranslation,
  SUPPORTED_LANGUAGES,
} from '../i18n';
import type { LanguageCode } from '../types';

interface LanguageContextValue {
  lang: LanguageCode;
  supportedLanguages: typeof SUPPORTED_LANGUAGES;
  setLang: (lang: LanguageCode) => void;
  toggleLang: () => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'dhruv_tales_lang';

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (isSupportedLanguage(saved)) return saved;
    } catch {
      // Ignore storage access restrictions
    }
    return 'en';
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore
    }
  }, [lang]);

  const setLang = useCallback((next: LanguageCode) => {
    if (isSupportedLanguage(next)) {
      setLangState(next);
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const idx = SUPPORTED_LANGUAGES.findIndex((l) => l.code === prev);
      const nextIdx = (idx + 1) % SUPPORTED_LANGUAGES.length;
      return SUPPORTED_LANGUAGES[nextIdx]?.code ?? 'en';
    });
  }, []);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>) =>
      resolveTranslation(lang, path, params),
    [lang]
  );

  return (
    <LanguageContext.Provider
      value={{ lang, supportedLanguages: SUPPORTED_LANGUAGES, setLang, toggleLang, t }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
