import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DailyUnlockEntry,
  Episode,
  EpisodeChoicePoint,
  EpisodeUnlockRecord,
  InteractiveChoiceOption,
  PlaybackFormat,
  Story,
} from '../types';
import { canAccessEpisode } from '../services/access/episodeAccess';
import {
  getEpisodeFormats,
  resolveEffectiveFormat,
  shouldTriggerChoicePoint,
} from '../services/interactive/storyGraph';
import {
  buildDrivePreviewEmbedUrl,
  extractDriveFileId,
  getMediaProvider,
  type MediaPlaybackResolution,
} from '../services/media';
import { useAppData } from './useAuthAndActivity';

export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

interface PendingMediaHandoff {
  targetFormat: PlaybackFormat;
  episodeId: string;
  positionSec: number;
  playbackRate: number;
  shouldPlay: boolean;
  url: string;
}

interface AudioPlayerContextValue {
  currentStory: Story | null;
  currentEpisode: Episode | null;
  mediaResolution: MediaPlaybackResolution | null;
  activeFormat: PlaybackFormat;
  canSwitchFormat: boolean;
  hasVideoFormat: boolean;
  activeVideoUrl: string | null;
  activeEmbedUrl: string | null;
  isPlaying: boolean;
  isLoadingMedia: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  isExpanded: boolean;
  errorMessage: string | null;
  videoError: string | null;
  activeChoicePoint: EpisodeChoicePoint | null;
  hasPrevious: boolean;
  hasNext: boolean;
  attachVideoElement: (el: HTMLVideoElement | null) => void;
  playEpisode: (
    story: Story,
    episode: Episode,
    customStartSec?: number,
    newlyUnlocked?: DailyUnlockEntry,
    forcedFormat?: PlaybackFormat,
    newlyUnlockedCoin?: EpisodeUnlockRecord
  ) => Promise<void>;
  playLocalFileForEpisode: (file: File, story: Story, episode: Episode) => Promise<void>;
  switchFormat: (nextFormat: PlaybackFormat) => Promise<void>;
  retryVideoLoad: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  seekTo: (seconds: number) => void;
  skipBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  cyclePlaybackRate: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  playNextEpisode: () => Promise<void>;
  playPreviousEpisode: () => Promise<void>;
  chooseBranchOption: (option: InteractiveChoiceOption) => Promise<void>;
  dismissChoiceAndRewind: () => void;
  openChoicePreview: () => void;
  replayFromChoice: (story: Story, episode: Episode) => Promise<void>;
  setIsExpanded: (expanded: boolean) => void;
  closePlayer: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export const AudioPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    profile,
    preferredFormat,
    setPreferredFormat,
    episodes,
    history,
    dailyUnlocks,
    episodeUnlocks,
    economySettings,
    userChoices,
    saveProgress,
    recordUserChoice,
    pruneStoryChoicesFromEpisode,
  } = useAppData();

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const [videoElVersion, setVideoElVersion] = useState(0);

  const lastSavedSecRef = useRef<number>(-10);
  const lastPersistedSnapshotRef = useRef<{ key: string; at: number } | null>(null);
  const triggeredChoicesRef = useRef<Set<string>>(new Set());
  const pendingHandoffRef = useRef<PendingMediaHandoff | null>(null);
  const mediaExpiresAtRef = useRef<number | null>(null);
  const refreshedExpiredUrlRef = useRef<string | null>(null);
  const isRefreshingSignedUrlRef = useRef<boolean>(false);
  const fallbackCandidatesRef = useRef<string[]>([]);
  const candidateIdxRef = useRef<number>(0);
  const driveStallTimerRef = useRef<number | null>(null);

  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<Episode | null>(null);
  const [mediaResolution, setMediaResolution] = useState<MediaPlaybackResolution | null>(null);
  const [activeFormat, setActiveFormat] = useState<PlaybackFormat>('audio');
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [activeEmbedUrl, setActiveEmbedUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState<number>(1);
  const [volume, setVolumeState] = useState<number>(0.9);
  const [isMuted, setIsMutedState] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [activeChoicePoint, setActiveChoicePoint] = useState<EpisodeChoicePoint | null>(null);

  // Refs for synchronous reads inside event callbacks & beforeunload
  const activeFormatRef = useRef<PlaybackFormat>('audio');
  const currentStoryRef = useRef<Story | null>(null);
  const currentEpisodeRef = useRef<Episode | null>(null);
  const durationRef = useRef<number>(0);
  const playbackRateRef = useRef<number>(1);
  const volumeRef = useRef<number>(0.9);
  const isMutedRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const mediaResolutionRef = useRef<MediaPlaybackResolution | null>(null);
  const activeEmbedUrlRef = useRef<string | null>(null);

  activeFormatRef.current = activeFormat;
  currentStoryRef.current = currentStory;
  currentEpisodeRef.current = currentEpisode;
  durationRef.current = duration;
  playbackRateRef.current = playbackRate;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  isPlayingRef.current = isPlaying;
  mediaResolutionRef.current = mediaResolution;
  activeEmbedUrlRef.current = activeEmbedUrl;

  // Lazy-initialize single HTMLAudioElement instance
  if (!audioElRef.current && typeof Audio !== 'undefined') {
    audioElRef.current = new Audio();
    audioElRef.current.preload = 'metadata';
  }

  const getActiveMediaElement = useCallback((): HTMLMediaElement | null => {
    return activeFormatRef.current === 'video' ? videoElRef.current : audioElRef.current;
  }, []);

  const clearDriveStallTimer = useCallback(() => {
    if (driveStallTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(driveStallTimerRef.current);
      driveStallTimerRef.current = null;
    }
  }, []);

  const activateEmbedFallbackIfAvailable = useCallback((): boolean => {
    let embedUrl = mediaResolutionRef.current?.embedFallbackUrl ?? null;
    if (!embedUrl) {
      const ep = currentEpisodeRef.current;
      if (ep) {
        const formats = getEpisodeFormats(ep);
        const activeRef =
          activeFormatRef.current === 'video' && formats.videoRef
            ? formats.videoRef
            : formats.audioRef ?? ep.mediaRef;
        const driveId = extractDriveFileId(activeRef.id);
        if (driveId) {
          embedUrl = buildDrivePreviewEmbedUrl(driveId);
        }
      }
    }

    if (!embedUrl) return false;

    clearDriveStallTimer();
    pendingHandoffRef.current = null;
    audioElRef.current?.pause();
    videoElRef.current?.pause();
    setIsLoadingMedia(false);
    setIsPlaying(false);
    setErrorMessage(null);
    setVideoError(null);
    setActiveEmbedUrl(embedUrl);
    activeEmbedUrlRef.current = embedUrl;
    setIsExpanded(true);
    return true;
  }, [clearDriveStallTimer]);

  const scheduleDriveStallCheck = useCallback(
    (format: PlaybackFormat) => {
      clearDriveStallTimer();
      if (typeof window === 'undefined') return;
      if (!mediaResolutionRef.current?.embedFallbackUrl) return;

      driveStallTimerRef.current = window.setTimeout(() => {
        driveStallTimerRef.current = null;
        if (activeEmbedUrlRef.current) return;
        if (activeFormatRef.current !== format) return;
        const el = format === 'video' ? videoElRef.current : audioElRef.current;
        if (!el || el.readyState >= 1) return;

        const nextIdx = candidateIdxRef.current + 1;
        const nextUrl = fallbackCandidatesRef.current[nextIdx];
        if (nextUrl) {
          candidateIdxRef.current = nextIdx;
          if (pendingHandoffRef.current) {
            pendingHandoffRef.current = { ...pendingHandoffRef.current, url: nextUrl };
          }
          if (format === 'video') {
            setActiveVideoUrl(nextUrl);
            el.setAttribute('src', nextUrl);
          } else {
            el.src = nextUrl;
          }
          el.load();
          scheduleDriveStallCheck(format);
          return;
        }

        activateEmbedFallbackIfAvailable();
      }, 4200);
    },
    [activateEmbedFallbackIfAvailable, clearDriveStallTimer]
  );

  const tryNextMediaCandidate = useCallback(
    (el: HTMLMediaElement | null, format: PlaybackFormat): boolean => {
      const nextIdx = candidateIdxRef.current + 1;
      const nextUrl = fallbackCandidatesRef.current[nextIdx];
      if (!nextUrl || !el) return false;

      candidateIdxRef.current = nextIdx;
      if (pendingHandoffRef.current) {
        pendingHandoffRef.current = { ...pendingHandoffRef.current, url: nextUrl };
      }
      if (format === 'video') {
        setActiveVideoUrl(nextUrl);
        el.setAttribute('src', nextUrl);
      } else {
        el.src = nextUrl;
      }
      el.load();
      scheduleDriveStallCheck(format);
      return true;
    },
    [scheduleDriveStallCheck]
  );

  useEffect(() => {
    return () => {
      clearDriveStallTimer();
    };
  }, [clearDriveStallTimer]);

  const formatInfo = useMemo(() => {
    if (!currentEpisode) {
      return { hasAudio: false, hasVideo: false, canSwitch: false, audioRef: null, videoRef: null };
    }
    return getEpisodeFormats(currentEpisode);
  }, [currentEpisode]);

  const storyEpisodes = useMemo(() => {
    if (!currentStory) return [];
    return episodes
      .filter((e) => e.storyId === currentStory.id)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
  }, [currentStory, episodes]);

  const currentIdx = useMemo(() => {
    if (!currentEpisode) return -1;
    return storyEpisodes.findIndex((e) => e.id === currentEpisode.id);
  }, [currentEpisode, storyEpisodes]);

  const hasPrevious = currentIdx > 0;
  const hasNext = useMemo(() => {
    if (!currentEpisode) return false;
    if (currentEpisode.isEnding) return false;
    if (currentEpisode.choicePoint) return true;
    return currentIdx >= 0 && currentIdx < storyEpisodes.length - 1;
  }, [currentEpisode, currentIdx, storyEpisodes.length]);

  const persistProgress = useCallback(
    (posSec: number, durSec: number, completed = false) => {
      const story = currentStoryRef.current;
      const episode = currentEpisodeRef.current;
      if (!story || !episode) return;
      const rawDur = Number.isFinite(durSec) && durSec > 0 ? durSec : episode.durationSec;
      const safeDur = Math.max(1, Math.min(86400, Math.round(rawDur)));
      const rawPos = Number.isFinite(posSec) ? posSec : 0;
      const safePos = Math.max(0, Math.min(safeDur, Math.round(rawPos)));

      // Deduplicate rapid identical saves (e.g., togglePlayPause + native onPause event)
      const snapKey = `${episode.id}:${safePos}:${safeDur}:${completed ? 1 : 0}`;
      const now = Date.now();
      if (
        lastPersistedSnapshotRef.current &&
        lastPersistedSnapshotRef.current.key === snapKey &&
        now - lastPersistedSnapshotRef.current.at < 1200
      ) {
        return;
      }
      lastPersistedSnapshotRef.current = { key: snapKey, at: now };

      void saveProgress({
        storyId: story.id,
        storyOwnerUid: story.creatorOwnerUid,
        episodeId: episode.id,
        episodeNumber: episode.episodeNumber,
        positionSec: safePos,
        durationSec: safeDur,
        completed,
      });
    },
    [saveProgress]
  );

  const applyPendingHandoff = useCallback((el: HTMLMediaElement, expectedFormat: PlaybackFormat) => {
    const handoff = pendingHandoffRef.current;
    if (!handoff || handoff.targetFormat !== expectedFormat) return;
    if (currentEpisodeRef.current?.id !== handoff.episodeId) {
      pendingHandoffRef.current = null;
      return;
    }
    if (el.readyState < 1) return;

    pendingHandoffRef.current = null;

    const elDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationRef.current;
    const safeMax = elDur > 0.5 ? elDur - 0.25 : handoff.positionSec;
    const targetPos = Math.max(0, Math.min(safeMax, handoff.positionSec));

    el.playbackRate = handoff.playbackRate;
    el.volume = isMutedRef.current ? 0 : volumeRef.current;
    el.muted = isMutedRef.current;

    try {
      el.currentTime = targetPos;
    } catch {
      // Some engines ignore currentTime before SEEKABLE; fallback state stays accurate
    }

    setPlaybackRateState(handoff.playbackRate);
    playbackRateRef.current = handoff.playbackRate;
    setCurrentTime(targetPos);
    if (Number.isFinite(el.duration) && el.duration > 0) {
      setDuration(el.duration);
    }
    setIsLoadingMedia(false);
    setVideoError(null);

    if (handoff.shouldPlay) {
      void el
        .play()
        .then(() => {
          el.playbackRate = handoff.playbackRate;
          setIsPlaying(true);
        })
        .catch((err) => {
          setIsPlaying(false);
          const errName = err instanceof Error ? err.name : '';
          const errMsg = err instanceof Error ? err.message : '';
          if (errName === 'NotSupportedError' || /no supported source/i.test(errMsg)) {
            if (!tryNextMediaCandidate(el, expectedFormat)) {
              activateEmbedFallbackIfAvailable();
            }
          }
        });
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, [activateEmbedFallbackIfAvailable, tryNextMediaCandidate]);

  const attachVideoElement = useCallback(
    (el: HTMLVideoElement | null) => {
      if (videoElRef.current === el) return;
      videoElRef.current = el;
      setVideoElVersion((v) => v + 1);
      if (el) {
        el.volume = isMutedRef.current ? 0 : volumeRef.current;
        el.muted = isMutedRef.current;
        el.playbackRate = playbackRateRef.current;
        if (el.readyState >= 1) {
          applyPendingHandoff(el, 'video');
        }
      }
    },
    [applyPendingHandoff]
  );

  const triggerChoiceOverlayForEpisode = useCallback(
    (episode: Episode, mediaEl: HTMLMediaElement | null) => {
      if (!episode.choicePoint) return;
      triggeredChoicesRef.current.add(episode.choicePoint.id);
      if (mediaEl) {
        mediaEl.pause();
        persistProgress(mediaEl.currentTime, mediaEl.duration || durationRef.current, false);
      }
      setIsPlaying(false);
      setActiveChoicePoint(episode.choicePoint);
      setIsExpanded(true);
    },
    [persistProgress]
  );

  const loadMediaForEpisode = useCallback(
    async (
      story: Story,
      episode: Episode,
      targetFormat: PlaybackFormat,
      startSec: number,
      rate: number,
      shouldAutoPlay: boolean,
      initialDurationSec?: number
    ) => {
      const formats = getEpisodeFormats(episode);
      const mediaRef =
        targetFormat === 'video' && formats.videoRef
          ? formats.videoRef
          : formats.audioRef ?? episode.mediaRef;

      setIsLoadingMedia(true);
      setErrorMessage(null);
      setVideoError(null);
      setActiveEmbedUrl(null);
      activeEmbedUrlRef.current = null;

      // Pause both elements before loading the target stream
      audioElRef.current?.pause();
      videoElRef.current?.pause();

      const provider = getMediaProvider(mediaRef.provider);
      const resolution = await provider.getPlaybackUrl(mediaRef, profile, episode);
      setMediaResolution(resolution);
      mediaResolutionRef.current = resolution;
      mediaExpiresAtRef.current = resolution.expiresAt ?? null;
      refreshedExpiredUrlRef.current = null;

      const candidateSet = new Set<string>();
      if (resolution.url) candidateSet.add(resolution.url);
      for (const fallback of resolution.fallbackUrls ?? []) {
        if (fallback) candidateSet.add(fallback);
      }
      fallbackCandidatesRef.current = Array.from(candidateSet);
      candidateIdxRef.current = 0;
      clearDriveStallTimer();

      const effectiveInitialDuration =
        typeof initialDurationSec === 'number' &&
        Number.isFinite(initialDurationSec) &&
        initialDurationSec > 0
          ? initialDurationSec
          : episode.durationSec;

      const handoff: PendingMediaHandoff = {
        targetFormat,
        episodeId: episode.id,
        positionSec: startSec,
        playbackRate: rate,
        shouldPlay: shouldAutoPlay,
        url: resolution.url,
      };
      pendingHandoffRef.current = handoff;

      setActiveFormat(targetFormat);
      activeFormatRef.current = targetFormat;
      setCurrentTime(startSec);
      setDuration(effectiveInitialDuration);
      durationRef.current = effectiveInitialDuration;
      lastSavedSecRef.current = startSec;

      if (targetFormat === 'video') {
        setActiveVideoUrl(resolution.url);
        const video = videoElRef.current;
        if (video) {
          const currentAttrSrc = video.getAttribute('src');
          if (currentAttrSrc !== resolution.url) {
            video.setAttribute('src', resolution.url);
            video.load();
          } else if (video.readyState >= 1) {
            applyPendingHandoff(video, 'video');
          }
        }
        scheduleDriveStallCheck('video');
      } else {
        setActiveVideoUrl(null);
        const audio = audioElRef.current;
        if (audio) {
          audio.src = resolution.url;
          audio.playbackRate = rate;
          audio.volume = isMutedRef.current ? 0 : volumeRef.current;
          audio.muted = isMutedRef.current;
          audio.load();
          if (audio.readyState >= 1) {
            applyPendingHandoff(audio, 'audio');
          }
        }
        scheduleDriveStallCheck('audio');
      }

      persistProgress(startSec, effectiveInitialDuration, false);
    },
    [profile, persistProgress, applyPendingHandoff, clearDriveStallTimer, scheduleDriveStallCheck]
  );

  const isSignedUrlExpiringSoon = useCallback((bufferMs = 20_000): boolean => {
    const exp = mediaExpiresAtRef.current;
    if (!exp) return false;
    return Date.now() + bufferMs >= exp;
  }, []);

  const refreshSignedStreamIfNeeded = useCallback(
    async (options: { force?: boolean; targetPos?: number; shouldPlay?: boolean } = {}): Promise<boolean> => {
      const story = currentStoryRef.current;
      const episode = currentEpisodeRef.current;
      if (!story || !episode) return false;

      const format = activeFormatRef.current;
      const formats = getEpisodeFormats(episode);
      const activeRef =
        format === 'video' && formats.videoRef
          ? formats.videoRef
          : formats.audioRef ?? episode.mediaRef;

      if (activeRef.provider !== 'drive') return false;
      if (!options.force && !isSignedUrlExpiringSoon()) return false;
      if (isRefreshingSignedUrlRef.current) return true;

      const el = getActiveMediaElement();
      const currentUrl = el?.getAttribute('src') ?? el?.src ?? '';
      if (options.force && currentUrl && refreshedExpiredUrlRef.current === currentUrl) {
        return false;
      }

      isRefreshingSignedUrlRef.current = true;
      if (currentUrl) {
        refreshedExpiredUrlRef.current = currentUrl;
      }

      const pos =
        typeof options.targetPos === 'number'
          ? options.targetPos
          : el && Number.isFinite(el.currentTime)
            ? el.currentTime
            : currentTime;
      const shouldPlay =
        typeof options.shouldPlay === 'boolean' ? options.shouldPlay : isPlayingRef.current;

      try {
        await loadMediaForEpisode(
          story,
          episode,
          format,
          pos,
          playbackRateRef.current,
          shouldPlay,
          durationRef.current || episode.durationSec
        );
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to refresh media authorization.';
        if (format === 'video') {
          setVideoError(msg);
        } else {
          setErrorMessage(msg);
        }
        return false;
      } finally {
        isRefreshingSignedUrlRef.current = false;
      }
    },
    [currentTime, getActiveMediaElement, isSignedUrlExpiringSoon, loadMediaForEpisode]
  );

  const playEpisode = useCallback(
    async (
      story: Story,
      episode: Episode,
      customStartSec?: number,
      newlyUnlocked?: DailyUnlockEntry,
      forcedFormat?: PlaybackFormat,
      newlyUnlockedCoin?: EpisodeUnlockRecord
    ) => {
      setErrorMessage(null);
      setVideoError(null);
      setActiveChoicePoint(null);

      const effectiveDailyUnlocks = newlyUnlocked ? [...dailyUnlocks, newlyUnlocked] : dailyUnlocks;
      const effectiveCoinUnlocks = newlyUnlockedCoin
        ? [...episodeUnlocks, newlyUnlockedCoin]
        : episodeUnlocks;
      const access = canAccessEpisode(profile, episode, {
        story,
        episodeUnlocks: effectiveCoinUnlocks,
        dailyUnlocks: effectiveDailyUnlocks,
        economySettings,
      });
      if (!access.allowed) {
        setErrorMessage(
          `This episode requires ${access.effectivePriceCoins} coins to unlock permanently.`
        );
        return;
      }

      // Reset triggered choice marker for this episode so re-listening can trigger its choice again
      if (episode.choicePoint) {
        triggeredChoicesRef.current.delete(episode.choicePoint.id);
      }

      setCurrentStory(story);
      setCurrentEpisode(episode);
      currentStoryRef.current = story;
      currentEpisodeRef.current = episode;

      const resolvedFormat = forcedFormat
        ? resolveEffectiveFormat(episode, forcedFormat)
        : resolveEffectiveFormat(episode, preferredFormat);

      if (resolvedFormat === 'video') {
        setIsExpanded(true);
      }

      const prior = history.find((h) => h.episodeId === episode.id);
      const resumeAt =
        typeof customStartSec === 'number'
          ? customStartSec
          : prior && !prior.completed && prior.positionSec > 2
            ? prior.positionSec
            : 0;
      const initialDurationSec =
        prior && prior.durationSec > 0 ? prior.durationSec : episode.durationSec;

      try {
        await loadMediaForEpisode(
          story,
          episode,
          resolvedFormat,
          resumeAt,
          playbackRateRef.current,
          true,
          initialDurationSec
        );
      } catch (err) {
        setIsLoadingMedia(false);
        setErrorMessage(err instanceof Error ? err.message : 'Unable to resolve media stream.');
      }
    },
    [
      dailyUnlocks,
      episodeUnlocks,
      economySettings,
      profile,
      preferredFormat,
      history,
      loadMediaForEpisode,
    ]
  );

  const switchFormat = useCallback(
    async (nextFormat: PlaybackFormat) => {
      const story = currentStoryRef.current;
      const episode = currentEpisodeRef.current;
      if (!story || !episode) return;

      const formats = getEpisodeFormats(episode);
      if (!formats.canSwitch) return;
      if (nextFormat === activeFormatRef.current && !videoError) return;

      const outgoing = getActiveMediaElement();
      const outgoingHasMedia = Boolean(outgoing && outgoing.readyState >= 1);
      const preservedPos =
        outgoingHasMedia && outgoing && Number.isFinite(outgoing.currentTime)
          ? outgoing.currentTime
          : currentTime;
      const preservedRate =
        outgoingHasMedia && outgoing && Number.isFinite(outgoing.playbackRate) && outgoing.playbackRate > 0
          ? outgoing.playbackRate
          : playbackRateRef.current;
      const preservedPlaying = outgoingHasMedia && outgoing ? !outgoing.paused : isPlayingRef.current;

      // Persist user's preferred format to their profile (Firestore or guest storage)
      void setPreferredFormat(nextFormat);

      if (nextFormat === 'video') {
        setIsExpanded(true);
      }

      try {
        await loadMediaForEpisode(
          story,
          episode,
          nextFormat,
          preservedPos,
          preservedRate,
          preservedPlaying
        );
      } catch (err) {
        setIsLoadingMedia(false);
        if (nextFormat === 'video') {
          setVideoError(err instanceof Error ? err.message : 'Video stream could not be loaded.');
        } else {
          setErrorMessage(err instanceof Error ? err.message : 'Audio stream could not be loaded.');
        }
      }
    },
    [currentTime, getActiveMediaElement, loadMediaForEpisode, setPreferredFormat, videoError]
  );

  const retryVideoLoad = useCallback(async () => {
    const story = currentStoryRef.current;
    const episode = currentEpisodeRef.current;
    if (!story || !episode) return;
    setVideoError(null);
    await loadMediaForEpisode(
      story,
      episode,
      'video',
      currentTime,
      playbackRateRef.current,
      isPlayingRef.current
    );
  }, [currentTime, loadMediaForEpisode]);

  const playLocalFileForEpisode = useCallback(
    async (file: File, story: Story, episode: Episode) => {
      setErrorMessage(null);
      setIsLoadingMedia(true);
      try {
        const demoProvider = getMediaProvider('demo');
        const uploadedRef = await demoProvider.upload(file, {
          storyId: story.id,
          episodeId: episode.id,
          title: episode.title,
        });
        const isVideo = uploadedRef.type === 'video';
        const patchedEpisode: Episode = {
          ...episode,
          priceCoins: 0,
          mediaRef: isVideo ? episode.mediaRef : uploadedRef,
          audioRef: isVideo ? episode.audioRef ?? episode.mediaRef : uploadedRef,
          videoMediaRef: isVideo ? uploadedRef : episode.videoMediaRef,
        };
        await playEpisode(story, patchedEpisode, 0, undefined, isVideo ? 'video' : 'audio');
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not load local media file.');
      } finally {
        setIsLoadingMedia(false);
      }
    },
    [playEpisode]
  );

  const togglePlayPause = useCallback(async () => {
    if (activeChoicePoint) return;
    if (activeEmbedUrlRef.current) {
      setIsExpanded(true);
      return;
    }
    const el = getActiveMediaElement();
    if (!el || !currentEpisodeRef.current) return;

    if (!el.paused) {
      el.pause();
      setIsPlaying(false);
      persistProgress(el.currentTime, el.duration || durationRef.current, false);
    } else {
      if (isSignedUrlExpiringSoon()) {
        await refreshSignedStreamIfNeeded({
          force: false,
          targetPos: Number.isFinite(el.currentTime) ? el.currentTime : currentTime,
          shouldPlay: true,
        });
        return;
      }
      try {
        await el.play();
        setIsPlaying(true);
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        const errMsg = err instanceof Error ? err.message : '';
        if (errName === 'NotSupportedError' || /no supported source/i.test(errMsg)) {
          if (tryNextMediaCandidate(el, activeFormatRef.current)) {
            return;
          }
          if (activateEmbedFallbackIfAvailable()) {
            return;
          }
          setErrorMessage(
            'This episode media link could not be decoded. Make sure the file is shared as "Anyone with the link" or attach a direct HTTPS audio/video URL in Creator Studio.'
          );
          return;
        }
        if (errName === 'NotAllowedError') {
          setErrorMessage('Tap Play again to start audio in your browser.');
          return;
        }
        setErrorMessage('Playback could not start right now. Please try again.');
      }
    }
  }, [
    activateEmbedFallbackIfAvailable,
    activeChoicePoint,
    currentTime,
    getActiveMediaElement,
    isSignedUrlExpiringSoon,
    persistProgress,
    refreshSignedStreamIfNeeded,
    tryNextMediaCandidate,
  ]);

  const seekTo = useCallback(
    (seconds: number) => {
      const el = getActiveMediaElement();
      const maxDur =
        el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationRef.current;
      const clamped = Math.max(0, Math.min(maxDur || 0, seconds));

      if (isSignedUrlExpiringSoon(5_000)) {
        setCurrentTime(clamped);
        lastSavedSecRef.current = clamped;
        persistProgress(clamped, maxDur, false);
        void refreshSignedStreamIfNeeded({
          force: false,
          targetPos: clamped,
          shouldPlay: isPlayingRef.current,
        });
        return;
      }

      if (el) {
        try {
          el.currentTime = clamped;
        } catch {
          // ignore if not yet seekable
        }
      }
      setCurrentTime(clamped);
      lastSavedSecRef.current = clamped;
      persistProgress(clamped, maxDur, false);

      // Check if seeking directly into/past a choice point should open it
      const ep = currentEpisodeRef.current;
      const alreadyTriggeredId =
        ep?.choicePoint && triggeredChoicesRef.current.has(ep.choicePoint.id) ? ep.id : null;
      if (ep && shouldTriggerChoicePoint(ep, clamped, maxDur, alreadyTriggeredId)) {
        triggerChoiceOverlayForEpisode(ep, el);
      }
    },
    [
      getActiveMediaElement,
      isSignedUrlExpiringSoon,
      persistProgress,
      refreshSignedStreamIfNeeded,
      triggerChoiceOverlayForEpisode,
    ]
  );

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const el = getActiveMediaElement();
      const base = el && Number.isFinite(el.currentTime) ? el.currentTime : currentTime;
      seekTo(base + deltaSeconds);
    },
    [currentTime, getActiveMediaElement, seekTo]
  );

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    playbackRateRef.current = rate;
    if (audioElRef.current) audioElRef.current.playbackRate = rate;
    if (videoElRef.current) videoElRef.current.playbackRate = rate;
  }, []);

  const cyclePlaybackRate = useCallback(() => {
    const idx = PLAYBACK_SPEEDS.indexOf(playbackRate as (typeof PLAYBACK_SPEEDS)[number]);
    const next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackRate(next);
  }, [playbackRate, setPlaybackRate]);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    const mutedNow = clamped === 0;
    setIsMutedState(mutedNow);
    isMutedRef.current = mutedNow;
    if (audioElRef.current) {
      audioElRef.current.volume = clamped;
      audioElRef.current.muted = mutedNow;
    }
    if (videoElRef.current) {
      videoElRef.current.volume = clamped;
      videoElRef.current.muted = mutedNow;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    setIsMutedState(nextMuted);
    isMutedRef.current = nextMuted;
    if (audioElRef.current) audioElRef.current.muted = nextMuted;
    if (videoElRef.current) videoElRef.current.muted = nextMuted;
  }, []);

  const chooseBranchOption = useCallback(
    async (option: InteractiveChoiceOption) => {
      const story = currentStoryRef.current;
      const episode = currentEpisodeRef.current;
      if (!story || !episode) return;

      await recordUserChoice({
        storyId: story.id,
        episodeId: episode.id,
        choicePointId: episode.choicePoint?.id ?? `cp-${episode.id}`,
        optionId: option.id,
        optionLabelEn: option.labelEn,
        optionLabelHi: option.labelHi,
        nextEpisodeId: option.nextEpisodeId,
      });

      // Mark current episode completed as the user advances to the chosen branch
      persistProgress(durationRef.current || episode.durationSec, durationRef.current || episode.durationSec, true);
      setActiveChoicePoint(null);

      const nextEp = episodes.find(
        (e) => e.storyId === story.id && e.id === option.nextEpisodeId
      );
      if (nextEp) {
        const keepFormat = activeFormatRef.current === 'video' ? 'video' : undefined;
        await playEpisode(story, nextEp, 0, undefined, keepFormat);
      }
    },
    [episodes, persistProgress, playEpisode, recordUserChoice]
  );

  const dismissChoiceAndRewind = useCallback(() => {
    const ep = currentEpisodeRef.current;
    if (ep?.choicePoint) {
      triggeredChoicesRef.current.delete(ep.choicePoint.id);
    }
    setActiveChoicePoint(null);
    const el = getActiveMediaElement();
    const target = Math.max(0, currentTime - 8);
    if (el) {
      el.currentTime = target;
      setCurrentTime(target);
      void el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, [currentTime, getActiveMediaElement]);

  const openChoicePreview = useCallback(() => {
    const ep = currentEpisodeRef.current;
    if (!ep?.choicePoint) return;
    triggerChoiceOverlayForEpisode(ep, getActiveMediaElement());
  }, [getActiveMediaElement, triggerChoiceOverlayForEpisode]);

  const replayFromChoice = useCallback(
    async (story: Story, episode: Episode) => {
      await pruneStoryChoicesFromEpisode(story.id, episode.id);
      if (episode.choicePoint) {
        triggeredChoicesRef.current.delete(episode.choicePoint.id);
      }
      const triggerSec = episode.choicePoint?.triggerAtSec;
      const startAt =
        typeof triggerSec === 'number' ? Math.max(0, triggerSec - 4) : 0;
      setIsExpanded(true);
      await playEpisode(story, episode, startAt);
    },
    [playEpisode, pruneStoryChoicesFromEpisode]
  );

  const playNextEpisode = useCallback(async () => {
    const story = currentStoryRef.current;
    const ep = currentEpisodeRef.current;
    if (!story || !ep || ep.isEnding) return;

    if (ep.choicePoint) {
      const existingChoice = userChoices.find(
        (c) => c.storyId === story.id && c.episodeId === ep.id
      );
      if (existingChoice) {
        const chosenEp = storyEpisodes.find((e) => e.id === existingChoice.nextEpisodeId);
        if (chosenEp) {
          const keepFormat = activeFormatRef.current === 'video' ? 'video' : undefined;
          await playEpisode(story, chosenEp, 0, undefined, keepFormat);
          return;
        }
      }
      triggerChoiceOverlayForEpisode(ep, getActiveMediaElement());
      return;
    }

    if (currentIdx >= 0 && currentIdx < storyEpisodes.length - 1) {
      const nextEp = storyEpisodes[currentIdx + 1];
      if (nextEp) {
        const keepFormat = activeFormatRef.current === 'video' ? 'video' : undefined;
        await playEpisode(story, nextEp, undefined, undefined, keepFormat);
      }
    }
  }, [
    currentIdx,
    getActiveMediaElement,
    playEpisode,
    storyEpisodes,
    triggerChoiceOverlayForEpisode,
    userChoices,
  ]);

  const playPreviousEpisode = useCallback(async () => {
    if (!currentStory || !hasPrevious) return;
    const prevEp = storyEpisodes[currentIdx - 1];
    if (prevEp) {
      const keepFormat = activeFormatRef.current === 'video' ? 'video' : undefined;
      await playEpisode(currentStory, prevEp, undefined, undefined, keepFormat);
    }
  }, [currentStory, hasPrevious, storyEpisodes, currentIdx, playEpisode]);

  const closePlayer = useCallback(() => {
    clearDriveStallTimer();
    fallbackCandidatesRef.current = [];
    candidateIdxRef.current = 0;
    const el = getActiveMediaElement();
    if (el) {
      el.pause();
      persistProgress(el.currentTime, el.duration || durationRef.current, false);
    }
    audioElRef.current?.pause();
    videoElRef.current?.pause();
    setIsPlaying(false);
    setIsExpanded(false);
    setActiveChoicePoint(null);
    setCurrentStory(null);
    setCurrentEpisode(null);
    setMediaResolution(null);
    setActiveVideoUrl(null);
    setActiveEmbedUrl(null);
    activeEmbedUrlRef.current = null;
    setVideoError(null);
  }, [clearDriveStallTimer, getActiveMediaElement, persistProgress]);

  // Attach shared DOM event listeners to BOTH <audio> and <video>
  const bindMediaListeners = useCallback(
    (el: HTMLMediaElement, format: PlaybackFormat) => {
      const isCurrentFormat = () => activeFormatRef.current === format;

      const onLoadedMetadata = () => {
        if (!isCurrentFormat()) return;
        clearDriveStallTimer();
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDuration(el.duration);
          durationRef.current = el.duration;
        }
        applyPendingHandoff(el, format);
      };

      const onDurationChange = () => {
        if (!isCurrentFormat()) return;
        if (Number.isFinite(el.duration) && el.duration > 0) {
          setDuration(el.duration);
          durationRef.current = el.duration;
        }
      };

      const onCanPlay = () => {
        if (!isCurrentFormat()) return;
        clearDriveStallTimer();
        setIsLoadingMedia(false);
        applyPendingHandoff(el, format);
      };

      const onWaiting = () => {
        if (!isCurrentFormat()) return;
        setIsLoadingMedia(true);
      };

      const onTimeUpdate = () => {
        if (!isCurrentFormat()) return;
        const t = el.currentTime;
        const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationRef.current;
        setCurrentTime(t);

        // Save resume progress to Firestore listeningHistory every ~10 seconds
        if (Math.abs(t - lastSavedSecRef.current) >= 10) {
          lastSavedSecRef.current = t;
          persistProgress(t, d, false);
        }

        // Check interactive choicePoint trigger
        const ep = currentEpisodeRef.current;
        const alreadyTriggeredId =
          ep?.choicePoint && triggeredChoicesRef.current.has(ep.choicePoint.id) ? ep.id : null;
        if (ep && shouldTriggerChoicePoint(ep, t, d, alreadyTriggeredId)) {
          triggerChoiceOverlayForEpisode(ep, el);
        }
      };

      const onEnded = () => {
        if (!isCurrentFormat()) return;
        setIsPlaying(false);
        const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationRef.current;
        const ep = currentEpisodeRef.current;

        if (ep?.choicePoint && !triggeredChoicesRef.current.has(ep.choicePoint.id)) {
          triggerChoiceOverlayForEpisode(ep, el);
          return;
        }

        persistProgress(d, d, true);

        if (ep && !ep.isEnding && !ep.choicePoint) {
          void playNextEpisode();
        }
      };

      const onPause = () => {
        if (!isCurrentFormat()) return;
        setIsPlaying(false);
        if (el.currentTime > 0) {
          lastSavedSecRef.current = el.currentTime;
          persistProgress(el.currentTime, el.duration || durationRef.current, false);
        }
      };

      const onPlay = () => {
        if (!isCurrentFormat()) return;
        clearDriveStallTimer();
        setIsPlaying(true);
        setIsLoadingMedia(false);
      };

      const onError = () => {
        if (!isCurrentFormat()) return;
        if (activeEmbedUrlRef.current) return;

        // If a short-lived server-signed stream token expired mid-playback, transparently re-authorize once
        const ep = currentEpisodeRef.current;
        const formats = ep ? getEpisodeFormats(ep) : null;
        const activeRef =
          ep && formats
            ? format === 'video' && formats.videoRef
              ? formats.videoRef
              : formats.audioRef ?? ep.mediaRef
            : null;

        const currentSrc = el.getAttribute('src') ?? el.src ?? '';
        const isSignedProxyUrl = currentSrc.includes('/api/media/stream');
        if (activeRef?.provider === 'drive' && isSignedProxyUrl && !isRefreshingSignedUrlRef.current) {
          if (refreshedExpiredUrlRef.current !== currentSrc) {
            void refreshSignedStreamIfNeeded({
              force: true,
              targetPos: Number.isFinite(el.currentTime) ? el.currentTime : 0,
              shouldPlay: isPlayingRef.current,
            });
            return;
          }
        }

        // First try remaining direct stream candidates (e.g. alternative Drive download/open URLs)
        if (tryNextMediaCandidate(el, format)) {
          return;
        }

        // Automatically switch Google Drive media to Google's universal embedded player (supports all formats, zero errors on static hosts!)
        if (activateEmbedFallbackIfAvailable()) {
          return;
        }

        clearDriveStallTimer();
        setIsLoadingMedia(false);
        setIsPlaying(false);
        if (format === 'video') {
          setVideoError(
            'Unable to load the video stream right now. Verify the file link is publicly accessible or switch to Audio.'
          );
        } else {
          setErrorMessage(
            'This episode audio link could not be loaded. Make sure the file is shared publicly ("Anyone with the link") or attach a direct HTTPS audio/video file URL in Creator Studio.'
          );
        }
      };

      el.addEventListener('loadedmetadata', onLoadedMetadata);
      el.addEventListener('durationchange', onDurationChange);
      el.addEventListener('canplay', onCanPlay);
      el.addEventListener('waiting', onWaiting);
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('ended', onEnded);
      el.addEventListener('pause', onPause);
      el.addEventListener('play', onPlay);
      el.addEventListener('error', onError);

      return () => {
        el.removeEventListener('loadedmetadata', onLoadedMetadata);
        el.removeEventListener('durationchange', onDurationChange);
        el.removeEventListener('canplay', onCanPlay);
        el.removeEventListener('waiting', onWaiting);
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('play', onPlay);
        el.removeEventListener('error', onError);
      };
    },
    [
      activateEmbedFallbackIfAvailable,
      applyPendingHandoff,
      clearDriveStallTimer,
      persistProgress,
      playNextEpisode,
      refreshSignedStreamIfNeeded,
      triggerChoiceOverlayForEpisode,
      tryNextMediaCandidate,
    ]
  );

  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    return bindMediaListeners(audio, 'audio');
  }, [bindMediaListeners]);

  useEffect(() => {
    const video = videoElRef.current;
    if (!video) return;
    return bindMediaListeners(video, 'video');
  }, [bindMediaListeners, videoElVersion]);

  // Save resume position on page exit / tab hide
  useEffect(() => {
    const handlePageExit = () => {
      const el = getActiveMediaElement();
      if (el && currentEpisodeRef.current) {
        persistProgress(el.currentTime, el.duration || durationRef.current, false);
      }
    };
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);
    return () => {
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
    };
  }, [getActiveMediaElement, persistProgress]);

  // Wire browser MediaSession API for lock-screen / hardware media controls
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !('mediaSession' in navigator) ||
      !currentStory ||
      !currentEpisode
    ) {
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Ep ${currentEpisode.episodeNumber}: ${currentEpisode.title}`,
        artist: currentStory.creatorName,
        album: currentStory.title,
        artwork: currentStory.coverUrl
          ? [{ src: currentStory.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
      navigator.mediaSession.setActionHandler('play', () => void togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => void togglePlayPause());
      navigator.mediaSession.setActionHandler('seekbackward', () => skipBy(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => skipBy(15));
      navigator.mediaSession.setActionHandler(
        'previoustrack',
        hasPrevious ? () => void playPreviousEpisode() : null
      );
      navigator.mediaSession.setActionHandler(
        'nexttrack',
        hasNext ? () => void playNextEpisode() : null
      );
    } catch {
      // Some embedded browsers restrict MediaSession handlers
    }
  }, [
    currentStory,
    currentEpisode,
    togglePlayPause,
    skipBy,
    hasPrevious,
    hasNext,
    playPreviousEpisode,
    playNextEpisode,
  ]);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentStory,
        currentEpisode,
        mediaResolution,
        activeFormat,
        canSwitchFormat: formatInfo.canSwitch,
        hasVideoFormat: formatInfo.hasVideo,
        activeVideoUrl,
        activeEmbedUrl,
        isPlaying,
        isLoadingMedia,
        currentTime,
        duration,
        playbackRate,
        volume,
        isMuted,
        isExpanded,
        errorMessage,
        videoError,
        activeChoicePoint,
        hasPrevious,
        hasNext,
        attachVideoElement,
        playEpisode,
        playLocalFileForEpisode,
        switchFormat,
        retryVideoLoad,
        togglePlayPause,
        seekTo,
        skipBy,
        setPlaybackRate,
        cyclePlaybackRate,
        setVolume,
        toggleMute,
        playNextEpisode,
        playPreviousEpisode,
        chooseBranchOption,
        dismissChoiceAndRewind,
        openChoicePreview,
        replayFromChoice,
        setIsExpanded,
        closePlayer,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
};

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  }
  return ctx;
}
