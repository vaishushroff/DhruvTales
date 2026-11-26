import en from './en.json';
import hi from './hi.json';
import type { LanguageCode } from '../types';

export type TranslationDictionary = typeof en;

export interface LanguageRegistration {
  code: LanguageCode;
  label: string;
  nativeLabel: string;
  messages: TranslationDictionary;
}

/**
 * Single-line extensible i18n registry.
 * To add any new Indian language (e.g., Marathi 'mr', Gujarati 'gu', Tamil 'ta'):
 *   1. Add `<code >.json` in `src/i18n/` matching `en.json` keys
 *   2. Add ONE line below to `LANGUAGE_CONFIG`.
 */
export const LANGUAGE_CONFIG: LanguageRegistration[] = [
  { code: 'en', label: 'English', nativeLabel: 'EN', messages: en },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिंदी', messages: hi },
];

export const SUPPORTED_LANGUAGES = LANGUAGE_CONFIG.map(({ code, label, nativeLabel }) => ({
  code,
  label,
  nativeLabel,
}));

const MESSAGES_BY_CODE: Record<string, TranslationDictionary> = Object.fromEntries(
  LANGUAGE_CONFIG.map((entry) => [entry.code, entry.messages])
);

export function isSupportedLanguage(code: string | null | undefined): code is LanguageCode {
  return Boolean(code && code in MESSAGES_BY_CODE);
}

function lookupPath(dict: unknown, path: string): string | null {
  const parts = path.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof current === 'string' ? current : null;
}

export function resolveTranslation(
  lang: LanguageCode,
  path: string,
  params?: Record<string, string | number>
): string {
  const activeDict = MESSAGES_BY_CODE[lang] ?? en;
  const raw = lookupPath(activeDict, path) ?? lookupPath(en, path) ?? path;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_match, key: string) =>
    key in params ? String(params[key]) : `{${key}}`
  );
}
