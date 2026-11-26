import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Play, RefreshCw, Sparkles } from 'lucide-react';
import { StoryArtwork } from '../components/StoryArtwork';
import { StoryCarousel } from '../components/StoryCarousel';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { formatPlayCount } from '../services/access/episodeAccess';
import { resolveSectionStories } from '../services/siteSettings/siteSettingsService';
import type { Category, ListeningHistoryEntry, Story } from '../types';

const HomeSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-12 animate-pulse">
    <div className="h-[360px] sm:h-[440px] rounded-2xl bg-[#141418] border border-white/5" />
    <div className="space-y-4">
      <div className="h-7 w-48 rounded bg-[#1C1C22]" />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="space-y-3">
            <div className="aspect-[3/4] rounded-xl bg-[#141418]" />
            <div className="h-4 w-3/4 rounded bg-[#1C1C22]" />
            <div className="h-3 w-1/2 rounded bg-[#141418]" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const HomePage: React.FC = () => {
  const { lang, t } = useLanguage();
  const {
    categories,
    stories,
    episodes,
    history,
    siteSettings,
    catalogSource,
    catalogLoading,
    catalogError,
    refreshCatalog,
  } = useAppData();
  const { playEpisode } = useAudioPlayer();
  const [bannerIndex, setBannerIndex] = useState(0);

  const categoriesById = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const storiesById = useMemo(() => {
    const map = new Map<string, Story>();
    stories.forEach((s) => map.set(s.id, s));
    return map;
  }, [stories]);

  const progressByStoryId = useMemo(() => {
    const map: Record<string, ListeningHistoryEntry> = {};
    for (const item of history) {
      if (!map[item.storyId]) {
        map[item.storyId] = item;
      }
    }
    return map;
  }, [history]);

  const featuredStory = useMemo(
    () => stories.find((s) => s.isFeatured) ?? stories[0] ?? null,
    [stories]
  );

  const activeBanners = useMemo(
    () =>
      [...siteSettings.heroBanners]
        .filter((b) => b.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [siteSettings.heroBanners]
  );

  const safeBannerIdx =
    activeBanners.length > 0 ? bannerIndex % activeBanners.length : 0;
  const currentBanner = activeBanners[safeBannerIdx] ?? null;

  const heroStory = useMemo(() => {
    if (currentBanner?.storyId) {
      const linked = storiesById.get(currentBanner.storyId);
      if (linked) return linked;
    }
    return featuredStory;
  }, [currentBanner, storiesById, featuredStory]);

  const continueListeningStories = useMemo(() => {
    const seen = new Set<string>();
    const list: Story[] = [];
    for (const item of history) {
      if (seen.has(item.storyId)) continue;
      const story = storiesById.get(item.storyId);
      if (story) {
        seen.add(story.id);
        list.push(story);
      }
    }
    return list;
  }, [history, storiesById]);

  const orderedSections = useMemo(
    () =>
      [...siteSettings.homepageSections]
        .filter((s) => s.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [siteSettings.homepageSections]
  );

  if (catalogLoading && stories.length === 0) {
    return <HomeSkeleton />;
  }

  const handlePlayHeroStory = () => {
    if (!heroStory) return;
    const saved = progressByStoryId[heroStory.id];
    const storyEps = episodes
      .filter((e) => e.storyId === heroStory.id)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
    const targetEp =
      (saved && storyEps.find((e) => e.id === saved.episodeId)) || storyEps[0];
    if (targetEp) {
      void playEpisode(heroStory, targetEp);
    }
  };

  const heroGenre = heroStory ? categoriesById[heroStory.genreId] : undefined;
  const heroProgress = heroStory ? progressByStoryId[heroStory.id] : undefined;

  // Use custom banner title/subtitle only if Admin created a custom banner (not empty default placeholder with no storyId)
  const useCustomBannerCopy = Boolean(
    currentBanner &&
      (currentBanner.id !== 'banner-featured-default' || !heroStory)
  );
  const heroBadge =
    useCustomBannerCopy && currentBanner
      ? (lang === 'hi' ? currentBanner.badgeHi : currentBanner.badgeEn) || t('home.featuredLabel')
      : t('home.featuredLabel');
  const heroTitle =
    useCustomBannerCopy && currentBanner
      ? (lang === 'hi' ? currentBanner.titleHi || currentBanner.titleEn : currentBanner.titleEn)
      : heroStory
        ? lang === 'hi'
          ? heroStory.titleHi
          : heroStory.title
        : siteSettings.branding.appNameEn;
  const heroSubtitle =
    useCustomBannerCopy && currentBanner
      ? (lang === 'hi' ? currentBanner.subtitleHi || currentBanner.subtitleEn : currentBanner.subtitleEn)
      : heroStory
        ? lang === 'hi'
          ? heroStory.synopsisHi
          : heroStory.synopsis
        : '';
  const heroCtaLabel = heroProgress
    ? `${t('home.resumeListening')} ${heroProgress.episodeNumber}`
    : useCustomBannerCopy && currentBanner
      ? (lang === 'hi' ? currentBanner.ctaLabelHi : currentBanner.ctaLabelEn) || t('home.listenNow')
      : t('home.listenNow');

  const getSeeAllRoute = (source: string): string => {
    switch (source) {
      case 'auto_continue':
        return '/library';
      case 'auto_editors_pick':
        return '/search?sort=rating';
      case 'auto_recent':
        return '/search?sort=recent';
      default:
        return '/search?sort=popular';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-12 sm:space-y-14">
      {/* Cloud catalog fallback notice with Retry action */}
      {catalogError && (
        <div
          role="status"
          className="rounded-xl bg-[#141418] border border-[#E5A93C]/35 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#D6D2C9]"
        >
          <span>{catalogError}</span>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] border border-white/15 text-[#F3C669] hover:border-[#E5A93C] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            {t('common.refresh')}
          </button>
        </div>
      )}

      {/* Dynamic Hero Banner / Featured Story */}
      {(heroStory || currentBanner) && (
        <section
          aria-label={t('home.featuredLabel')}
          data-testid="home-hero-banner"
          className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[var(--bg-surface,#141418)] min-h-[380px] sm:min-h-[450px] flex items-end"
        >
          <div className="absolute inset-0">
            {currentBanner?.imageUrl ? (
              <img
                src={currentBanner.imageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : heroStory ? (
              <StoryArtwork
                story={heroStory}
                aspect="landscape"
                useBackdrop
                className="w-full h-full aspect-auto"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0E] via-[#0B0B0E]/65 to-[#0B0B0E]/20 sm:bg-gradient-to-r sm:from-[#0B0B0E] sm:via-[#0B0B0E]/82 sm:to-transparent" />
          </div>

          <div className="relative z-10 w-full max-w-2xl p-6 sm:p-10 lg:p-12 space-y-4">
            <p className="text-xs font-medium text-[var(--accent-gold,#E5A93C)] tracking-wide">
              {heroBadge}
              {heroGenre && (
                <>
                  {' · '}
                  {lang === 'hi' ? heroGenre.nameHi : heroGenre.nameEn}
                </>
              )}
            </p>

            <h1 className="font-display text-3xl sm:text-5xl font-semibold text-[#F5F3EE] leading-[1.1] text-balance">
              {heroTitle}
            </h1>

            <p className="text-sm sm:text-base text-[#D6D2C9] leading-relaxed line-clamp-3 max-w-xl">
              {heroSubtitle}
            </p>

            {heroStory && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#A39E93] tabular-nums">
                <span className="text-[#F5F3EE] font-medium">{heroStory.creatorName}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {heroStory.language === 'hi'
                    ? t('common.hindi')
                    : heroStory.language === 'en'
                      ? t('common.english')
                      : t('common.bilingual')}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {heroStory.episodeCount} {t('common.episodes')}
                </span>
                <span aria-hidden="true">·</span>
                <span>★ {heroStory.rating.toFixed(1)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {formatPlayCount(heroStory.totalPlays)} {t('common.plays')}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {heroStory && (
                <>
                  <button
                    type="button"
                    onClick={handlePlayHeroStory}
                    className="min-h-[44px] px-6 py-2.5 rounded-xl bg-[var(--accent-gold,#E5A93C)] text-[#0B0B0E] text-sm font-semibold hover:bg-[var(--accent-gold-hover,#F3C669)] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                    {heroCtaLabel}
                  </button>

                  <Link
                    to={`/story/${heroStory.id}`}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#141418]/85 border border-white/15 text-sm font-medium text-[#F5F3EE] hover:border-white/35 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    {t('home.viewDetails')}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </>
              )}
            </div>

            {activeBanners.length > 1 && (
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  aria-label="Previous banner"
                  onClick={() =>
                    setBannerIndex((prev) => (prev - 1 + activeBanners.length) % activeBanners.length)
                  }
                  className="min-w-[36px] min-h-[36px] rounded-lg bg-[#0B0B0E]/75 border border-white/15 text-[#F5F3EE] inline-flex items-center justify-center hover:border-[#E5A93C]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5">
                  {activeBanners.map((b, idx) => (
                    <button
                      key={b.id}
                      type="button"
                      aria-label={`Banner ${idx + 1}`}
                      onClick={() => setBannerIndex(idx)}
                      className={`h-2 rounded-full transition-all ${
                        idx === safeBannerIdx ? 'w-6 bg-[#E5A93C]' : 'w-2 bg-white/30'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="Next banner"
                  onClick={() => setBannerIndex((prev) => (prev + 1) % activeBanners.length)}
                  className="min-w-[36px] min-h-[36px] rounded-lg bg-[#0B0B0E]/75 border border-white/15 text-[#F5F3EE] inline-flex items-center justify-center hover:border-[#E5A93C]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Genres Row */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F3EE]">
            {t('home.browseGenres')}
          </h2>
          <Link
            to="/search"
            className="min-h-[44px] inline-flex items-center px-2 text-xs font-medium text-[var(--accent-gold,#E5A93C)] hover:text-[var(--accent-gold-hover,#F3C669)] transition-colors whitespace-nowrap"
          >
            {t('common.seeAll')}
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {categories.map((cat) => {
            const count = stories.filter((s) => s.genreId === cat.id).length;
            return (
              <Link
                key={cat.id}
                to={`/search?genre=${cat.id}`}
                className="group min-h-[68px] p-3.5 rounded-xl bg-[var(--bg-surface,#141418)] border border-white/[0.08] hover:border-[var(--accent-gold,#E5A93C)]/45 transition-colors flex flex-col justify-between"
              >
                <span className="text-sm font-medium text-[#F5F3EE] group-hover:text-[var(--accent-gold-hover,#F3C669)] transition-colors truncate">
                  {lang === 'hi' ? cat.nameHi : cat.nameEn}
                </span>
                <span className="text-[11px] text-[#9B968B] tabular-nums mt-1">
                  {count} {lang === 'hi' ? 'कहानियाँ' : 'series'}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Dynamic Admin-Ordered Homepage Sections */}
      {orderedSections.map((section) => {
        const sectionTitle =
          lang === 'hi' ? section.titleHi || section.titleEn : section.titleEn;
        const sectionStories =
          section.source === 'auto_continue'
            ? continueListeningStories.slice(0, section.maxItems ?? 6)
            : resolveSectionStories(section, stories);

        if (sectionStories.length === 0) return null;

        return (
          <StoryCarousel
            key={section.id}
            title={sectionTitle}
            stories={sectionStories}
            categoriesById={categoriesById}
            progressByStoryId={progressByStoryId}
            seeAllTo={getSeeAllRoute(section.source)}
          />
        );
      })}

      {/* Editable Site Footer + Legal Links + Real vs Simulated Transparency */}
      <footer
        data-testid="home-site-footer"
        className="border-t border-white/[0.08] pt-8 pb-4 space-y-6"
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div className="space-y-2.5 max-w-xl">
            <h2 className="font-display text-lg font-semibold text-[#F5F3EE]">
              {lang === 'hi'
                ? siteSettings.branding.appNameHi || siteSettings.branding.appNameEn
                : siteSettings.branding.appNameEn}
            </h2>
            <p className="text-xs text-[#A39E93] leading-relaxed">
              {lang === 'hi'
                ? siteSettings.footer.aboutHi || siteSettings.footer.aboutEn
                : siteSettings.footer.aboutEn}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs">
              <Link
                to="/legal/terms"
                data-testid="footer-legal-terms"
                className="text-[#D6D2C9] hover:text-[#F3C669] transition-colors"
              >
                {lang === 'hi'
                  ? siteSettings.legalPages.terms.titleHi
                  : siteSettings.legalPages.terms.titleEn}
              </Link>
              <Link
                to="/legal/privacy"
                data-testid="footer-legal-privacy"
                className="text-[#D6D2C9] hover:text-[#F3C669] transition-colors"
              >
                {lang === 'hi'
                  ? siteSettings.legalPages.privacy.titleHi
                  : siteSettings.legalPages.privacy.titleEn}
              </Link>
              <Link
                to="/legal/refund"
                data-testid="footer-legal-refund"
                className="text-[#D6D2C9] hover:text-[#F3C669] transition-colors"
              >
                {lang === 'hi'
                  ? siteSettings.legalPages.refund.titleHi
                  : siteSettings.legalPages.refund.titleEn}
              </Link>
              {siteSettings.branding.supportEmail && (
                <span className="text-[#9B968B]">
                  {siteSettings.branding.supportEmail}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#7E796F]">
              {lang === 'hi'
                ? siteSettings.footer.copyrightHi || siteSettings.footer.copyrightEn
                : siteSettings.footer.copyrightEn}{' '}
              ·{' '}
              {catalogSource === 'firestore'
                ? t('home.catalogSourceFirestore')
                : t('home.catalogSourceLocal')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs shrink-0 max-w-xl">
            <div className="rounded-xl bg-[var(--bg-surface,#141418)] border border-white/[0.08] p-4 space-y-1.5">
              <p className="font-semibold text-[var(--accent-gold,#E5A93C)]">
                {t('common.realBadge')}
              </p>
              <p className="text-[#A39E93] leading-relaxed">
                Firebase Auth, Cloud Firestore catalog &amp; live siteSettings, RBAC security rules, read-only client wallets &amp; immutable coinTransactions ledger, server-side /api/admin/* CMS &amp; analytics, soft-delete + restore with auditLogs, and single-device session protection.
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-surface,#141418)] border border-white/[0.08] p-4 space-y-1.5">
              <p className="font-semibold text-[#A39E93] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#A39E93]" aria-hidden="true" />
                {t('common.simulatedBadge')}
              </p>
              <p className="text-[#A39E93] leading-relaxed">
                DemoMediaProvider fallback audio &amp; video playback, DriveMediaProvider signed proxy (testing/low-traffic), and MockPaymentProvider demo coin checkout (no real charges).
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
