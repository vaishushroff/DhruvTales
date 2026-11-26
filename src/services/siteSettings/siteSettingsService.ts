import { doc, getDoc } from 'firebase/firestore';
import type {
  HeroBannerItem,
  HomepageSectionConfig,
  LanguageOptionSetting,
  LegalPageDocument,
  LegalPageSlug,
  SiteSettings,
  Story,
} from '../../types';
import { db } from '../firebase/config';

const SITE_SETTINGS_STORAGE_KEY = 'dhruvtales_site_settings_cache_v1';

export const DEFAULT_LEGAL_PAGES: Record<LegalPageSlug, LegalPageDocument> = {
  terms: {
    slug: 'terms',
    titleEn: 'Terms of Service',
    titleHi: 'सेवा की शर्तें',
    bodyEn:
      'Welcome to Dhruv Tales. By accessing or listening to stories on this platform, you agree to use your account responsibly on a single active device at a time. Paid episodes unlocked with Coins remain permanently accessible in your account unless the account is suspended for policy violations. All audio, video, and story scripts remain the intellectual property of their respective creators and Dhruv Tales.',
    bodyHi:
      'ध्रुव टेल्स में आपका स्वागत है। इस प्लेटफ़ॉर्म पर कहानियाँ सुनने या देखने से आप एक समय में केवल एक सक्रिय डिवाइस पर अपने खाते का जिम्मेदारी से उपयोग करने के लिए सहमत होते हैं। कॉइन्स से अनलॉक किए गए एपिसोड आपके खाते में स्थायी रूप से उपलब्ध रहते हैं। सभी ऑडियो, वीडियो और कहानियों के अधिकार उनके रचनाकारों और ध्रुव टेल्स के पास सुरक्षित हैं।',
    updatedAt: '2026-01-01',
  },
  privacy: {
    slug: 'privacy',
    titleEn: 'Privacy Policy',
    titleHi: 'गोपनीयता नीति',
    bodyEn:
      'Dhruv Tales collects only the information needed to provide your listening account, resume playback position, bookmarks, coin wallet ledger, and single-device account protection. Your private profile and transaction history are accessible only to you and authorized administrators. You may request account deletion anytime from your Profile page.',
    bodyHi:
      'ध्रुव टेल्स केवल वही जानकारी सहेजता है जो आपके खाते, प्लेबैक प्रोग्रेस, बुकमार्क, कॉइन वॉलेट और सिंगल-डिवाइस सुरक्षा के लिए आवश्यक है। आपकी निजी प्रोफ़ाइल और लेन-देन का विवरण केवल आपके और अधिकृत एडमिन के लिए उपलब्ध है। आप अपनी प्रोफ़ाइल से कभी भी खाता हटा सकते हैं।',
    updatedAt: '2026-01-01',
  },
  refund: {
    slug: 'refund',
    titleEn: 'Coins & Refund Policy',
    titleHi: 'कॉइन्स और रिफंड नीति',
    bodyEn:
      'Coins are digital credits used to unlock individual episodes on Dhruv Tales. Once spent on an episode unlock, Coins are non-refundable except in verified cases of duplicate charges or technical failure. Administrators may issue Coin refunds or wallet adjustments recorded permanently in your transaction ledger. For assistance, reach out to our support email.',
    bodyHi:
      'कॉइन्स डिजिटल क्रेडिट हैं जिनका उपयोग ध्रुव टेल्स पर एपिसोड अनलॉक करने के लिए किया जाता है। एक बार एपिसोड अनलॉक करने पर खर्च किए गए कॉइन्स सामान्यतः वापस नहीं किए जाते, सिवाय तकनीकी त्रुटि या डुप्लिकेट कटौती के मामलों के। सहायता के लिए कृपया हमारे सपोर्ट ईमेल पर संपर्क करें।',
    updatedAt: '2026-01-01',
  },
};

