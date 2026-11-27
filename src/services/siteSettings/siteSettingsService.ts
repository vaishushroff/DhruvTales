import { doc, getDoc } from 'firebase/firestore';
import type { SiteSettings } from '../../types';
import { db } from '../firebase/config';
import {
  DEFAULT_HERO_BANNERS,
  DEFAULT_HOMEPAGE_SECTIONS,
  DEFAULT_LANGUAGE_OPTIONS,
  DEFAULT_LEGAL_PAGES,
  DEFAULT_SITE_SETTINGS,
  isValidHexColor,
  resolveSectionStories,
  sanitizeSafeUrl,
  sanitizeSiteSettings,
} from './siteSettingsPure';

export {
  DEFAULT_HERO_BANNERS,
  DEFAULT_HOMEPAGE_SECTIONS,
  DEFAULT_LANGUAGE_OPTIONS,
  DEFAULT_LEGAL_PAGES,
  DEFAULT_SITE_SETTINGS,
  isValidHexColor,
  resolveSectionStories,
  sanitizeSafeUrl,
  sanitizeSiteSettings,
};

const SITE_SETTINGS_STORAGE_KEY = 'dhruvtales_site_settings_cache_v1';

/**
 * Applies validated theme colors and document title from SiteSettings live without redeploy.
 */
export function applySiteThemeToDocument(settings: SiteSettings, lang: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isValidHexColor(settings.branding.accentHex)) {
    root.style.setProperty('--accent-gold', settings.branding.accentHex);
  }
  if (isValidHexColor(settings.branding.accentHoverHex)) {
    root.style.setProperty('--accent-gold-hover', settings.branding.accentHoverHex);
  }
  if (isValidHexColor(settings.branding.bgCanvasHex)) {
    root.style.setProperty('--bg-canvas', settings.branding.bgCanvasHex);
    root.style.backgroundColor = settings.branding.bgCanvasHex;
    if (document.body) {
      document.body.style.backgroundColor = settings.branding.bgCanvasHex;
    }
  }
  if (isValidHexColor(settings.branding.bgSurfaceHex)) {
    root.style.setProperty('--bg-surface', settings.branding.bgSurfaceHex);
  }
  const appName =
    lang === 'hi' && settings.branding.appNameHi
      ? settings.branding.appNameHi
      : settings.branding.appNameEn;
  const tagline =
    lang === 'hi' && settings.branding.taglineHi
      ? settings.branding.taglineHi
      : settings.branding.taglineEn;
  if (appName) {
    document.title = tagline ? `${appName} — ${tagline}` : appName;
  }
}

export function loadCachedSiteSettings(): SiteSettings {
  if (typeof window === 'undefined') return DEFAULT_SITE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SITE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_SETTINGS;
    return sanitizeSiteSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

export function saveCachedSiteSettings(settings: SiteSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SITE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota issues
  }
}

export async function fetchSiteSettings(): Promise<SiteSettings> {
  try {
    const snap = await getDoc(doc(db, 'siteSettings', 'main'));
    if (snap.exists()) {
      const sanitized = sanitizeSiteSettings(snap.data());
      saveCachedSiteSettings(sanitized);
      return sanitized;
    }
  } catch (err) {
    console.warn('Could not fetch siteSettings/main from Firestore; using defaults:', err);
  }
  return loadCachedSiteSettings();
}
