import React, { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BookMarked, Coins, Download, Home, RefreshCw, Search, User, WifiOff } from 'lucide-react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { resolveDisplayIdentity } from '../services/firebase/activityPersistence';
import { AudioPlayerBar } from './AudioPlayerBar';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang, supportedLanguages, setLang, toggleLang, t } = useLanguage();
  const { firebaseUser, profile, wallet, siteSettings, refreshCatalog } = useAppData();
  const identity = resolveDisplayIdentity(profile, firebaseUser);
  const enabledLanguageCodes = new Set(
    siteSettings.languages.filter((l) => l.enabled).map((l) => l.code)
  );
  const visibleLanguages = supportedLanguages.filter((l) =>
    enabledLanguageCodes.size > 0 ? enabledLanguageCodes.has(l.code) : true
  );
  const brandName =
    lang === 'hi'
      ? siteSettings.branding.appNameHi || t('brand.name')
      : siteSettings.branding.appNameEn || t('brand.name');
  const { currentEpisode } = useAudioPlayer();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const isOnline = useOnlineStatus();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (!showIOSGuide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowIOSGuide(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showIOSGuide]);

  const canAccessStudio = profile?.role === 'creator' || profile?.role === 'admin';
  const canAccessAdmin = profile?.role === 'admin';

  const desktopNavItems = [
    { to: '/', label: t('nav.home'), end: true },
    { to: '/search', label: t('nav.search'), end: false },
    { to: '/library', label: t('nav.library'), end: false },
    { to: '/wallet', label: t('nav.wallet'), end: false },
    ...(canAccessStudio ? [{ to: '/studio', label: t('nav.studio'), end: false }] : []),
    ...(canAccessAdmin ? [{ to: '/admin', label: t('nav.admin'), end: false }] : []),
  ];

  const mobileNavItems = [
    { to: '/', label: t('nav.home'), icon: Home, end: true },
    { to: '/search', label: t('nav.search'), icon: Search, end: false },
    { to: '/library', label: t('nav.library'), icon: BookMarked, end: false },
    { to: '/wallet', label: t('nav.wallet'), icon: Coins, end: false },
    { to: '/profile', label: t('nav.profile'), icon: User, end: false },
  ];

  // Ensure scrollable content clears fixed mobile nav + safe area + optional mini-player
  const bottomPaddingClass = currentEpisode ? 'pb-44 md:pb-28' : 'pb-28 md:pb-14';

  return (
    <div className="min-h-screen bg-[var(--bg-canvas,#0B0B0E)] text-[#F5F3EE] flex flex-col overflow-x-clip">
      {/* Keyboard Skip-to-Content Link */}
      <a
        href="#main-content"
        data-testid="skip-to-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:min-h-[44px] focus:px-4 focus:rounded-xl focus:bg-[var(--accent-gold,#E5A93C)] focus:text-[#0B0B0E] focus:text-sm focus:font-semibold focus:inline-flex focus:items-center focus:shadow-lg"
      >
        {lang === 'hi' ? 'मुख्य सामग्री पर जाएँ' : 'Skip to main content'}
      </a>

      {/* Desktop & Mobile Top Navigation Bar */}
      <header className="sticky top-0 z-30 safe-top bg-[var(--bg-canvas,#0B0B0E)]/92 backdrop-blur-md border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            data-testid="header-brand-name"
            className="min-h-[44px] inline-flex items-center gap-2 font-display text-lg sm:text-xl font-semibold tracking-tight text-[#F5F3EE] hover:text-[var(--accent-gold-hover,#F3C669)] transition-colors whitespace-nowrap shrink-0"
          >
            {siteSettings.branding.logoUrl && (
              <img
                src={siteSettings.branding.logoUrl}
                alt=""
                className="w-7 h-7 rounded-lg object-cover border border-white/10"
              />
            )}
            <span>{brandName}</span>
          </Link>

          {/* Zone 2: Clean single-line text nav links (Desktop) */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-5 lg:gap-6 text-sm font-medium"
          >
            {desktopNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `min-h-[44px] min-w-[44px] px-1.5 inline-flex items-center justify-center border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'text-[#F5F3EE] border-[#E5A93C]'
                      : 'text-[#A39E93] border-transparent hover:text-[#F5F3EE]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Zone 3: Language Switcher & Primary Account Action */}
          <div className="flex items-center gap-2 shrink-0">
            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={() => void install()}
                aria-label="Install Dhruv Tales app"
                className="inline-flex min-h-[44px] px-3 rounded-lg border border-white/10 text-xs font-medium text-[#D6D2C9] hover:text-[#F5F3EE] hover:border-white/25 items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            )}

            {!isInstalled && !isInstallable && isIOS && (
              <button
                type="button"
                onClick={() => setShowIOSGuide(true)}
                className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 px-3 rounded-lg border border-white/10 text-xs font-medium text-[#D6D2C9] hover:text-[#F5F3EE] transition-colors whitespace-nowrap shrink-0"
              >
                Install on iOS
              </button>
            )}

            {visibleLanguages.length <= 1 ? null : visibleLanguages.length === 2 ? (
              <button
                type="button"
                data-testid="language-switcher"
                onClick={toggleLang}
                aria-label="Switch interface language"
                className="min-h-[44px] px-3 rounded-lg border border-white/10 bg-[var(--bg-surface,#141418)] text-xs font-medium text-[#F5F3EE] hover:border-[var(--accent-gold,#E5A93C)]/50 transition-colors whitespace-nowrap shrink-0"
              >
                {lang === 'en' ? 'EN / हिंदी' : 'हिंदी / EN'}
              </button>
            ) : (
              <select
                data-testid="language-switcher"
                aria-label="Select interface language"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="min-h-[44px] px-2.5 rounded-lg border border-white/10 bg-[var(--bg-surface,#141418)] text-xs font-medium text-[#F5F3EE]"
              >
                {visibleLanguages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeLabel} ({l.label})
                  </option>
                ))}
              </select>
            )}

            <Link
              to="/wallet"
              data-testid="header-coin-balance"
              aria-label={`${t('wallet.balanceLabel')}: ${wallet.balance} ${t('coins.unit')}`}
              className="min-h-[44px] px-2.5 sm:px-3 rounded-lg border border-[#E5A93C]/35 bg-[#141418] text-xs font-semibold text-[#F3C669] hover:border-[#E5A93C] hover:bg-[#1B1A16] transition-colors inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap shrink-0"
            >
              <Coins className="w-3.5 h-3.5 text-[#E5A93C] shrink-0" aria-hidden="true" />
              <span>{wallet.balance.toLocaleString()}</span>
            </Link>

            <Link
              to="/profile"
              aria-label={
                identity.isSignedIn
                  ? `Account profile (${identity.displayName})`
                  : t('nav.signIn')
              }
              className="min-h-[44px] min-w-[44px] px-3.5 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors inline-flex items-center justify-center whitespace-nowrap shrink-0"
            >
              {identity.isSignedIn ? identity.avatarInitials : t('nav.signIn')}
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className={`flex-1 focus:outline-none ${bottomPaddingClass}`}>
        {children}
      </main>

      {/* Offline Indicator with Retry */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          data-testid="offline-banner"
          className="fixed top-20 right-3 left-3 sm:left-auto sm:right-4 z-50 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1C1C22] border border-[#E5A93C]/45 px-4 py-2.5 text-xs text-[#F5F3EE] shadow-xl max-w-md"
        >
          <span className="inline-flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
            <span>
              {lang === 'hi'
                ? 'ऑफ़लाइन मोड — कैश्ड कैटलॉग और लोकल ऑडियो उपलब्ध हैं।'
                : 'Offline Mode — cached catalog & local audio available.'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            className="min-h-[44px] px-3 rounded-lg bg-[#141418] border border-white/15 text-[#F3C669] font-semibold inline-flex items-center gap-1.5 hover:border-[#E5A93C] transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {lang === 'hi' ? 'पुनः प्रयास' : 'Retry'}
          </button>
        </div>
      )}

      {/* Persistent Audio Mini-Player & Full-Screen Player */}
      <AudioPlayerBar />

      {/* Mobile Bottom Navigation Bar (5 destinations, 64px + safe-area inset) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom bg-[#0B0B0E]/95 backdrop-blur-md border-t border-white/10"
      >
        <div className="grid grid-cols-5 h-16">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center min-h-[44px] text-[11px] font-medium transition-colors ${
                    isActive ? 'text-[#E5A93C]' : 'text-[#A39E93] hover:text-[#F5F3EE]'
                  }`
                }
              >
                <Icon className="w-5 h-5 mb-1" aria-hidden="true" />
                <span className="truncate max-w-[68px]">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* iOS Install Instructions Modal */}
      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install Dhruv Tales on iOS"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#141418] border border-white/10 p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-[#F5F3EE]">
              Install Dhruv Tales on iOS
            </h2>
            <p className="text-sm text-[#A39E93] leading-relaxed">
              1. Tap the <strong>Share</strong> icon in your Safari toolbar.
              <br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