export const DEFAULT_HERO_BANNERS: HeroBannerItem[] = [
  {
    id: 'banner-featured-default',
    titleEn: 'Stories Written in the Night Sky',
    titleHi: 'रात के आकाश में लिखी कहानियाँ',
    subtitleEn:
      'Cinema-grade Hindi and English audio & video dramas. Unlock episodes with Coins, switch seamlessly between Audio and Video, and shape interactive endings.',
    subtitleHi:
      'सिनेमा-स्तरीय हिंदी और अंग्रेज़ी ऑडियो-वीडियो कहानियाँ। कॉइन्स से एपिसोड अनलॉक करें, ऑडियो और वीडियो के बीच स्विच करें, और इंटरैक्टिव अंत चुनें।',
    badgeEn: 'FEATURED SERIES',
    badgeHi: 'विशेष श्रृंखला',
    ctaLabelEn: 'Start Listening',
    ctaLabelHi: 'सुनना शुरू करें',
    storyId: '',
    imageUrl: '',
    active: true,
    sortOrder: 0,
  },
];

export const DEFAULT_HOMEPAGE_SECTIONS: HomepageSectionConfig[] = [
  {
    id: 'sec-continue',
    titleEn: 'Continue Listening',
    titleHi: 'आगे सुनें',
    subtitleEn: 'Pick up right where you paused',
    subtitleHi: 'जहाँ आपने रोका था, वहीं से शुरू करें',
    source: 'auto_continue',
    storyIds: [],
    visible: true,
    sortOrder: 0,
    maxItems: 6,
  },
  {
    id: 'sec-trending',
    titleEn: 'Trending Stories',
    titleHi: 'ट्रेंडिंग कहानियाँ',
    subtitleEn: 'Most listened across India this week',
    subtitleHi: 'इस सप्ताह सबसे ज़्यादा सुनी गई कहानियाँ',
    source: 'auto_trending',
    storyIds: [],
    visible: true,
    sortOrder: 1,
    maxItems: 10,
  },
  {
    id: 'sec-editors',
    titleEn: "Editor's Picks",
    titleHi: 'संपादक की पसंद',
    subtitleEn: 'Handpicked storytelling masterpieces',
    subtitleHi: 'चुनिंदा बेहतरीन कहानियाँ',
    source: 'auto_editors_pick',
    storyIds: [],
    visible: true,
    sortOrder: 2,
    maxItems: 10,
  },
  {
    id: 'sec-popular',
    titleEn: 'Popular Series',
    titleHi: 'लोकप्रिय श्रृंखलाएँ',
    subtitleEn: 'All-time listener favorites',
    subtitleHi: 'श्रोताओं की सदाबहार पसंद',
    source: 'auto_popular',
    storyIds: [],
    visible: true,
    sortOrder: 3,
    maxItems: 10,
  },
  {
    id: 'sec-recent',
    titleEn: 'Recently Added',
    titleHi: 'हाल ही में जोड़ी गईं',
    subtitleEn: 'Fresh premieres and new episodes',
    subtitleHi: 'नई कहानियाँ और ताज़ा एपिसोड',
    source: 'auto_recent',
    storyIds: [],
    visible: true,
    sortOrder: 4,
    maxItems: 10,
  },
];

export const DEFAULT_LANGUAGE_OPTIONS: LanguageOptionSetting[] = [
  { code: 'en', labelEn: 'English', labelNative: 'English', enabled: true },
  { code: 'hi', labelEn: 'Hindi', labelNative: 'हिंदी', enabled: true },
];

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  id: 'main',
  branding: {
    appNameEn: 'Dhruv Tales',
    appNameHi: 'ध्रुव टेल्स',
    taglineEn: 'Bilingual Audio & Video Storytelling',
    taglineHi: 'द्विभाषी ऑडियो और वीडियो कहानियाँ',
    logoUrl: '',
    accentHex: '#E5A93C',
    accentHoverHex: '#F3C669',
    bgCanvasHex: '#0B0B0E',
    bgSurfaceHex: '#141418',
    supportEmail: 'support@dhruvtales.example',
  },
  footer: {
    aboutEn:
      'Dhruv Tales brings atmospheric Indian audio dramas, vertical & widescreen video tales, and interactive storyworlds to listeners everywhere.',
    aboutHi:
      'ध्रुव टेल्स श्रोताओं के लिए भारतीय ऑडियो ड्रामा, वीडियो कहानियाँ और इंटरैक्टिव कथा-जगत लेकर आता है।',
    copyrightEn: '© Dhruv Tales. All rights reserved.',
    copyrightHi: '© ध्रुव टेल्स। सर्वाधिकार सुरक्षित।',
  },
  heroBanners: DEFAULT_HERO_BANNERS,
  homepageSections: DEFAULT_HOMEPAGE_SECTIONS,
  languages: DEFAULT_LANGUAGE_OPTIONS,
  defaultLanguage: 'en',
  legalPages: DEFAULT_LEGAL_PAGES,
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

