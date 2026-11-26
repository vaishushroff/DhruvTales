import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import { StoryCard } from '../components/StoryCard';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { filterAndSortStories } from '../services/access/episodeAccess';
import type { Category, ListeningHistoryEntry } from '../types';

const RESULTS_PAGE_SIZE = 10;

export const SearchPage: React.FC = () => {
  const { lang, t } = useLanguage();
  const { categories, creators, stories, history, catalogLoading } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQueryText = searchParams.get('q') ?? '';
  const selectedGenre = searchParams.get('genre') ?? 'all';
  const selectedLang = searchParams.get('lang') ?? 'all';
  const selectedCreator = searchParams.get('creator') ?? 'all';
  const sortBy = (searchParams.get('sort') as 'popular' | 'rating' | 'recent') || 'popular';

  // Local search state + 200ms debounce so typing stays crisp and avoids thrashing URL/filter work
  const [inputValue, setInputValue] = useState(urlQueryText);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQueryText);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);

  useEffect(() => {
    setInputValue(urlQueryText);
    setDebouncedQuery(urlQueryText);
  }, [urlQueryText]);

  const updateParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!value || value === 'all') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(inputValue);
      if (inputValue !== urlQueryText) {
        updateParam('q', inputValue);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [inputValue, urlQueryText, updateParam]);

  // Reset pagination whenever active filters change
  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [debouncedQuery, selectedGenre, selectedLang, selectedCreator, sortBy]);

  const resetFilters = () => {
    setInputValue('');
    setDebouncedQuery('');
    setVisibleCount(RESULTS_PAGE_SIZE);
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const categoriesById = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const progressByStoryId = useMemo(() => {
    const map: Record<string, ListeningHistoryEntry> = {};
    for (const item of history) {
      if (!map[item.storyId]) map[item.storyId] = item;
    }
    return map;
  }, [history]);

  const results = useMemo(
    () =>
      filterAndSortStories(stories, {
        query: debouncedQuery,
        genreId: selectedGenre,
        language: selectedLang,
        creatorId: selectedCreator,
        sortBy,
      }),
    [stories, debouncedQuery, selectedGenre, selectedLang, selectedCreator, sortBy]
  );

  const visibleResults = useMemo(
    () => results.slice(0, visibleCount),
    [results, visibleCount]
  );

  const hasMoreResults = visibleCount < results.length;

  const hasActiveFilters =
    Boolean(inputValue) ||
    selectedGenre !== 'all' ||
    selectedLang !== 'all' ||
    selectedCreator !== 'all';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Page Heading */}
      <div className="space-y-1.5">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
          {t('search.title')}
        </h1>
        <p className="text-sm text-[#A39E93]">{t('search.subtitle')}</p>
      </div>

      {/* Search Bar & Filters */}
      <div className="space-y-5">
        <div className="relative">
          <label htmlFor="story-search-input" className="sr-only">
            {t('search.placeholder')}
          </label>
          <SearchIcon
            className="w-4 h-4 text-[#A39E93] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="story-search-input"
            type="search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full min-h-[48px] pl-11 pr-12 rounded-xl bg-[#141418] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#9B968B] focus:outline-none focus:border-[#E5A93C]"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                setDebouncedQuery('');
                updateParam('q', '');
              }}
              aria-label="Clear search query"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#A39E93] hover:text-[#F5F3EE]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Interactive Genre Filter Bar */}
        <div className="space-y-2">
          <span className="text-xs font-medium text-[#A39E93] block">
            {t('search.genreLabel')}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={selectedGenre === 'all'}
              onClick={() => updateParam('genre', 'all')}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                selectedGenre === 'all'
                  ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                  : 'bg-[#141418] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]'
              }`}
            >
              {t('common.all')}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                aria-pressed={selectedGenre === cat.id}
                onClick={() => updateParam('genre', cat.id)}
                className={`min-h-[44px] px-4 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedGenre === cat.id
                    ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                    : 'bg-[#141418] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]'
                }`}
              >
                {lang === 'hi' ? cat.nameHi : cat.nameEn}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Filters Row: Language, Creator, Sort */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Language segmented buttons */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[#A39E93] block">
              {t('search.languageLabel')}
            </span>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#141418] border border-white/10">
              {[
                { id: 'all', label: t('common.all') },
                { id: 'hi', label: t('common.hindi') },
                { id: 'en', label: t('common.english') },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={selectedLang === opt.id}
                  onClick={() => updateParam('lang', opt.id)}
                  className={`min-h-[44px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    selectedLang === opt.id
                      ? 'bg-[#25252E] text-[#F5F3EE]'
                      : 'text-[#A39E93] hover:text-[#F5F3EE]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Creator Select */}
          <div className="space-y-1.5">
            <label htmlFor="creator-filter" className="text-xs font-medium text-[#A39E93] block">
              {t('search.creatorLabel')}
            </label>
            <select
              id="creator-filter"
              value={selectedCreator}
              onChange={(e) => updateParam('creator', e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
            >
              <option value="all">{t('common.all')}</option>
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Select */}
          <div className="space-y-1.5">
            <label htmlFor="sort-filter" className="text-xs font-medium text-[#A39E93] block">
              {t('search.sortLabel')}
            </label>
            <select
              id="sort-filter"
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-xl bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
            >
              <option value="popular">{t('search.sortPopular')}</option>
              <option value="rating">{t('search.sortRating')}</option>
              <option value="recent">{t('search.sortRecent')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-3">
        <p className="text-xs text-[#A39E93] tabular-nums" aria-live="polite">
          {catalogLoading && stories.length === 0 ? (
            <span>{t('common.loading')}</span>
          ) : (
            <>
              <strong className="text-[#F5F3EE]">{results.length}</strong> {t('search.resultsCount')}
            </>
          )}
        </p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="min-h-[44px] px-3 text-xs font-medium text-[#E5A93C] hover:text-[#F3C669] transition-colors"
          >
            {t('search.clearFilters')}
          </button>
        )}
      </div>

      {/* Results Grid, Loading Skeleton, or Empty State */}
      {catalogLoading && stories.length === 0 ? (
        <div
          aria-label={t('common.loading')}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5 animate-pulse"
        >
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="space-y-2.5">
              <div className="aspect-[3/4] rounded-xl bg-[#141418]" />
              <div className="h-3.5 w-3/4 rounded bg-[#141418]" />
              <div className="h-3 w-1/2 rounded bg-[#141418]" />
            </div>
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center space-y-3">
          <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
            {t('search.emptyTitle')}
          </h2>
          <p className="text-sm text-[#A39E93] max-w-md mx-auto">{t('search.emptyBody')}</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-2 min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors"
          >
            {t('search.clearFilters')}
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {visibleResults.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                category={categoriesById[story.genreId]}
                progress={progressByStoryId[story.id]}
              />
            ))}
          </div>

          {hasMoreResults && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                data-testid="search-load-more"
                onClick={() => setVisibleCount((prev) => prev + RESULTS_PAGE_SIZE)}
                className="min-h-[44px] px-6 rounded-xl bg-[#141418] border border-white/15 text-xs font-semibold text-[#F5F3EE] hover:border-[#E5A93C]/50 hover:text-[#F3C669] transition-colors tabular-nums"
              >
                {lang === 'hi'
                  ? `और कहानियाँ लोड करें (${results.length - visibleResults.length} शेष)`
                  : `Load More Stories (${results.length - visibleResults.length} more)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
