import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Trash2, UserCheck } from 'lucide-react';
import { StoryArtwork } from '../components/StoryArtwork';
import { StoryCard } from '../components/StoryCard';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { formatDuration } from '../services/access/episodeAccess';
import type { Category } from '../types';

type LibraryTab = 'history' | 'bookmarks' | 'favorites' | 'following' | 'unlocks';

export const LibraryPage: React.FC = () => {
  const { lang, t } = useLanguage();
  const {
    firebaseUser,
    categories,
    creators,
    stories,
    episodes,
    history,
    bookmarks,
    episodeUnlocks,
    dailyUnlocks,
    toggleBookmark,
  } = useAppData();
  const { playEpisode } = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<LibraryTab>('history');

  const categoriesById = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const bookmarkedStories = useMemo(() => {
    const ids = new Set(
      bookmarks.filter((b) => b.targetType === 'story_bookmark').map((b) => b.targetId)
    );
    return stories.filter((s) => ids.has(s.id));
  }, [bookmarks, stories]);

  const favoriteStories = useMemo(() => {
    const ids = new Set(
      bookmarks.filter((b) => b.targetType === 'story_favorite').map((b) => b.targetId)
    );
    return stories.filter((s) => ids.has(s.id));
  }, [bookmarks, stories]);

  const followedCreators = useMemo(() => {
    const ids = new Set(
      bookmarks.filter((b) => b.targetType === 'creator_follow').map((b) => b.targetId)
    );
    return creators.filter((c) => ids.has(c.id));
  }, [bookmarks, creators]);

  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: 'history', label: t('library.tabHistory'), count: history.length },
    { id: 'bookmarks', label: t('library.tabBookmarks'), count: bookmarkedStories.length },
    { id: 'favorites', label: t('library.tabFavorites'), count: favoriteStories.length },
    { id: 'following', label: t('library.tabFollowing'), count: followedCreators.length },
    {
      id: 'unlocks',
      label: t('library.tabUnlocks'),
      count: episodeUnlocks.length + dailyUnlocks.length,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      <div className="space-y-1.5">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
          {t('library.title')}
        </h1>
        <p className="text-sm text-[#A39E93]">{t('library.subtitle')}</p>
      </div>

      {!firebaseUser && (
        <div className="rounded-xl bg-[#141418] border border-white/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#A39E93]">
          <span>{t('library.guestSyncBanner')}</span>
          <Link
            to="/profile"
            className="min-h-[44px] inline-flex items-center px-2 text-[#E5A93C] font-semibold hover:underline whitespace-nowrap"
          >
            {t('nav.signIn')} →
          </Link>
        </div>
      )}

      {/* Segmented Tabs */}
      <div
        role="tablist"
        aria-label="Library sections"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 carousel-scroll"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              activeTab === tab.id
                ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                : 'bg-[#141418] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'history' && (
        history.length === 0 ? (
          <EmptyState message={t('library.emptyHistory')} cta={t('library.browseCta')} />
        ) : (
          <div className="space-y-3">
            {history.map((item) => {
              const story = stories.find((s) => s.id === item.storyId);
              const ep = episodes.find((e) => e.id === item.episodeId);
              if (!story || !ep) return null;
              const pct = Math.min(100, Math.round((item.positionSec / Math.max(1, item.durationSec)) * 100));

              return (
                <div
                  key={item.id}
                  className="rounded-xl bg-[#141418] border border-white/[0.08] p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <Link to={`/story/${story.id}`} className="w-14 h-14 rounded-lg overflow-hidden shrink-0">
                      <StoryArtwork story={story} aspect="square" />
                    </Link>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link
                        to={`/story/${story.id}`}
                        className="text-sm font-semibold text-[#F5F3EE] hover:text-[#F3C669] truncate block"
                      >
                        {lang === 'hi' ? story.titleHi : story.title}
                      </Link>
                      <p className="text-xs text-[#A39E93] truncate">
                        Ep {ep.episodeNumber}: {lang === 'hi' ? ep.titleHi : ep.title}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-[#9B968B] font-mono-tabular">
                        <span>
                          {formatDuration(item.positionSec)} / {formatDuration(item.durationSec)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#E5A93C]">
                          {item.completed ? t('library.completedLabel') : `${pct}%`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void playEpisode(story, ep)}
                    className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    {t('library.resumeLabel')}
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {activeTab === 'bookmarks' && (
        bookmarkedStories.length === 0 ? (
          <EmptyState message={t('library.emptyBookmarks')} cta={t('library.browseCta')} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {bookmarkedStories.map((story) => (
              <StoryCard key={story.id} story={story} category={categoriesById[story.genreId]} />
            ))}
          </div>
        )
      )}

      {activeTab === 'favorites' && (
        favoriteStories.length === 0 ? (
          <EmptyState message={t('library.emptyFavorites')} cta={t('library.browseCta')} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {favoriteStories.map((story) => (
              <StoryCard key={story.id} story={story} category={categoriesById[story.genreId]} />
            ))}
          </div>
        )
      )}

      {activeTab === 'following' && (
        followedCreators.length === 0 ? (
          <EmptyState message={t('library.emptyFollowing')} cta={t('library.browseCta')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {followedCreators.map((creator) => (
              <div
                key={creator.id}
                className="rounded-xl bg-[#141418] border border-white/[0.08] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-semibold text-[#F5F3EE]">
                      {creator.name}
                    </h2>
                    <UserCheck className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-[#9B968B]">{creator.handle}</p>
                  <p className="text-xs text-[#A39E93] leading-relaxed">
                    {lang === 'hi' ? creator.bioHi : creator.bioEn}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <Link
                    to={`/search?creator=${creator.id}`}
                    className="min-h-[44px] inline-flex items-center text-xs font-medium text-[#E5A93C] hover:underline"
                  >
                    View Series →
                  </Link>
                  <button
                    type="button"
                    onClick={() => void toggleBookmark('creator_follow', creator.id)}
                    aria-label={`Unfollow ${creator.name}`}
                    className="min-h-[44px] px-2 text-xs text-[#A39E93] hover:text-rose-400 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Unfollow
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {activeTab === 'unlocks' && (
        episodeUnlocks.length === 0 && dailyUnlocks.length === 0 ? (
          <EmptyState message={t('library.emptyUnlocks')} cta={t('library.browseCta')} />
        ) : (
          <div className="space-y-6">
            {episodeUnlocks.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A39E93]">
                  {t('library.permanentUnlocksHeading')} ({episodeUnlocks.length})
                </h2>
                {episodeUnlocks.map((entry) => {
                  const story = stories.find((s) => s.id === entry.storyId);
                  const ep = episodes.find((e) => e.id === entry.episodeId);
                  if (!story || !ep) return null;
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl bg-[#141418] border border-white/[0.08] p-4 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#F5F3EE] truncate">
                          {lang === 'hi' ? story.titleHi : story.title} — Ep {ep.episodeNumber}
                        </p>
                        <p className="text-xs text-[#A39E93] truncate tabular-nums">
                          {lang === 'hi' ? ep.titleHi : ep.title} ·{' '}
                          <span className="text-[#6BAE8E]">{t('story.unlockedPermanently')}</span> ·{' '}
                          {entry.pricePaidCoins} {t('coins.unit')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void playEpisode(story, ep)}
                        className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] whitespace-nowrap"
                      >
                        {t('player.play')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {dailyUnlocks.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A39E93]">
                  {t('library.dailyUnlocksHeading')} ({dailyUnlocks.length})
                </h2>
                {dailyUnlocks.map((entry) => {
                  const story = stories.find((s) => s.id === entry.storyId);
                  const ep = episodes.find((e) => e.id === entry.episodeId);
                  if (!story || !ep) return null;
                  return (
                    <div
                      key={entry.id}
                      className="rounded-xl bg-[#141418] border border-white/[0.08] p-4 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#F5F3EE] truncate">
                          {lang === 'hi' ? story.titleHi : story.title} — Ep {ep.episodeNumber}
                        </p>
                        <p className="text-xs text-[#A39E93] truncate">
                          {lang === 'hi' ? ep.titleHi : ep.title} · {entry.unlockDate}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void playEpisode(story, ep)}
                        className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] whitespace-nowrap"
                      >
                        {t('player.play')}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
};

const EmptyState: React.FC<{ message: string; cta: string }> = ({ message, cta }) => (
  <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center space-y-4">
    <p className="text-sm text-[#A39E93]">{message}</p>
    <Link
      to="/search"
      className="min-h-[44px] inline-flex items-center justify-center px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors"
    >
      {cta}
    </Link>
  </div>
);