export function sanitizeSafeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().slice(0, 400);
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? '' : trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

export function sanitizeSiteSettings(raw: unknown): SiteSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SITE_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;
  const rawBrand =
    obj.branding && typeof obj.branding === 'object'
      ? (obj.branding as Record<string, unknown>)
      : {};
  const rawFooter =
    obj.footer && typeof obj.footer === 'object'
      ? (obj.footer as Record<string, unknown>)
      : {};

  const branding = {
    appNameEn:
      typeof rawBrand.appNameEn === 'string' && rawBrand.appNameEn.trim()
        ? rawBrand.appNameEn.trim().slice(0, 60)
        : DEFAULT_SITE_SETTINGS.branding.appNameEn,
    appNameHi:
      typeof rawBrand.appNameHi === 'string' && rawBrand.appNameHi.trim()
        ? rawBrand.appNameHi.trim().slice(0, 60)
        : DEFAULT_SITE_SETTINGS.branding.appNameHi,
    taglineEn:
      typeof rawBrand.taglineEn === 'string'
        ? rawBrand.taglineEn.trim().slice(0, 140)
        : DEFAULT_SITE_SETTINGS.branding.taglineEn,
    taglineHi:
      typeof rawBrand.taglineHi === 'string'
        ? rawBrand.taglineHi.trim().slice(0, 140)
        : DEFAULT_SITE_SETTINGS.branding.taglineHi,
    logoUrl: sanitizeSafeUrl(rawBrand.logoUrl),
    accentHex: isValidHexColor(rawBrand.accentHex)
      ? rawBrand.accentHex.trim()
      : DEFAULT_SITE_SETTINGS.branding.accentHex,
    accentHoverHex: isValidHexColor(rawBrand.accentHoverHex)
      ? rawBrand.accentHoverHex.trim()
      : DEFAULT_SITE_SETTINGS.branding.accentHoverHex,
    bgCanvasHex: isValidHexColor(rawBrand.bgCanvasHex)
      ? rawBrand.bgCanvasHex.trim()
      : DEFAULT_SITE_SETTINGS.branding.bgCanvasHex,
    bgSurfaceHex: isValidHexColor(rawBrand.bgSurfaceHex)
      ? rawBrand.bgSurfaceHex.trim()
      : DEFAULT_SITE_SETTINGS.branding.bgSurfaceHex,
    supportEmail:
      typeof rawBrand.supportEmail === 'string' && rawBrand.supportEmail.trim()
        ? rawBrand.supportEmail.trim().slice(0, 160)
        : DEFAULT_SITE_SETTINGS.branding.supportEmail,
  };

  const footer = {
    aboutEn:
      typeof rawFooter.aboutEn === 'string'
        ? rawFooter.aboutEn.trim().slice(0, 400)
        : DEFAULT_SITE_SETTINGS.footer.aboutEn,
    aboutHi:
      typeof rawFooter.aboutHi === 'string'
        ? rawFooter.aboutHi.trim().slice(0, 400)
        : DEFAULT_SITE_SETTINGS.footer.aboutHi,
    copyrightEn:
      typeof rawFooter.copyrightEn === 'string'
        ? rawFooter.copyrightEn.trim().slice(0, 160)
        : DEFAULT_SITE_SETTINGS.footer.copyrightEn,
    copyrightHi:
      typeof rawFooter.copyrightHi === 'string'
        ? rawFooter.copyrightHi.trim().slice(0, 160)
        : DEFAULT_SITE_SETTINGS.footer.copyrightHi,
  };

  const rawBanners = Array.isArray(obj.heroBanners) ? obj.heroBanners : [];
  const heroBanners: HeroBannerItem[] = rawBanners
    .slice(0, 10)
    .map((item, idx) => {
      const b = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id:
          typeof b.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(b.id)
            ? b.id
            : `banner-${idx + 1}`,
        titleEn: typeof b.titleEn === 'string' ? b.titleEn.trim().slice(0, 140) : '',
        titleHi: typeof b.titleHi === 'string' ? b.titleHi.trim().slice(0, 140) : '',
        subtitleEn: typeof b.subtitleEn === 'string' ? b.subtitleEn.trim().slice(0, 320) : '',
        subtitleHi: typeof b.subtitleHi === 'string' ? b.subtitleHi.trim().slice(0, 320) : '',
        badgeEn: typeof b.badgeEn === 'string' ? b.badgeEn.trim().slice(0, 40) : undefined,
        badgeHi: typeof b.badgeHi === 'string' ? b.badgeHi.trim().slice(0, 40) : undefined,
        ctaLabelEn:
          typeof b.ctaLabelEn === 'string' && b.ctaLabelEn.trim()
            ? b.ctaLabelEn.trim().slice(0, 40)
            : 'Start Listening',
        ctaLabelHi:
          typeof b.ctaLabelHi === 'string' && b.ctaLabelHi.trim()
            ? b.ctaLabelHi.trim().slice(0, 40)
            : 'सुनना शुरू करें',
        storyId: typeof b.storyId === 'string' ? b.storyId.trim().slice(0, 80) : '',
        imageUrl: sanitizeSafeUrl(b.imageUrl),
        active: typeof b.active === 'boolean' ? b.active : true,
        sortOrder:
          typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder)
            ? Math.max(0, Math.min(100, Math.floor(b.sortOrder)))
            : idx,
      };
    })
    .filter((b) => b.titleEn.length > 0 || b.storyId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const validSources = new Set([
    'auto_continue',
    'auto_trending',
    'auto_editors_pick',
    'auto_popular',
    'auto_recent',
    'manual_stories',
  ]);
  const rawSections = Array.isArray(obj.homepageSections) ? obj.homepageSections : [];
  const homepageSections: HomepageSectionConfig[] = rawSections
    .slice(0, 16)
    .map((item, idx) => {
      const s = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const source =
        typeof s.source === 'string' && validSources.has(s.source)
          ? (s.source as HomepageSectionConfig['source'])
          : 'manual_stories';
      const storyIds = Array.isArray(s.storyIds)
        ? s.storyIds
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((x) => x.trim().slice(0, 80))
            .slice(0, 24)
        : [];
      return {
        id:
          typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s.id)
            ? s.id
            : `sec-${idx + 1}`,
        titleEn:
          typeof s.titleEn === 'string' && s.titleEn.trim()
            ? s.titleEn.trim().slice(0, 100)
            : `Section ${idx + 1}`,
        titleHi:
          typeof s.titleHi === 'string' && s.titleHi.trim()
            ? s.titleHi.trim().slice(0, 100)
            : typeof s.titleEn === 'string' && s.titleEn.trim()
              ? s.titleEn.trim().slice(0, 100)
              : `खंड ${idx + 1}`,
        subtitleEn: typeof s.subtitleEn === 'string' ? s.subtitleEn.trim().slice(0, 180) : '',
        subtitleHi: typeof s.subtitleHi === 'string' ? s.subtitleHi.trim().slice(0, 180) : '',
        source,
        storyIds,
        visible: typeof s.visible === 'boolean' ? s.visible : true,
        sortOrder:
          typeof s.sortOrder === 'number' && Number.isFinite(s.sortOrder)
            ? Math.max(0, Math.min(100, Math.floor(s.sortOrder)))
            : idx,
        maxItems:
          typeof s.maxItems === 'number' && Number.isFinite(s.maxItems)
            ? Math.max(1, Math.min(24, Math.floor(s.maxItems)))
            : 10,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rawLangs = Array.isArray(obj.languages) ? obj.languages : [];
  const languages: LanguageOptionSetting[] = rawLangs
    .slice(0, 10)
    .map((item) => {
      const l = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        code: typeof l.code === 'string' ? l.code.trim().toLowerCase().slice(0, 10) : '',
        labelEn: typeof l.labelEn === 'string' ? l.labelEn.trim().slice(0, 40) : '',
        labelNative: typeof l.labelNative === 'string' ? l.labelNative.trim().slice(0, 40) : '',
        enabled: typeof l.enabled === 'boolean' ? l.enabled : true,
      };
    })
    .filter((l) => l.code.length >= 2 && l.labelEn.length > 0);

  const safeLanguages = languages.length > 0 ? languages : DEFAULT_LANGUAGE_OPTIONS;
  // Ensure at least one language stays enabled
  if (!safeLanguages.some((l) => l.enabled)) {
    safeLanguages[0] = { ...safeLanguages[0], enabled: true };
  }

  const rawDefaultLang =
    typeof obj.defaultLanguage === 'string' ? obj.defaultLanguage.trim().toLowerCase() : 'en';
  const defaultLanguage = safeLanguages.some((l) => l.code === rawDefaultLang && l.enabled)
    ? rawDefaultLang
    : safeLanguages.find((l) => l.enabled)?.code ?? 'en';

  const rawLegal =
    obj.legalPages && typeof obj.legalPages === 'object'
      ? (obj.legalPages as Record<string, unknown>)
      : {};
  const sanitizeLegal = (slug: LegalPageSlug): LegalPageDocument => {
    const def = DEFAULT_LEGAL_PAGES[slug];
    const item =
      rawLegal[slug] && typeof rawLegal[slug] === 'object'
        ? (rawLegal[slug] as Record<string, unknown>)
        : {};
    return {
      slug,
      titleEn:
        typeof item.titleEn === 'string' && item.titleEn.trim()
          ? item.titleEn.trim().slice(0, 100)
          : def.titleEn,
      titleHi:
        typeof item.titleHi === 'string' && item.titleHi.trim()
          ? item.titleHi.trim().slice(0, 100)
          : def.titleHi,
      bodyEn:
        typeof item.bodyEn === 'string' && item.bodyEn.trim()
          ? item.bodyEn.trim().slice(0, 8000)
          : def.bodyEn,
      bodyHi:
        typeof item.bodyHi === 'string' && item.bodyHi.trim()
          ? item.bodyHi.trim().slice(0, 8000)
          : def.bodyHi,
      updatedAt:
        typeof item.updatedAt === 'string' && item.updatedAt.trim()
          ? item.updatedAt.trim().slice(0, 32)
          : def.updatedAt,
    };
  };

  return {
    id: 'main',
    branding,
    footer,
    heroBanners: heroBanners.length > 0 ? heroBanners : DEFAULT_HERO_BANNERS,
    homepageSections: homepageSections.length > 0 ? homepageSections : DEFAULT_HOMEPAGE_SECTIONS,
    languages: safeLanguages,
    defaultLanguage,
    legalPages: {
      terms: sanitizeLegal('terms'),
      privacy: sanitizeLegal('privacy'),
      refund: sanitizeLegal('refund'),
    },
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : undefined,
    updatedByUid: typeof obj.updatedByUid === 'string' ? obj.updatedByUid : undefined,
  };
}

/**
 * Pure helper: resolves which stories appear in a configured homepage section.
 */
export function resolveSectionStories(
  section: HomepageSectionConfig,
  publishedStories: Story[]
): Story[] {
  const maxItems = section.maxItems ?? 10;
  const storyMap = new Map(publishedStories.map((s) => [s.id, s]));

  // Start with explicitly pinned stories (valid & published)
  const pinned: Story[] = [];
  const seen = new Set<string>();
  for (const id of section.storyIds ?? []) {
    const found = storyMap.get(id);
    if (found && !seen.has(found.id)) {
      pinned.push(found);
      seen.add(found.id);
    }
  }

  if (section.source === 'manual_stories') {
    return pinned.slice(0, maxItems);
  }

  let autoPool: Story[] = [];
  switch (section.source) {
    case 'auto_trending':
      autoPool = publishedStories.filter((s) => s.isTrending);
      break;
    case 'auto_editors_pick':
      autoPool = publishedStories.filter((s) => s.isEditorsPick);
      break;
    case 'auto_popular':
      autoPool = [...publishedStories].sort((a, b) => b.totalPlays - a.totalPlays);
      break;
    case 'auto_recent':
      autoPool = [...publishedStories].sort(
        (a, b) => Date.parse(b.publishedAt || '0') - Date.parse(a.publishedAt || '0')
      );
      break;
    case 'auto_continue':
    default:
      return [];
  }

  const merged = [...pinned];
  for (const st of autoPool) {
    if (!seen.has(st.id)) {
      merged.push(st);
      seen.add(st.id);
    }
  }
  return merged.slice(0, maxItems);
}

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
