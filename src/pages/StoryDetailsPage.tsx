import React, { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  Check,
  Coins,
  Film,
  Heart,
  Pause,
  Play,
  Sparkles,
  Upload,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { EpisodeUnlockModal } from '../components/EpisodeUnlockModal';
import { StoryArtwork } from '../components/StoryArtwork';
import { StoryConstellation } from '../components/StoryConstellation';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import {
  canAccessEpisode,
  formatDuration,
  formatPlayCount,
  getRemainingDailyUnlocks,
  resolveEffectiveEpisodePrice,
} from '../services/access/episodeAccess';
import { getEpisodeFormats } from '../services/interactive/storyGraph';
import type { Episode } from '../types';

export const StoryDetailsPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const { lang, t } = useLanguage();
  const {
    profile,
    categories,
    creators,
    stories,
    episodes,
    catalogLoading,
    history,
    dailyUnlocks,
    userChoices,
    wallet,
    episodeUnlocks,
    economySettings,
    toggleBookmark,
    isBookmarked,
    claimDailyUnlock,
    unlockEpisodeWithCoins,
  } = useAppData();
  const {
    currentEpisode,
    isPlaying,
    playEpisode,
    playLocalFileForEpisode,
    replayFromChoice,
    togglePlayPause,
  } = useAudioPlayer();

  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'info' | 'warn'; text: string } | null>(
    null
  );
  const [unlockModalEpisode, setUnlockModalEpisode] = useState<Episode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const story = useMemo(() => stories.find((s) => s.id === storyId) ?? null, [stories, storyId]);

  const storyEpisodes = useMemo(() => {
    if (!story) return [];
    return episodes
      .filter((e) => e.storyId === story.id)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
  }, [episodes, story]);

  const category = useMemo(
    () => (story ? categories.find((c) => c.id === story.genreId) : undefined),
    [categories, story]
  );

  const creator = useMemo(
    () => (story ? creators.find((c) => c.id === story.creatorId) : undefined),
    [creators, story]
  );

  const latestStoryProgress = useMemo(() => {
    if (!story) return null;
    return history.find((h) => h.storyId === story.id) ?? null;
  }, [history, story]);

  const remainingDaily = useMemo(
    () => getRemainingDailyUnlocks(dailyUnlocks, economySettings),
    [dailyUnlocks, economySettings]
  );

  if (catalogLoading && !story) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-pulse">
        <div className="h-5 w-20 rounded bg-[#1C1C22]" />
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-8">
          <div className="aspect-[3/4] rounded-2xl bg-[#141418]" />
          <div className="space-y-4">
            <div className="h-4 w-48 rounded bg-[#1C1C22]" />
            <div className="h-10 w-3/4 rounded bg-[#141418]" />
            <div className="h-24 w-full rounded bg-[#141418]" />
          </div>
        </div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center space-y-4">
        <h1 className="font-display text-3xl font-semibold text-[#F5F3EE]">
          {t('story.notFoundTitle')}
        </h1>
        <p className="text-sm text-[#A39E93]">{t('story.notFoundBody')}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </Link>
      </div>
    );
  }

  const bookmarked = isBookmarked('story_bookmark', story.id);
  const favorited = isBookmarked('story_favorite', story.id);
  const followingCreator = isBookmarked('creator_follow', story.creatorId);

  const title = lang === 'hi' ? story.titleHi : story.title;
  const synopsis = lang === 'hi' ? story.synopsisHi : story.synopsis;
  const genreLabel = category ? (lang === 'hi' ? category.nameHi : category.nameEn) : story.genreId;
  const langLabel =
    story.language === 'hi'
      ? t('common.hindi')
      : story.language === 'en'
        ? t('common.english')
        : t('common.bilingual');

  const handleEpisodeClick = async (ep: Episode) => {
    setFeedbackMsg(null);
    if (currentEpisode?.id === ep.id) {
      await togglePlayPause();
      return;
    }

    const access = canAccessEpisode(profile, ep, {
      story,
      episodeUnlocks,
      dailyUnlocks,
      economySettings,
    });
    if (access.allowed) {
      await playEpisode(story, ep);
      return;
    }

    // Paid locked episode — open transparent Coin Unlock dialog
    setUnlockModalEpisode(ep);
  };

  const handlePrimaryPlay = () => {
    const targetEp =
      (latestStoryProgress &&
        storyEpisodes.find((e) => e.id === latestStoryProgress.episodeId)) ||
      storyEpisodes[0];
    if (targetEp) {
      void handleEpisodeClick(targetEp);
    }
  };

  const handleLocalMediaSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storyEpisodes[0]) return;
    void playLocalFileForEpisode(file, story, storyEpisodes[0]);
    e.target.value = '';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-10">
      {/* Back navigation */}
      <Link
        to="/"
        className="min-h-[44px] inline-flex items-center gap-2 text-xs font-medium text-[#A39E93] hover:text-[#F5F3EE] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('common.back')}
      </Link>

      {/* Story Header Split */}
      <section className="grid grid-cols-1 md:grid-cols-[260px_1fr] lg:grid-cols-[300px_1fr] gap-8 items-start">
        <div className="w-56 sm:w-64 md:w-full mx-auto md:mx-0 rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
          <StoryArtwork story={story} aspect="poster" />
        </div>

        <div className="space-y-5">
          {/* Quiet editorial metadata */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#E5A93C] tabular-nums">
            <span>{genreLabel}</span>
            <span aria-hidden="true" className="text-[#9B968B]">·</span>
            <span className="text-[#A39E93]">{langLabel}</span>
            <span aria-hidden="true" className="text-[#9B968B]">·</span>
            <span className="text-[#A39E93]">
              {story.episodeCount} {t('common.episodes')}
            </span>
            <span aria-hidden="true" className="text-[#9B968B]">·</span>
            <span className="text-[#A39E93]">
              ★ {story.rating.toFixed(1)} ({formatPlayCount(story.totalPlays)} {t('common.plays')})
            </span>
          </div>

          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#F5F3EE] leading-[1.12] text-balance">
            {title}
          </h1>

          {/* Creator Row with Follow toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4 py-3 border-y border-white/[0.08]">
            <div>
              <p className="text-sm font-semibold text-[#F5F3EE]">{story.creatorName}</p>
              <p className="text-xs text-[#9B968B]">
                {creator?.handle ?? '@dhruvtales'} ·{' '}
                {creator ? formatPlayCount(creator.followersCount) : '10K'} followers
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleBookmark('creator_follow', story.creatorId)}
              aria-pressed={followingCreator}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                followingCreator
                  ? 'bg-[#25252E] text-[#F5F3EE] border border-[#E5A93C]/40'
                  : 'bg-[#141418] text-[#F5F3EE] border border-white/15 hover:border-[#E5A93C]/50'
              }`}
            >
              {followingCreator ? (
                <UserCheck className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              ) : (
                <UserPlus className="w-4 h-4" aria-hidden="true" />
              )}
              {followingCreator ? t('story.followingCreator') : t('story.followCreator')}
            </button>
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePrimaryPlay}
              className="min-h-[46px] px-6 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {latestStoryProgress
                ? `${t('story.resumeEpisode')} ${latestStoryProgress.episodeNumber}`
                : t('story.playFirst')}
            </button>

            <button
              type="button"
              onClick={() => void toggleBookmark('story_bookmark', story.id)}
              aria-pressed={bookmarked}
              className={`min-h-[46px] px-4 rounded-xl text-xs font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap ${
                bookmarked
                  ? 'bg-[#E5A93C]/15 border-[#E5A93C]/50 text-[#F3C669]'
                  : 'bg-[#141418] border-white/15 text-[#F5F3EE] hover:border-white/30'
              }`}
            >
              <Bookmark
                className={`w-4 h-4 ${bookmarked ? 'fill-current' : ''}`}
                aria-hidden="true"
              />
              {bookmarked ? t('story.bookmarked') : t('story.bookmark')}
            </button>

            <button
              type="button"
              onClick={() => void toggleBookmark('story_favorite', story.id)}
              aria-pressed={favorited}
              className={`min-h-[46px] px-4 rounded-xl text-xs font-medium inline-flex items-center gap-2 border transition-colors whitespace-nowrap ${
                favorited
                  ? 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                  : 'bg-[#141418] border-white/15 text-[#F5F3EE] hover:border-white/30'
              }`}
            >
              <Heart
                className={`w-4 h-4 ${favorited ? 'fill-current' : ''}`}
                aria-hidden="true"
              />
              {favorited ? t('story.favorited') : t('story.favorite')}
            </button>
          </div>

          {/* Synopsis */}
          <div className="space-y-2 pt-2">
            <h2 className="text-xs font-semibold text-[#A39E93]">{t('story.synopsisHeading')}</h2>
            <p className="text-sm sm:text-base text-[#D6D2C9] leading-relaxed max-w-2xl">
              {synopsis}
            </p>
            <p className="text-xs text-[#9B968B] pt-1">
              {story.format === 'hybrid' ? t('common.hybridFormat') : t('common.audioOnly')}
              {story.isInteractive ? ` · ${t('common.interactiveReady')}` : ''}
            </p>
          </div>
        </div>
      </section>

      {/* Interactive Story Constellation Map with Glowing Light Trail */}
      {story.isInteractive && (
        <StoryConstellation
          story={story}
          episodes={storyEpisodes}
          userChoices={userChoices}
          activeEpisodeId={currentEpisode?.id}
          onPlayEpisode={(ep) => void playEpisode(story, ep)}
          onReplayFromChoice={(ep) => void replayFromChoice(story, ep)}
        />
      )}

      {/* Feedback Notice */}
      {feedbackMsg && (
        <div
          role="status"
          className={`rounded-xl px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3 border ${
            feedbackMsg.type === 'info'
              ? 'bg-[#E5A93C]/10 border-[#E5A93C]/35 text-[#F3C669]'
              : 'bg-[#1C1C22] border-white/15 text-[#F5F3EE]'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          {feedbackMsg.type === 'warn' && (
            <Link
              to="/wallet"
              className="font-semibold text-[#E5A93C] hover:underline whitespace-nowrap"
            >
              {t('wallet.openWalletCta')} →
            </Link>
          )}
        </div>
      )}

      {/* Episode List */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-semibold text-[#F5F3EE]">
              {t('story.episodesHeading')} ({storyEpisodes.length})
            </h2>
            {typeof story.priceOverrideCoins === 'number' && (
              <p className="text-xs text-[#E5A93C]">
                {t('story.storyPriceOverrideBanner', {
                  price: String(story.priceOverrideCoins),
                })}
              </p>
            )}
          </div>
          {economySettings.dailyFreeEnabled && economySettings.dailyFreeLimit > 0 && (
            <p className="text-xs text-[#A39E93] tabular-nums">
              {t('story.dailyUnlockQuota')}:{' '}
              <strong className="text-[#E5A93C]">
                {remainingDaily}/{economySettings.dailyFreeLimit}
              </strong>{' '}
              {t('story.dailyUnlockRemaining')}
            </p>
          )}
        </div>

        <div className="divide-y divide-white/[0.06] rounded-2xl bg-[#141418] border border-white/[0.08] overflow-hidden">
          {storyEpisodes.map((ep) => {
            const effectivePrice = resolveEffectiveEpisodePrice(ep, story);
            const access = canAccessEpisode(profile, ep, {
              story,
              episodeUnlocks,
              dailyUnlocks,
              economySettings,
            });
            const epProgress = history.find((h) => h.episodeId === ep.id);
            const epFormats = getEpisodeFormats(ep);
            const pct =
              epProgress && epProgress.durationSec > 0
                ? Math.min(100, Math.round((epProgress.positionSec / epProgress.durationSec) * 100))
                : 0;
            const isActive = currentEpisode?.id === ep.id;
            const epTitle = lang === 'hi' ? ep.titleHi : ep.title;
            const epDesc = lang === 'hi' ? ep.descriptionHi : ep.description;

            return (
              <div
                key={ep.id}
                className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                  isActive ? 'bg-[#1C1C22]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <span className="font-mono-tabular text-xs text-[#9B968B] pt-1 w-6 shrink-0">
                    {String(ep.episodeNumber).padStart(2, '0')}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm sm:text-base font-semibold text-[#F5F3EE]">
                        {epTitle}
                      </h3>
                    </div>
                    {epDesc && (
                      <p className="text-xs text-[#A39E93] leading-relaxed line-clamp-2">
                        {epDesc}
                      </p>
                    )}

                    {/* Clean unboxed episode metadata */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9B968B] tabular-nums pt-0.5">
                      <span className="font-mono-tabular">{formatDuration(ep.durationSec)}</span>
                      <span aria-hidden="true">·</span>
                      {access.reason === 'free_episode' && (
                        <span className="text-emerald-400">{t('common.free')}</span>
                      )}
                      {access.reason === 'coin_unlocked' && (
                        <span className="text-[#6BAE8E] inline-flex items-center gap-1">
                          <Check className="w-3 h-3" aria-hidden="true" />
                          {t('story.unlockedPermanently')}
                        </span>
                      )}
                      {access.reason === 'daily_unlock_claimed' && (
                        <span className="text-[#E5A93C] inline-flex items-center gap-1">
                          <Check className="w-3 h-3" aria-hidden="true" />
                          {t('common.unlocked')}
                        </span>
                      )}
                      {access.reason === 'admin_or_creator_owner' && (
                        <span className="text-[#E5A93C]">{t('common.unlocked')}</span>
                      )}
                      {!access.allowed && (
                        <span className="text-[#F3C669] inline-flex items-center gap-1 tabular-nums">
                          <Coins className="w-3 h-3 text-[#E5A93C]" aria-hidden="true" />
                          {effectivePrice} {t('coins.unit')}
                        </span>
                      )}

                      {epFormats.canSwitch && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#D6D2C9] inline-flex items-center gap-1">
                            <Film className="w-3 h-3 text-[#E5A93C]" aria-hidden="true" />
                            {t('story.audioAndVideo')}
                          </span>
                        </>
                      )}

                      {ep.choicePoint && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#F3C669] inline-flex items-center gap-1">
                            <Sparkles className="w-3 h-3" aria-hidden="true" />
                            {t('story.interactiveChoice')}
                          </span>
                        </>
                      )}

                      {ep.isEnding && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-400">{t('story.endingEpisode')}</span>
                        </>
                      )}

                      {epProgress && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#F5F3EE]">
                            {epProgress.completed ? t('library.completedLabel') : `${pct}%`}
                          </span>
                        </>
                      )}
                    </div>

                    {pct > 0 && (
                      <div className="h-1 w-40 max-w-full rounded-full bg-white/10 overflow-hidden mt-1.5">
                        <div className="h-full bg-[#E5A93C]" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Button */}
                <div className="shrink-0 pl-10 sm:pl-0">
                  {access.allowed ? (
                    <button
                      type="button"
                      data-testid={`episode-play-btn-${ep.episodeNumber}`}
                      onClick={() => void handleEpisodeClick(ep)}
                      aria-label={
                        isActive && isPlaying
                          ? `Pause Episode ${ep.episodeNumber}`
                          : `Play Episode ${ep.episodeNumber}`
                      }
                      className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-[#E5A93C] text-[#0B0B0E]'
                          : 'bg-[#1C1C22] border border-white/10 text-[#F5F3EE] hover:border-[#E5A93C]/50'
                      }`}
                    >
                      {isActive && isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                          {t('player.pause')}
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                          {t('player.play')}
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`episode-unlock-btn-${ep.episodeNumber}`}
                      onClick={() => void handleEpisodeClick(ep)}
                      className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C]/15 border border-[#E5A93C]/45 text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap tabular-nums"
                    >
                      <Coins className="w-3.5 h-3.5" aria-hidden="true" />
                      {effectivePrice} {t('coins.unit')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* DemoMediaProvider Local Media Tester */}
      <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[#F5F3EE]">{t('story.testLocalAudio')}</h3>
          <p className="text-xs text-[#A39E93]">{t('story.localAudioHint')}</p>
        </div>
        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            onChange={handleLocalMediaSelected}
            className="hidden"
            aria-label="Choose local audio or video file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
            {t('story.loadLocalMedia')}
          </button>
        </div>
      </section>

      {/* Coin Unlock Modal */}
      {unlockModalEpisode && (
        <EpisodeUnlockModal
          story={story}
          episode={unlockModalEpisode}
          walletBalance={wallet.balance}
          dailyFreeEnabled={economySettings.dailyFreeEnabled}
          remainingDailyFree={remainingDaily}
          dailyFreeLimit={economySettings.dailyFreeLimit}
          onUnlockWithCoins={async () => {
            const target = unlockModalEpisode;
            const res = await unlockEpisodeWithCoins(target, story);
            if (res.unlocked) {
              setUnlockModalEpisode(null);
              setFeedbackMsg({
                type: 'info',
                text: res.alreadyUnlocked
                  ? t('story.alreadyUnlockedInfo')
                  : t('story.coinUnlockSuccess', { price: String(res.effectivePrice) }),
              });
              await playEpisode(story, target, undefined, undefined, undefined, res.unlock);
              return { ok: true };
            }
            return {
              ok: false,
              error: res.error,
              insufficientBalance: res.insufficientBalance,
            };
          }}
          onUseDailyFree={async () => {
            const target = unlockModalEpisode;
            const unlockedEntry = await claimDailyUnlock(story.id, target.id);
            setUnlockModalEpisode(null);
            setFeedbackMsg({ type: 'info', text: t('story.unlockSuccess') });
            await playEpisode(story, target, undefined, unlockedEntry);
          }}
          onClose={() => setUnlockModalEpisode(null)}
        />
      )}
    </div>
  );
};
