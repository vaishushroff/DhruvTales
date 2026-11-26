import React, { useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { PLAYBACK_SPEEDS, useAudioPlayer } from '../hooks/useAudioPlayer';
import { useLanguage } from '../hooks/useLanguage';
import { formatDuration } from '../services/access/episodeAccess';
import { ChoiceOverlay } from './ChoiceOverlay';
import { StoryArtwork } from './StoryArtwork';
import { VideoPlayer } from './VideoPlayer';

export const AudioPlayerBar: React.FC = () => {
  const { lang, t } = useLanguage();
  const {
    currentStory,
    currentEpisode,
    mediaResolution,
    activeFormat,
    canSwitchFormat,
    isPlaying,
    isLoadingMedia,
    currentTime,
    duration,
    playbackRate,
    isExpanded,
    errorMessage,
    activeChoicePoint,
    hasPrevious,
    hasNext,
    switchFormat,
    togglePlayPause,
    seekTo,
    skipBy,
    setPlaybackRate,
    cyclePlaybackRate,
    playNextEpisode,
    playPreviousEpisode,
    chooseBranchOption,
    dismissChoiceAndRewind,
    openChoicePreview,
    setIsExpanded,
    closePlayer,
  } = useAudioPlayer();

  useEffect(() => {
    if (!isExpanded || activeChoicePoint) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded, activeChoicePoint, setIsExpanded]);

  if (!currentStory || !currentEpisode) return null;

  const storyTitle = lang === 'hi' ? currentStory.titleHi : currentStory.title;
  const epTitle = lang === 'hi' ? currentEpisode.titleHi : currentEpisode.title;
  const safeDuration = Math.max(1, duration || currentEpisode.durationSec);
  const progressPct = Math.min(100, (currentTime / safeDuration) * 100);
  const activeMediaRef =
    activeFormat === 'video' && currentEpisode.videoMediaRef
      ? currentEpisode.videoMediaRef
      : currentEpisode.audioRef ?? currentEpisode.mediaRef;

  return (
    <>
      {/* Persistent Mini-Player (synced 1:1 with Full Audio Player & Video Player) */}
      {!isExpanded && (
        <aside
          aria-label={t('player.nowPlaying')}
          data-testid="mini-player"
          className="fixed mini-player-mobile-offset left-0 right-0 z-40 bg-[#141418]/95 backdrop-blur-md border-t border-white/10"
        >
          {/* Thin top progress hairline */}
          <div className="h-[2px] w-full bg-white/10">
            <div
              className="h-full bg-[#E5A93C] transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
            {/* Artwork + Track Info (expand button) */}
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              aria-label={t('player.expand')}
              className="flex items-center gap-3 min-w-0 text-left flex-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93C] rounded-lg"
            >
              <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-white/10">
                <StoryArtwork story={currentStory} aspect="square" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#F5F3EE] truncate">
                  Ep {currentEpisode.episodeNumber}: {epTitle}
                </p>
                <p className="text-xs text-[#A39E93] truncate">
                  {storyTitle} ·{' '}
                  <span className="text-[#E5A93C]">
                    {activeFormat === 'video' ? t('player.videoMode') : t('player.audioMode')}
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono-tabular">
                    {formatDuration(currentTime)} / {formatDuration(safeDuration)}
                  </span>
                </p>
              </div>
            </button>

            {/* Controls */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Compact Audio ⇄ Video switch on Mini-Player when episode supports both */}
              {canSwitchFormat && (
                <button
                  type="button"
                  data-testid="mini-format-toggle"
                  onClick={() => void switchFormat(activeFormat === 'audio' ? 'video' : 'audio')}
                  aria-label={t('player.switchFormat')}
                  className="hidden sm:inline-flex min-h-[44px] px-3 rounded-lg bg-[#1C1C22] border border-[#E5A93C]/35 text-xs font-medium text-[#F3C669] hover:border-[#E5A93C] items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  {activeFormat === 'audio' ? (
                    <>
                      <Film className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('player.videoMode')}
                    </>
                  ) : (
                    <>
                      <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('player.audioMode')}
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => skipBy(-15)}
                aria-label={t('player.skipBack')}
                className="hidden sm:flex min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-[#A39E93] hover:text-[#F5F3EE] hover:bg-white/5 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => void togglePlayPause()}
                aria-label={isPlaying ? t('player.pause') : t('player.play')}
                className="min-w-[44px] min-h-[44px] rounded-full bg-[#E5A93C] text-[#0B0B0E] hover:bg-[#F3C669] flex items-center justify-center transition-colors"
              >
                {isLoadingMedia ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => skipBy(15)}
                aria-label={t('player.skipForward')}
                className="hidden sm:flex min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-[#A39E93] hover:text-[#F5F3EE] hover:bg-white/5 transition-colors"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={cyclePlaybackRate}
                aria-label={`${t('player.speed')} ${playbackRate}x`}
                className="hidden md:flex min-w-[44px] min-h-[44px] px-2.5 rounded-lg border border-white/10 text-xs font-mono-tabular text-[#F5F3EE] hover:border-[#E5A93C]/50 items-center justify-center transition-colors whitespace-nowrap"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label={t('player.expand')}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[#A39E93] hover:text-[#F5F3EE] transition-colors"
              >
                <ChevronUp className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={closePlayer}
                aria-label={t('player.closePlayer')}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-[#A39E93] hover:text-[#F5F3EE] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/*
        Full-Screen Player (Audio + Video + Interactive Choice Overlay).
        Kept mounted when activeFormat === 'video' (visually offscreen when minimized)
        so the HTML5 <video> element never unmounts or drops playback on collapse/expand.
      */}
      {(isExpanded || activeFormat === 'video') && (
        <div
          role={isExpanded ? 'dialog' : undefined}
          aria-modal={isExpanded ? 'true' : undefined}
          aria-label={t('player.nowPlaying')}
          aria-hidden={!isExpanded}
          data-testid="full-player-dialog"
          className={
            isExpanded
              ? 'fixed inset-0 z-50 h-[100dvh] bg-[#0B0B0E]/98 backdrop-blur-xl overflow-y-auto overflow-x-hidden safe-top safe-bottom'
              : 'fixed -left-[9999px] top-0 w-[180px] h-[320px] overflow-hidden opacity-0 pointer-events-none'
          }
        >
          <div
            className={`mx-auto min-h-full px-3 sm:px-6 flex flex-col justify-between ${
              activeFormat === 'video'
                ? 'max-w-4xl py-2.5 sm:py-4 gap-3'
                : 'max-w-3xl py-5 sm:py-8 gap-6'
            }`}
          >
            {/* Top Bar with Audio ⇄ Video Switcher */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                aria-label={t('player.collapse')}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-[#141418] border border-white/10 text-[#F5F3EE] hover:border-white/25 flex items-center justify-center transition-colors shrink-0"
              >
                <ChevronDown className="w-5 h-5" />
              </button>

              {/* Audio ⇄ Video Segmented Toggle — strictly hidden when episode has only one format */}
              {canSwitchFormat ? (
                <div
                  role="group"
                  aria-label={t('player.switchFormat')}
                  data-testid="format-switcher"
                  className="inline-flex items-center p-1 rounded-xl bg-[#141418] border border-white/10"
                >
                  <button
                    type="button"
                    data-testid="switch-to-audio-btn"
                    aria-pressed={activeFormat === 'audio'}
                    onClick={() => void switchFormat('audio')}
                    className={`min-h-[44px] px-3 sm:px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      activeFormat === 'audio'
                        ? 'bg-[#E5A93C] text-[#0B0B0E]'
                        : 'text-[#A39E93] hover:text-[#F5F3EE]'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('player.audioMode')}
                  </button>
                  <button
                    type="button"
                    data-testid="switch-to-video-btn"
                    aria-pressed={activeFormat === 'video'}
                    onClick={() => void switchFormat('video')}
                    className={`min-h-[44px] px-3 sm:px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      activeFormat === 'video'
                        ? 'bg-[#E5A93C] text-[#0B0B0E]'
                        : 'text-[#A39E93] hover:text-[#F5F3EE]'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('player.videoMode')}
                  </button>
                </div>
              ) : (
                <div className="text-center min-w-0">
                  <p className="text-xs text-[#A39E93]">{t('player.nowPlaying')}</p>
                  <p className="text-sm font-medium text-[#F5F3EE] truncate">{storyTitle}</p>
                </div>
              )}

              <button
                type="button"
                onClick={closePlayer}
                aria-label={t('player.closePlayer')}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-[#141418] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stage: Adaptive Video Player (9:16 or 16:9 matching source) OR Audio Cover Art */}
            {activeFormat === 'video' ? (
              <div
                className={`flex-1 flex flex-col items-center justify-center min-h-0 ${
                  activeChoicePoint ? 'lg:flex-row lg:items-center lg:gap-6 gap-3' : 'gap-2.5'
                }`}
              >
                <div className="w-full flex flex-col items-center text-center gap-2 shrink-0">
                  <VideoPlayer
                    isExpandedView={isExpanded}
                    maxHeightCss={
                      activeChoicePoint
                        ? 'min(42dvh, 360px)'
                        : 'calc(100dvh - 15rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
                    }
                    maxWidthCss={activeChoicePoint ? '210px' : '460px'}
                    landscapeMaxWidthCss={activeChoicePoint ? '480px' : '860px'}
                  />
                  <div className="space-y-0.5 max-w-md px-2">
                    <p className="text-[11px] font-mono-tabular text-[#E5A93C] truncate">
                      {storyTitle} · {t('common.episode')} {currentEpisode.episodeNumber}
                    </p>
                    <h2 className="font-display text-lg sm:text-xl font-semibold text-[#F5F3EE] text-balance leading-snug">
                      {epTitle}
                    </h2>
                  </div>
                </div>

                {activeChoicePoint && (
                  <div className="w-full max-w-xl">
                    <ChoiceOverlay
                      choicePoint={activeChoicePoint}
                      onSelectOption={(opt) => void chooseBranchOption(opt)}
                      onRewind={dismissChoiceAndRewind}
                    />
                  </div>
                )}

                {errorMessage && (
                  <p
                    role="alert"
                    className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/20 rounded-lg px-4 py-2"
                  >
                    {errorMessage}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center text-center space-y-4">
                  {activeChoicePoint ? (
                    <div className="w-full flex items-center gap-4 text-left rounded-2xl bg-[#141418]/90 border border-white/10 p-3.5">
                      <div className="w-16 sm:w-20 rounded-xl overflow-hidden border border-white/10 shrink-0">
                        <StoryArtwork story={currentStory} aspect="poster" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-mono-tabular text-[#E5A93C] truncate">
                          {storyTitle} · {t('common.episode')} {currentEpisode.episodeNumber}
                        </p>
                        <h2 className="font-display text-lg sm:text-2xl font-semibold text-[#F5F3EE] truncate">
                          {epTitle}
                        </h2>
                        <p className="text-xs text-[#A39E93] truncate">{currentStory.creatorName}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-56 sm:w-68 rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60">
                        <StoryArtwork story={currentStory} aspect="poster" />
                      </div>
                      <div className="space-y-1.5 max-w-xl">
                        <p className="text-xs font-mono-tabular text-[#E5A93C]">
                          {storyTitle} · {t('common.episode')} {currentEpisode.episodeNumber}
                        </p>
                        <h2 className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F3EE] text-balance">
                          {epTitle}
                        </h2>
                        <p className="text-sm text-[#A39E93]">{currentStory.creatorName}</p>
                      </div>
                    </>
                  )}

                  {errorMessage && (
                    <p
                      role="alert"
                      className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/20 rounded-lg px-4 py-2"
                    >
                      {errorMessage}
                    </p>
                  )}
                </div>

                {/* Interactive Choice Overlay in Audio Mode */}
                {activeChoicePoint && (
                  <ChoiceOverlay
                    choicePoint={activeChoicePoint}
                    onSelectOption={(opt) => void chooseBranchOption(opt)}
                    onRewind={dismissChoiceAndRewind}
                  />
                )}
              </>
            )}

            {/* Audio Transport Controls (shown in audio mode, plus episode navigation in both modes) */}
            <div className={activeFormat === 'video' ? 'space-y-2 pb-1 shrink-0' : 'space-y-5 pb-4'}>
              {activeFormat === 'audio' && (
                <>
                  {/* Seek Slider */}
                  <div className="space-y-2">
                    <label htmlFor="full-player-seek" className="sr-only">
                      Seek playback position
                    </label>
                    <input
                      id="full-player-seek"
                      type="range"
                      min={0}
                      max={safeDuration}
                      step={1}
                      value={Math.min(safeDuration, currentTime)}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      className="dt-range w-full"
                      style={{
                        background: `linear-gradient(to right, #E5A93C ${progressPct}%, rgba(255,255,255,0.14) ${progressPct}%)`,
                      }}
                    />
                    <div className="flex items-center justify-between text-xs font-mono-tabular text-[#A39E93]">
                      <span>{formatDuration(currentTime)}</span>
                      <span>{formatDuration(safeDuration)}</span>
                    </div>
                  </div>

                  {/* Primary Playback Buttons */}
                  <div className="flex items-center justify-center gap-3 sm:gap-5">
                    <button
                      type="button"
                      onClick={() => void playPreviousEpisode()}
                      disabled={!hasPrevious}
                      aria-label={t('player.prevEpisode')}
                      className="min-w-[44px] min-h-[44px] rounded-full text-[#F5F3EE] disabled:opacity-30 hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <SkipBack className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => skipBy(-15)}
                      aria-label={t('player.skipBack')}
                      className="min-w-[48px] min-h-[48px] rounded-full bg-[#141418] border border-white/10 text-[#F5F3EE] hover:border-[#E5A93C]/40 flex flex-col items-center justify-center transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="text-[10px] font-mono-tabular leading-none mt-0.5">15s</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void togglePlayPause()}
                      disabled={Boolean(activeChoicePoint)}
                      aria-label={isPlaying ? t('player.pause') : t('player.play')}
                      className="w-16 h-16 rounded-full bg-[#E5A93C] text-[#0B0B0E] hover:bg-[#F3C669] disabled:opacity-45 flex items-center justify-center shadow-lg shadow-[#E5A93C]/20 transition-transform active:scale-95"
                    >
                      {isLoadingMedia ? (
                        <Loader2 className="w-7 h-7 animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-7 h-7 fill-current" />
                      ) : (
                        <Play className="w-7 h-7 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => skipBy(15)}
                      aria-label={t('player.skipForward')}
                      className="min-w-[48px] min-h-[48px] rounded-full bg-[#141418] border border-white/10 text-[#F5F3EE] hover:border-[#E5A93C]/40 flex flex-col items-center justify-center transition-colors"
                    >
                      <RotateCw className="w-4 h-4" />
                      <span className="text-[10px] font-mono-tabular leading-none mt-0.5">15s</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void playNextEpisode()}
                      disabled={!hasNext}
                      aria-label={t('player.nextEpisode')}
                      className="min-w-[44px] min-h-[44px] rounded-full text-[#F5F3EE] disabled:opacity-30 hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <SkipForward className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Speed Selector */}
                  <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t('player.speed')}>
                    {PLAYBACK_SPEEDS.map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        data-testid={`speed-btn-${spd}`}
                        aria-pressed={playbackRate === spd}
                        onClick={() => setPlaybackRate(spd)}
                        className={`min-w-[44px] min-h-[44px] px-3 rounded-lg text-xs font-mono-tabular transition-colors ${
                          playbackRate === spd
                            ? 'bg-[#E5A93C] text-[#0B0B0E] font-semibold'
                            : 'bg-[#141418] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Quick Episode / Choice Bar in Video mode or Interactive episodes */}
              {(activeFormat === 'video' || (currentEpisode.choicePoint && !activeChoicePoint)) && (
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {activeFormat === 'video' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void playPreviousEpisode()}
                        disabled={!hasPrevious}
                        className="min-h-[44px] px-4 rounded-xl bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] disabled:opacity-35 inline-flex items-center gap-1.5 hover:border-white/25 transition-colors"
                      >
                        <SkipBack className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('player.prevEpisode')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void playNextEpisode()}
                        disabled={!hasNext}
                        className="min-h-[44px] px-4 rounded-xl bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] disabled:opacity-35 inline-flex items-center gap-1.5 hover:border-white/25 transition-colors"
                      >
                        {t('player.nextEpisode')}
                        <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </>
                  )}

                  {currentEpisode.choicePoint && !activeChoicePoint && (
                    <button
                      type="button"
                      data-testid="open-choice-btn"
                      onClick={openChoicePreview}
                      className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C]/15 border border-[#E5A93C]/45 text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('player.jumpToChoice')}
                    </button>
                  )}
                </div>
              )}

              {/* Transparent MediaProvider metadata */}
              <div
                className={`rounded-xl bg-[#141418] border border-white/[0.08] text-xs text-[#A39E93] ${
                  activeFormat === 'video' ? 'px-3 py-1.5' : 'px-4 py-3 space-y-1'
                }`}
              >
                <div
                  className={`flex items-center justify-between gap-2 ${
                    activeFormat === 'video' ? 'flex-nowrap' : 'flex-wrap'
                  }`}
                >
                  <span className="shrink-0">{t('player.providerLabel')}</span>
                  <span className="font-mono-tabular text-[#F5F3EE] text-[11px] truncate min-w-0">
                    {activeMediaRef.provider} · {activeMediaRef.type} · {activeMediaRef.id}
                  </span>
                </div>
                {activeFormat === 'audio' && (
                  <p className="text-[11px] text-[#9B968B]">
                    {mediaResolution?.label || t('player.demoAudioNotice')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
