import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Coins,
  Edit3,
  ExternalLink,
  Film,
  FolderInput,
  GitBranch,
  Layers,
  Loader2,
  Lock,
  Mic,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { DriveFolderImportModal } from '../components/DriveFolderImportModal';
import { PortraitVideoFrame } from '../components/PortraitVideoFrame';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { formatPlayCount } from '../services/access/episodeAccess';
import {
  deleteCreatorEpisodeFromFirestore,
  deleteCreatorStoryFromFirestore,
  fetchCreatorAnalyticsHistory,
  fetchCreatorOwnStories,
  persistReorderedEpisodesToFirestore,
  saveCreatorEpisodeToFirestore,
  saveCreatorStoryToFirestore,
} from '../services/firebase/studioService';
import { getMediaProvider } from '../services/media';
import {
  applyVideoSelectionToEpisodeForm,
  detectVideoAspectFormat,
  formatPortraitRejectionMessage,
  formatVideoDimensions,
  readVideoFileDimensions,
  validateSupportedVideoDimensions,
  type VideoAspectFormat,
} from '../services/media/portraitVideo';
import {
  canManageStory,
  computeCreatorStats,
  computeStoryAnalytics,
  reorderEpisodeList,
  validateChoicePoint,
} from '../services/studio/studioAnalytics';
import { getSafeErrorMessage } from '../utils/validation';
import type {
  ContentLanguage,
  CoverTheme,
  Creator,
  Episode,
  EpisodeChoicePoint,
  InteractiveChoiceOption,
  ListeningHistoryEntry,
  MediaRef,
  Story,
  StoryFormat,
  StoryVisibility,
} from '../types';

const COVER_THEMES: CoverTheme[] = [
  'mythology-gold',
  'romance-mist',
  'thriller-noir',
  'horror-amber',
  'crime-deco',
  'kids-lantern',
  'motivation-dawn',
  'comedy-bazaar',
  'mystery-emerald',
  'folklore-crimson',
  'scifi-indigo',
  'drama-sepia',
];

type StudioTab = 'stories' | 'episodes' | 'analytics';

interface StoryFormState {
  id?: string;
  title: string;
  titleHi: string;
  synopsis: string;
  synopsisHi: string;
  genreId: string;
  language: ContentLanguage;
  coverTheme: CoverTheme;
  coverUrl: string;
  visibility: StoryVisibility;
  format: StoryFormat;
  isInteractive: boolean;
}

interface EpisodeFormState {
  id?: string;
  episodeNumber: number;
  title: string;
  titleHi: string;
  description: string;
  descriptionHi: string;
  durationSec: number;
  priceCoins: number;
  isEnding: boolean;
  audioRef: MediaRef;
  videoMediaRef: MediaRef | null;
  hasChoicePoint: boolean;
  choiceTriggerAtEnd: boolean;
  choiceTriggerAtSec: number;
  choicePromptEn: string;
  choicePromptHi: string;
  choiceOptions: InteractiveChoiceOption[];
}

export const CreatorStudioPage: React.FC = () => {
  const { lang, t } = useLanguage();
  const { playEpisode } = useAudioPlayer();
  const {
    profile,
    categories,
    creators,
    stories: catalogStories,
    episodes: catalogEpisodes,
    history: localHistory,
    refreshCatalog,
  } = useAppData();

  const [activeTab, setActiveTab] = useState<StudioTab>('stories');
  const [ownStories, setOwnStories] = useState<Story[]>([]);
  const [analyticsHistory, setAnalyticsHistory] = useState<ListeningHistoryEntry[]>([]);
  const [loadingStudio, setLoadingStudio] = useState(true);
  const [selectedStoryId, setSelectedStoryId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Story modal state
  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [storyForm, setStoryForm] = useState<StoryFormState>({
    title: '',
    titleHi: '',
    synopsis: '',
    synopsisHi: '',
    genreId: categories[0]?.id ?? 'mythology',
    language: 'bilingual',
    coverTheme: 'mythology-gold',
    coverUrl: '',
    visibility: 'draft',
    format: 'audio',
    isInteractive: false,
  });

  // Episode modal state
  const [episodeModalOpen, setEpisodeModalOpen] = useState(false);
  const [episodeForm, setEpisodeForm] = useState<EpisodeFormState | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<'audio' | 'video' | null>(null);
  const [validatingVideo, setValidatingVideo] = useState(false);
  const [videoValidationError, setVideoValidationError] = useState<{
    kind: 'wrong_aspect_ratio' | 'unreadable_metadata';
    message: string;
    file?: File;
  } | null>(null);
  const [videoDetectedDimensions, setVideoDetectedDimensions] = useState<{
    width: number;
    height: number;
    format: VideoAspectFormat;
  } | null>(null);
  const [studioPreviewAspect, setStudioPreviewAspect] = useState<VideoAspectFormat>('9:16');
  const [studioPreviewUrl, setStudioPreviewUrl] = useState<string | null>(null);
  const [studioPreviewLoading, setStudioPreviewLoading] = useState(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // Google Drive folder import modal
  const [driveImportOpen, setDriveImportOpen] = useState(false);

  // Delete story confirmation
  const [deleteStoryTarget, setDeleteStoryTarget] = useState<Story | null>(null);

  // Resolve inline Studio preview URL strictly through MediaProvider (supports both Demo and Drive)
  useEffect(() => {
    let cancelled = false;
    const videoRef = episodeForm?.videoMediaRef;
    if (!episodeModalOpen || !videoRef) {
      setStudioPreviewUrl(null);
      setStudioPreviewLoading(false);
      return;
    }

    setStudioPreviewLoading(true);
    const provider = getMediaProvider(videoRef.provider);
    const previewEpisodeContext =
      episodeForm?.id && selectedStoryId
        ? catalogEpisodes.find((ep) => ep.id === episodeForm.id)
        : undefined;
    void provider
      .getPlaybackUrl(videoRef, profile, previewEpisodeContext)
      .then((res) => {
        if (!cancelled) {
          setStudioPreviewUrl(res.url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStudioPreviewUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStudioPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [episodeModalOpen, episodeForm?.videoMediaRef, episodeForm?.id, selectedStoryId, catalogEpisodes, profile]);

  const loadStudioData = useCallback(async () => {
    if (!profile) return;
    setLoadingStudio(true);
    try {
      const [fetchedStories, fetchedHistory] = await Promise.all([
        fetchCreatorOwnStories(profile.uid),
        fetchCreatorAnalyticsHistory(profile.uid),
      ]);
      // Merge Firestore owned stories with any matching catalog stories (admin can also manage all stories)
      const byId = new Map<string, Story>();
      for (const s of fetchedStories) {
        byId.set(s.id, s);
      }
      if (profile.role === 'admin') {
        for (const s of catalogStories) {
          if (!byId.has(s.id)) byId.set(s.id, s);
        }
      } else {
        for (const s of catalogStories) {
          if (canManageStory(profile, s) && !byId.has(s.id)) {
            byId.set(s.id, s);
          }
        }
      }
      const list = Array.from(byId.values()).sort(
        (a, b) => Date.parse(b.updatedAt || b.publishedAt) - Date.parse(a.updatedAt || a.publishedAt)
      );
      setOwnStories(list);
      setAnalyticsHistory(fetchedHistory);
      setSelectedStoryId((prev) => (prev && byId.has(prev) ? prev : list[0]?.id ?? ''));
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to load Creator Studio data.'),
      });
    } finally {
      setLoadingStudio(false);
    }
  }, [profile, catalogStories]);

  useEffect(() => {
    void loadStudioData();
  }, [loadStudioData]);

  useEffect(() => {
    if (!storyModalOpen && !episodeModalOpen && !deleteStoryTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteStoryTarget) setDeleteStoryTarget(null);
        else if (episodeModalOpen) setEpisodeModalOpen(false);
        else if (storyModalOpen) setStoryModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [storyModalOpen, episodeModalOpen, deleteStoryTarget]);

  const myCreatorProfile = useMemo<Creator>(() => {
    if (!profile) {
      return {
        id: 'creator-local',
        ownerUid: '',
        name: 'Creator Studio',
        handle: '@studio',
        language: 'bilingual',
        followersCount: 0,
        storiesCount: 0,
        verified: false,
      };
    }
    const found = creators.find((c) => c.ownerUid === profile.uid);
    if (found) return found;
    return {
      id: `creator-${profile.uid.slice(0, 20)}`,
      ownerUid: profile.uid,
      name: profile.displayName || 'Dhruv Tales Creator',
      handle: `@${(profile.displayName || 'creator').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
      language: 'bilingual',
      followersCount: 0,
      storiesCount: ownStories.length,
      verified: profile.role === 'admin',
    };
  }, [creators, profile, ownStories.length]);

  const ownStoryIds = useMemo(() => new Set(ownStories.map((s) => s.id)), [ownStories]);

  const ownEpisodes = useMemo(
    () =>
      catalogEpisodes
        .filter((e) => ownStoryIds.has(e.storyId))
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [catalogEpisodes, ownStoryIds]
  );

  const stats = useMemo(
    () => computeCreatorStats(ownStories, ownEpisodes, myCreatorProfile.followersCount),
    [ownStories, ownEpisodes, myCreatorProfile.followersCount]
  );

  const selectedStory = useMemo(
    () => ownStories.find((s) => s.id === selectedStoryId) ?? ownStories[0] ?? null,
    [ownStories, selectedStoryId]
  );

  const selectedStoryEpisodes = useMemo(
    () =>
      selectedStory
        ? catalogEpisodes
            .filter((e) => e.storyId === selectedStory.id)
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
        : [],
    [catalogEpisodes, selectedStory]
  );

  // Merge Firestore creator analytics with local session history (deduped by id) so newly played episodes reflect immediately
  const combinedHistory = useMemo(() => {
    const map = new Map<string, ListeningHistoryEntry>();
    for (const h of analyticsHistory) map.set(h.id, h);
    for (const h of localHistory) {
      if (ownStoryIds.has(h.storyId) && !map.has(h.id)) {
        map.set(h.id, h);
      }
    }
    return Array.from(map.values());
  }, [analyticsHistory, localHistory, ownStoryIds]);

  const storyAnalytics = useMemo(() => {
    if (!selectedStory) return null;
    return computeStoryAnalytics(selectedStory.id, selectedStoryEpisodes, combinedHistory);
  }, [selectedStory, selectedStoryEpisodes, combinedHistory]);

  // --- Story CRUD Handlers ---
  const openCreateStory = () => {
    setBanner(null);
    setStoryForm({
      title: '',
      titleHi: '',
      synopsis: '',
      synopsisHi: '',
      genreId: categories[0]?.id ?? 'mythology',
      language: 'bilingual',
      coverTheme: 'mythology-gold',
      coverUrl: '',
      visibility: 'draft',
      format: 'audio',
      isInteractive: false,
    });
    setStoryModalOpen(true);
  };

  const openEditStory = (story: Story) => {
    setBanner(null);
    setStoryForm({
      id: story.id,
      title: story.title,
      titleHi: story.titleHi,
      synopsis: story.synopsis,
      synopsisHi: story.synopsisHi,
      genreId: story.genreId,
      language: story.language,
      coverTheme: story.coverTheme,
      coverUrl: story.coverUrl ?? '',
      visibility: story.visibility,
      format: story.format,
      isInteractive: story.isInteractive,
    });
    setStoryModalOpen(true);
  };

  const handleSaveStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (storyForm.title.trim().length < 2 || storyForm.synopsis.trim().length < 5) {
      setBanner({ type: 'error', text: 'Please enter a valid story title and synopsis.' });
      return;
    }

    setBusy(true);
    setBanner(null);
    try {
      const saved = await saveCreatorStoryToFirestore(storyForm, profile.uid, myCreatorProfile);
      setStoryModalOpen(false);
      setSelectedStoryId(saved.id);
      await refreshCatalog();
      await loadStudioData();
      setBanner({
        type: 'success',
        text: storyForm.id
          ? `Updated "${saved.title}" in Firestore.`
          : `Created "${saved.title}" in Firestore.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to save story.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteStory = async () => {
    if (!deleteStoryTarget) return;
    setBusy(true);
    setBanner(null);
    try {
      const epIds = catalogEpisodes
        .filter((e) => e.storyId === deleteStoryTarget.id)
        .map((e) => e.id);
      await deleteCreatorStoryFromFirestore(deleteStoryTarget.id, epIds);
      setDeleteStoryTarget(null);
      await refreshCatalog();
      await loadStudioData();
      setBanner({
        type: 'success',
        text: `Deleted "${deleteStoryTarget.title}" and ${epIds.length} episodes.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to delete story.'),
      });
    } finally {
      setBusy(false);
    }
  };

  // --- Episode CRUD & Reorder Handlers ---
  const openCreateEpisode = () => {
    if (!selectedStory) return;
    setBanner(null);
    setVideoValidationError(null);
    setVideoDetectedDimensions(null);
    const nextNum = selectedStoryEpisodes.length + 1;
    setEpisodeForm({
      episodeNumber: nextNum,
      title: '',
      titleHi: '',
      description: '',
      descriptionHi: '',
      durationSec: 180,
      priceCoins: nextNum <= 2 ? 0 : 10,
      isEnding: false,
      audioRef: {
        provider: 'demo',
        id: `demo-audio-${selectedStory.id}-ep${nextNum}`,
        type: 'audio',
      },
      videoMediaRef: null,
      hasChoicePoint: false,
      choiceTriggerAtEnd: true,
      choiceTriggerAtSec: 25,
      choicePromptEn: '',
      choicePromptHi: '',
      choiceOptions: [
        { id: `opt-${Date.now()}-1`, labelEn: '', labelHi: '', nextEpisodeId: '' },
        { id: `opt-${Date.now()}-2`, labelEn: '', labelHi: '', nextEpisodeId: '' },
      ],
    });
    setEpisodeModalOpen(true);
  };

  const openEditEpisode = (ep: Episode) => {
    setBanner(null);
    setVideoValidationError(null);
    setVideoDetectedDimensions(null);
    const cp = ep.choicePoint;
    setEpisodeForm({
      id: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      titleHi: ep.titleHi,
      description: ep.description ?? '',
      descriptionHi: ep.descriptionHi ?? '',
      durationSec: ep.durationSec,
      priceCoins: ep.priceCoins ?? 0,
      isEnding: Boolean(ep.isEnding),
      audioRef: ep.audioRef ?? ep.mediaRef,
      videoMediaRef: ep.videoMediaRef ?? null,
      hasChoicePoint: Boolean(cp),
      choiceTriggerAtEnd: cp ? Boolean(cp.triggerAtEnd ?? !cp.triggerAtSec) : true,
      choiceTriggerAtSec: cp?.triggerAtSec ?? 25,
      choicePromptEn: cp?.promptEn ?? '',
      choicePromptHi: cp?.promptHi ?? '',
      choiceOptions:
        cp && cp.options.length >= 2
          ? cp.options.map((o) => ({ ...o }))
          : [
              { id: `opt-${Date.now()}-1`, labelEn: '', labelHi: '', nextEpisodeId: '' },
              { id: `opt-${Date.now()}-2`, labelEn: '', labelHi: '', nextEpisodeId: '' },
            ],
    });
    setEpisodeModalOpen(true);
  };

  const handleUploadMediaSlot = async (slot: 'audio' | 'video', file: File | undefined) => {
    if (!file || !episodeForm || !selectedStory) return;
    setBanner(null);

    if (slot === 'video') {
      setValidatingVideo(true);
      setVideoValidationError(null);
      try {
        const dims = await readVideoFileDimensions(file);
        const validation = validateSupportedVideoDimensions(dims.width, dims.height);
        if (!validation.valid) {
          setVideoValidationError({
            kind: validation.reason === 'wrong_aspect_ratio' ? 'wrong_aspect_ratio' : 'unreadable_metadata',
            message:
              validation.reason === 'wrong_aspect_ratio'
                ? formatPortraitRejectionMessage(
                    t('studio.videoAspectRatioError'),
                    validation.width,
                    validation.height
                  )
                : t('studio.videoMetadataUnreadableError'),
            file: validation.reason === 'invalid_metadata' ? file : undefined,
          });
          // Previous videoMediaRef and all unsaved form text remain untouched
          return;
        }

        setValidatingVideo(false);
        setUploadingSlot('video');
        const demoProvider = getMediaProvider('demo');
        const uploadedRef = await demoProvider.upload(file, {
          storyId: selectedStory.id,
          episodeId: episodeForm.id,
          title: episodeForm.title || file.name,
        });
        setEpisodeForm((prev) => {
          if (!prev) return prev;
          const { nextForm } = applyVideoSelectionToEpisodeForm(prev, validation, {
            ...uploadedRef,
            type: 'video',
          });
          return nextForm;
        });
        setVideoDetectedDimensions({
          width: validation.width,
          height: validation.height,
          format: validation.format,
        });
        setStudioPreviewAspect(validation.format);
      } catch {
        setVideoValidationError({
          kind: 'unreadable_metadata',
          message: t('studio.videoMetadataUnreadableError'),
          file,
        });
      } finally {
        setValidatingVideo(false);
        setUploadingSlot(null);
        if (videoInputRef.current) {
          videoInputRef.current.value = '';
        }
      }
      return;
    }

    setUploadingSlot('audio');
    try {
      const demoProvider = getMediaProvider('demo');
      const uploadedRef = await demoProvider.upload(file, {
        storyId: selectedStory.id,
        episodeId: episodeForm.id,
        title: episodeForm.title || file.name,
      });
      setEpisodeForm((prev) => {
        if (!prev) return prev;
        return { ...prev, audioRef: { ...uploadedRef, type: 'audio' } };
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'MediaProvider upload failed.'),
      });
    } finally {
      setUploadingSlot(null);
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }
    }
  };

  const handleOpenFullStudioPreview = () => {
    if (!selectedStory || !episodeForm?.videoMediaRef) return;
    const previewEpisode: Episode = {
      id: episodeForm.id ?? `studio-preview-${Date.now()}`,
      storyId: selectedStory.id,
      creatorOwnerUid: selectedStory.creatorOwnerUid,
      episodeNumber: episodeForm.episodeNumber,
      title: episodeForm.title.trim() || `Episode ${episodeForm.episodeNumber}`,
      titleHi: episodeForm.titleHi.trim() || episodeForm.title.trim() || `Episode ${episodeForm.episodeNumber}`,
      description: episodeForm.description,
      descriptionHi: episodeForm.descriptionHi,
      durationSec: episodeForm.durationSec,
      priceCoins: 0,
      mediaRef: episodeForm.audioRef,
      audioRef: episodeForm.audioRef,
      videoMediaRef: episodeForm.videoMediaRef,
      publishedAt: new Date().toISOString(),
    };
    void playEpisode(selectedStory, previewEpisode, 0, undefined, 'video');
  };

  const handleSaveEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedStory || !episodeForm) return;
    if (episodeForm.title.trim().length < 2) {
      setBanner({ type: 'error', text: 'Episode title is required.' });
      return;
    }

    let choicePointPayload: EpisodeChoicePoint | null = null;
    if (episodeForm.hasChoicePoint) {
      choicePointPayload = {
        id: `cp-${episodeForm.id ?? Date.now()}`,
        triggerAtEnd: episodeForm.choiceTriggerAtEnd,
        triggerAtSec: episodeForm.choiceTriggerAtEnd ? undefined : episodeForm.choiceTriggerAtSec,
        promptEn: episodeForm.choicePromptEn.trim(),
        promptHi: episodeForm.choicePromptHi.trim() || episodeForm.choicePromptEn.trim(),
        options: episodeForm.choiceOptions.map((opt) => ({
          ...opt,
          labelEn: opt.labelEn.trim(),
          labelHi: opt.labelHi.trim() || opt.labelEn.trim(),
        })),
      };
      const validIds = new Set(selectedStoryEpisodes.map((ep) => ep.id));
      const validationErr = validateChoicePoint(choicePointPayload, validIds, episodeForm.id);
      if (validationErr) {
        setBanner({ type: 'error', text: validationErr });
        return;
      }
    }

    setBusy(true);
    setBanner(null);
    try {
      const otherEpisodes = selectedStoryEpisodes.filter((ep) => ep.id !== episodeForm.id);
      const totalAfter = otherEpisodes.length + 1;
      const anyVideo = Boolean(episodeForm.videoMediaRef) || otherEpisodes.some((ep) => Boolean(ep.videoMediaRef));
      const anyChoice = Boolean(choicePointPayload) || otherEpisodes.some((ep) => Boolean(ep.choicePoint));

      await saveCreatorEpisodeToFirestore(
        {
          id: episodeForm.id,
          storyId: selectedStory.id,
          episodeNumber: episodeForm.episodeNumber,
          title: episodeForm.title,
          titleHi: episodeForm.titleHi,
          description: episodeForm.description,
          descriptionHi: episodeForm.descriptionHi,
          durationSec: episodeForm.durationSec,
          priceCoins: episodeForm.priceCoins,
          isEnding: episodeForm.isEnding,
          audioRef: episodeForm.audioRef,
          videoMediaRef: episodeForm.videoMediaRef,
          choicePoint: choicePointPayload,
        },
        selectedStory.creatorOwnerUid || profile.uid,
        totalAfter,
        anyVideo,
        anyChoice,
        profile.role
      );

      setEpisodeModalOpen(false);
      await refreshCatalog();
      await loadStudioData();
      setBanner({
        type: 'success',
        text: `Saved Episode ${episodeForm.episodeNumber} ("${episodeForm.title}").`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to save episode.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReorderEpisode = async (episodeId: string, direction: 'up' | 'down') => {
    const reordered = reorderEpisodeList(selectedStoryEpisodes, episodeId, direction);
    setBusy(true);
    setBanner(null);
    try {
      await persistReorderedEpisodesToFirestore(reordered);
      await refreshCatalog();
      setBanner({ type: 'success', text: 'Episode order updated in Firestore.' });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to reorder episodes.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEpisode = async (ep: Episode) => {
    if (!selectedStory) return;
    setBusy(true);
    setBanner(null);
    try {
      const remaining = selectedStoryEpisodes
        .filter((e) => e.id !== ep.id)
        .map((e, i) => ({ ...e, episodeNumber: i + 1 }));
      await deleteCreatorEpisodeFromFirestore(selectedStory.id, ep.id, remaining);
      await refreshCatalog();
      await loadStudioData();
      setBanner({ type: 'success', text: `Deleted Episode ${ep.episodeNumber}.` });
    } catch (err) {
      setBanner({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to delete episode.'),
      });
    } finally {
      setBusy(false);
    }
  };

  const maxEpisodePlays = useMemo(() => {
    if (!storyAnalytics || storyAnalytics.episodes.length === 0) return 1;
    return Math.max(1, ...storyAnalytics.episodes.map((e) => e.plays));
  }, [storyAnalytics]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Studio Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#E5A93C] tracking-wide">
            {myCreatorProfile.name} · {myCreatorProfile.handle}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
            {t('studio.title')}
          </h1>
          <p className="text-sm text-[#A39E93] max-w-2xl leading-relaxed">{t('studio.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadStudioData()}
            disabled={loadingStudio}
            className="min-h-[44px] px-4 rounded-xl bg-[#141418] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-white/30 inline-flex items-center gap-2 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStudio ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            data-testid="studio-new-story-btn"
            onClick={openCreateStory}
            className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {t('studio.newStoryBtn')}
          </button>
        </div>
      </header>

      {/* Feedback Banner */}
      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-xs border flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-[#141418] border-[#E5A93C]/45 text-[#F3C669]'
              : 'bg-rose-950/40 border-rose-500/35 text-rose-200'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            {banner.text}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setBanner(null)}
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 KPI Stat Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('studio.statStories')}</span>
            <BookOpen className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">{stats.totalStories}</p>
          <p className="text-[11px] text-[#8A857B]">
            {stats.publishedStories} {t('common.published')} · {stats.draftStories} {t('common.draft')}
          </p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('studio.statEpisodes')}</span>
            <Layers className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">{stats.totalEpisodes}</p>
          <p className="text-[11px] text-[#8A857B]">MediaProvider managed</p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('studio.statPlays')}</span>
            <BarChart3 className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
            {formatPlayCount(stats.totalPlays)}
          </p>
          <p className="text-[11px] text-[#8A857B]">Catalog plays</p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('studio.statFollowers')}</span>
            <Users className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
            {formatPlayCount(stats.followers)}
          </p>
          <p className="text-[11px] text-[#8A857B]">{myCreatorProfile.handle}</p>
        </div>
      </section>

      {/* Studio Workspace Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.08] overflow-x-auto">
        {(
          [
            { id: 'stories', label: t('studio.tabStories'), icon: BookOpen },
            { id: 'episodes', label: t('studio.tabEpisodes'), icon: Layers },
            { id: 'analytics', label: t('studio.tabAnalytics'), icon: BarChart3 },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                active
                  ? 'border-[#E5A93C] text-[#F5F3EE]'
                  : 'border-transparent text-[#A39E93] hover:text-[#F5F3EE]'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: STORIES */}
      {activeTab === 'stories' && (
        <section className="space-y-4">
          {ownStories.length === 0 ? (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center space-y-3">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
                {t('studio.noStoriesTitle')}
              </h2>
              <p className="text-sm text-[#A39E93] max-w-md mx-auto">{t('studio.noStoriesBody')}</p>
              <button
                type="button"
                onClick={openCreateStory}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('studio.newStoryBtn')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {ownStories.map((story) => {
                const epsCount = catalogEpisodes.filter((e) => e.storyId === story.id).length;
                const genre = categories.find((c) => c.id === story.genreId);
                return (
                  <div
                    key={story.id}
                    className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                        <span
                          className={
                            story.visibility === 'published'
                              ? 'text-emerald-400 font-medium'
                              : story.visibility === 'draft'
                                ? 'text-[#E5A93C] font-medium'
                                : 'text-[#8A857B] font-medium'
                          }
                        >
                          {story.visibility === 'published'
                            ? t('common.published')
                            : story.visibility === 'draft'
                              ? t('common.draft')
                              : t('common.archived')}
                        </span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93]">
                          {genre ? (lang === 'hi' ? genre.nameHi : genre.nameEn) : story.genreId}
                        </span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93] uppercase">{story.language}</span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93] tabular-nums">
                          {epsCount} {t('common.episodes')}
                        </span>
                        {story.isInteractive && (
                          <>
                            <span className="text-[#55524B]">·</span>
                            <span className="text-[#F3C669]">{t('story.interactiveChoice')}</span>
                          </>
                        )}
                      </div>

                      <h3 className="font-display text-lg font-semibold text-[#F5F3EE] truncate">
                        {lang === 'hi' ? story.titleHi : story.title}
                      </h3>
                      <p className="text-xs text-[#A39E93] line-clamp-2 max-w-2xl">
                        {lang === 'hi' ? story.synopsisHi : story.synopsis}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStoryId(story.id);
                          setActiveTab('episodes');
                        }}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#1C1C22] border border-white/10 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 transition-colors"
                      >
                        {t('studio.tabEpisodes')}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditStory(story)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#0B0B0E] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-white/30 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('common.edit')}
                      </button>
                      <Link
                        to={`/story/${story.id}`}
                        className="min-h-[40px] px-3 rounded-xl border border-white/10 text-xs text-[#A39E93] hover:text-[#F5F3EE] inline-flex items-center gap-1"
                        aria-label={`View ${story.title}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteStoryTarget(story)}
                        className="min-h-[40px] px-3 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 text-xs inline-flex items-center gap-1 transition-colors"
                        aria-label={`${t('common.delete')} ${story.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: EPISODES & INTERACTIVE CHOICES */}
      {activeTab === 'episodes' && (
        <section className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 rounded-2xl bg-[#141418] border border-white/[0.08] p-5">
            <div className="space-y-1.5 flex-1 max-w-md">
              <label htmlFor="studio-story-select" className="text-xs font-medium text-[#A39E93] block">
                {t('studio.selectStoryPrompt')}
              </label>
              <select
                id="studio-story-select"
                value={selectedStory?.id ?? ''}
                onChange={(e) => setSelectedStoryId(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
              >
                {ownStories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {lang === 'hi' ? s.titleHi : s.title} ({s.visibility})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-testid="studio-import-drive-btn"
                disabled={!selectedStory}
                onClick={() => setDriveImportOpen(true)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] border border-[#E5A93C]/40 text-[#F3C669] text-xs font-semibold hover:border-[#E5A93C] disabled:opacity-40 inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <FolderInput className="w-4 h-4" aria-hidden="true" />
                {t('studio.importDriveFolderBtn')}
              </button>
              <button
                type="button"
                disabled={!selectedStory}
                onClick={openCreateEpisode}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-40 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('studio.newEpisodeBtn')}
              </button>
            </div>
          </div>

          {selectedStory && selectedStoryEpisodes.length === 0 && (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-8 text-center text-sm text-[#A39E93]">
              No episodes yet for &ldquo;{selectedStory.title}&rdquo;. Add Episode 1 to attach audio, video, and interactive branches.
            </div>
          )}

          {selectedStory && selectedStoryEpisodes.length > 0 && (
            <div className="space-y-2.5">
              {selectedStoryEpisodes.map((ep, idx) => (
                <div
                  key={ep.id}
                  className="rounded-2xl bg-[#141418] border border-white/[0.08] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs tabular-nums">
                      <span className="font-semibold text-[#E5A93C]">
                        {t('common.episode')} {ep.episodeNumber}
                      </span>
                      <span className="text-[#55524B]">·</span>
                      <span className="text-[#A39E93]">{ep.durationSec}s</span>
                      <span className="text-[#55524B]">·</span>
                      <span className="text-[#F3C669] inline-flex items-center gap-1 tabular-nums">
                        <Coins className="w-3 h-3 text-[#E5A93C]" aria-hidden="true" />
                        {ep.priceCoins === 0 ? t('common.free') : `${ep.priceCoins} ${t('coins.unit')}`}
                      </span>
                      <span className="text-[#55524B]">·</span>
                      <span className="inline-flex items-center gap-1 text-[#A39E93]">
                        <Mic className="w-3 h-3 text-[#E5A93C]" aria-hidden="true" />
                        {(ep.audioRef ?? ep.mediaRef).provider}:{(ep.audioRef ?? ep.mediaRef).id.slice(0, 22)}
                      </span>
                      {ep.videoMediaRef && (
                        <>
                          <span className="text-[#55524B]">·</span>
                          <span className="inline-flex items-center gap-1 text-[#F3C669]">
                            <Film className="w-3 h-3" aria-hidden="true" />
                            Video
                          </span>
                        </>
                      )}
                      {ep.choicePoint && (
                        <>
                          <span className="text-[#55524B]">·</span>
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <GitBranch className="w-3 h-3" aria-hidden="true" />
                            {ep.choicePoint.options.length} branches
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="font-medium text-sm sm:text-base text-[#F5F3EE] truncate">
                      {lang === 'hi' ? ep.titleHi : ep.title}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busy || idx === 0}
                      onClick={() => void handleReorderEpisode(ep.id, 'up')}
                      aria-label={t('studio.moveUp')}
                      title={t('studio.moveUp')}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] disabled:opacity-30 inline-flex items-center justify-center"
                    >
                      <ArrowUp className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === selectedStoryEpisodes.length - 1}
                      onClick={() => void handleReorderEpisode(ep.id, 'down')}
                      aria-label={t('studio.moveDown')}
                      title={t('studio.moveDown')}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] disabled:opacity-30 inline-flex items-center justify-center"
                    >
                      <ArrowDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                    {ep.videoMediaRef && (
                      <button
                        type="button"
                        data-testid={`studio-preview-ep-${ep.episodeNumber}`}
                        onClick={() => void playEpisode(selectedStory, ep, 0, undefined, 'video')}
                        className="min-h-[40px] px-3 rounded-xl bg-[#E5A93C]/15 border border-[#E5A93C]/40 text-xs font-medium text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] inline-flex items-center gap-1.5 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                        {t('studio.videoPreviewBtn')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditEpisode(ep)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-[#1C1C22] border border-white/10 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDeleteEpisode(ep)}
                      aria-label={`${t('common.delete')} ${ep.title}`}
                      className="min-h-[40px] px-3 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 inline-flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: PER-STORY ANALYTICS */}
      {activeTab === 'analytics' && (
        <section className="space-y-6">
          <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
                {t('studio.analyticsHeading')}
              </h2>
              <p className="text-xs text-[#A39E93]">{t('studio.analyticsSub')}</p>
            </div>
            <select
              aria-label={t('studio.selectStoryPrompt')}
              value={selectedStory?.id ?? ''}
              onChange={(e) => setSelectedStoryId(e.target.value)}
              className="h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C] sm:w-72"
            >
              {ownStories.map((s) => (
                <option key={s.id} value={s.id}>
                  {lang === 'hi' ? s.titleHi : s.title}
                </option>
              ))}
            </select>
          </div>

          {storyAnalytics && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 tabular-nums">
                <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-1">
                  <p className="text-xs text-[#A39E93]">{t('studio.trackedPlays')}</p>
                  <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
                    {storyAnalytics.totalTrackedPlays}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-1">
                  <p className="text-xs text-[#A39E93]">{t('studio.completions')}</p>
                  <p className="font-display text-3xl font-semibold text-[#F3C669]">
                    {storyAnalytics.totalCompletions}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-1">
                  <p className="text-xs text-[#A39E93]">{t('studio.completionRate')}</p>
                  <p className="font-display text-3xl font-semibold text-emerald-400">
                    {storyAnalytics.completionRatePct}%
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#F5F3EE]">
                    {t('studio.episodeChartHeading')}
                  </h3>
                  <div className="flex items-center gap-4 text-[11px] text-[#A39E93]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-[#E5A93C]" />
                      {t('studio.trackedPlays')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
                      {t('studio.completions')}
                    </span>
                  </div>
                </div>

                {storyAnalytics.totalTrackedPlays === 0 ? (
                  <p className="text-xs text-[#A39E93] py-6">{t('studio.noAnalyticsYet')}</p>
                ) : (
                  <div className="space-y-3 tabular-nums">
                    {storyAnalytics.episodes.map((row) => {
                      const playsPct = Math.round((row.plays / maxEpisodePlays) * 100);
                      const compPct = Math.round((row.completions / maxEpisodePlays) * 100);
                      return (
                        <div key={row.episodeId} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs gap-3">
                            <span className="text-[#F5F3EE] truncate">
                              Ep {row.episodeNumber}: {lang === 'hi' ? row.titleHi : row.title}
                            </span>
                            <span className="text-[#A39E93] whitespace-nowrap shrink-0">
                              {row.plays} plays · {row.completionRatePct}% completed
                            </span>
                          </div>
                          <svg
                            viewBox="0 0 100 6"
                            preserveAspectRatio="none"
                            className="w-full h-3 rounded-full overflow-hidden bg-[#0B0B0E]"
                            role="img"
                            aria-label={`Episode ${row.episodeNumber}: ${row.plays} plays, ${row.completions} completions`}
                          >
                            <rect x="0" y="0" width={playsPct} height="6" fill="#E5A93C" opacity="0.45" />
                            <rect x="0" y="0" width={compPct} height="6" fill="#34D399" />
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* Ownership Security Notice */}
      <footer className="rounded-xl bg-[#141418] border border-white/[0.08] px-4 py-3 text-xs text-[#A39E93] flex items-center gap-2.5">
        <ShieldCheck className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
        <span>{t('studio.ownershipNotice')}</span>
      </footer>

      {/* CREATE / EDIT STORY MODAL */}
      {storyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={storyForm.id ? t('studio.editStoryHeading') : t('studio.createStoryHeading')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleSaveStory}
            className="w-full max-w-2xl rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold text-[#F5F3EE]">
                {storyForm.id ? t('studio.editStoryHeading') : t('studio.createStoryHeading')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setStoryModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyTitleEn')}</label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={storyForm.title}
                  onChange={(e) => setStoryForm({ ...storyForm, title: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyTitleHi')}</label>
                <input
                  type="text"
                  maxLength={140}
                  value={storyForm.titleHi}
                  onChange={(e) => setStoryForm({ ...storyForm, titleHi: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storySynopsisEn')}</label>
                <textarea
                  rows={3}
                  required
                  maxLength={1200}
                  value={storyForm.synopsis}
                  onChange={(e) => setStoryForm({ ...storyForm, synopsis: e.target.value })}
                  className="w-full p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storySynopsisHi')}</label>
                <textarea
                  rows={3}
                  maxLength={1200}
                  value={storyForm.synopsisHi}
                  onChange={(e) => setStoryForm({ ...storyForm, synopsisHi: e.target.value })}
                  className="w-full p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyGenre')}</label>
                <select
                  value={storyForm.genreId}
                  onChange={(e) => setStoryForm({ ...storyForm, genreId: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {lang === 'hi' ? cat.nameHi : cat.nameEn}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyLanguage')}</label>
                <select
                  value={storyForm.language}
                  onChange={(e) =>
                    setStoryForm({ ...storyForm, language: e.target.value as ContentLanguage })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  <option value="bilingual">{t('common.bilingual')}</option>
                  <option value="hi">{t('common.hindi')}</option>
                  <option value="en">{t('common.english')}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyStatus')}</label>
                <select
                  value={storyForm.visibility}
                  onChange={(e) =>
                    setStoryForm({ ...storyForm, visibility: e.target.value as StoryVisibility })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  <option value="draft">{t('common.draft')}</option>
                  <option value="published">{t('common.published')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyCoverTheme')}</label>
                <select
                  value={storyForm.coverTheme}
                  onChange={(e) =>
                    setStoryForm({ ...storyForm, coverTheme: e.target.value as CoverTheme })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  {COVER_THEMES.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyFormat')}</label>
                <select
                  value={storyForm.format}
                  onChange={(e) =>
                    setStoryForm({ ...storyForm, format: e.target.value as StoryFormat })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  <option value="audio">Audio</option>
                  <option value="hybrid">Audio & Video</option>
                  <option value="video">Video</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.storyCoverUrl')}</label>
                <input
                  type="url"
                  maxLength={300}
                  placeholder="https://..."
                  value={storyForm.coverUrl}
                  onChange={(e) => setStoryForm({ ...storyForm, coverUrl: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-[#D6D2C9] cursor-pointer">
              <input
                type="checkbox"
                checked={storyForm.isInteractive}
                onChange={(e) => setStoryForm({ ...storyForm, isInteractive: e.target.checked })}
                className="w-4 h-4 accent-[#E5A93C]"
              />
              {t('studio.storyInteractive')}
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStoryModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50"
              >
                {t('studio.saveStoryBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE / EDIT EPISODE & INTERACTIVE CHOICE MODAL */}
      {episodeModalOpen && episodeForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={episodeForm.id ? t('studio.editEpisodeHeading') : t('studio.createEpisodeHeading')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <form
            onSubmit={handleSaveEpisode}
            className="w-full max-w-2xl rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold text-[#F5F3EE]">
                {episodeForm.id ? t('studio.editEpisodeHeading') : t('studio.createEpisodeHeading')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setEpisodeModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epNumber')}</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={episodeForm.episodeNumber}
                  onChange={(e) =>
                    setEpisodeForm({ ...episodeForm, episodeNumber: Number(e.target.value) || 1 })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epDuration')}</label>
                <input
                  type="number"
                  min={10}
                  max={86400}
                  required
                  value={episodeForm.durationSec}
                  onChange={(e) =>
                    setEpisodeForm({ ...episodeForm, durationSec: Number(e.target.value) || 60 })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="studio-ep-price-coins"
                  className="text-xs text-[#A39E93] flex items-center gap-1.5"
                >
                  <span>{t('studio.priceCoinsLabel')}</span>
                  {Boolean(episodeForm.id) && profile?.role !== 'admin' && (
                    <Lock className="w-3 h-3 text-[#E5A93C]" aria-hidden="true" />
                  )}
                </label>
                <input
                  id="studio-ep-price-coins"
                  data-testid="studio-ep-price-input"
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  disabled={Boolean(episodeForm.id) && profile?.role !== 'admin'}
                  value={episodeForm.priceCoins}
                  onChange={(e) => {
                    const parsed = Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0)));
                    setEpisodeForm({
                      ...episodeForm,
                      priceCoins: parsed,
                    });
                  }}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <p className="text-[11px] text-[#8A857B]">
                  {Boolean(episodeForm.id) && profile?.role !== 'admin'
                    ? t('studio.priceLockedHint')
                    : t('studio.priceSetOnceHint')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epTitleEn')}</label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={episodeForm.title}
                  onChange={(e) => setEpisodeForm({ ...episodeForm, title: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epTitleHi')}</label>
                <input
                  type="text"
                  maxLength={160}
                  value={episodeForm.titleHi}
                  onChange={(e) => setEpisodeForm({ ...episodeForm, titleHi: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epDescEn')}</label>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={episodeForm.description}
                  onChange={(e) => setEpisodeForm({ ...episodeForm, description: e.target.value })}
                  className="w-full p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[#A39E93] block">{t('studio.epDescHi')}</label>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={episodeForm.descriptionHi}
                  onChange={(e) => setEpisodeForm({ ...episodeForm, descriptionHi: e.target.value })}
                  className="w-full p-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            {/* MediaProvider Upload Slots */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#F5F3EE]">{t('studio.audioSlotLabel')}</p>
                <p className="text-[11px] text-[#8A857B] truncate">
                  {t('studio.attachedRefLabel')}: {episodeForm.audioRef.provider}:{episodeForm.audioRef.id}
                </p>
                <label className="min-h-[40px] px-3.5 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-2 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                  {uploadingSlot === 'audio' ? 'Uploading...' : t('studio.uploadAudioBtn')}
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    disabled={uploadingSlot === 'audio'}
                    className="sr-only"
                    onChange={(e) => void handleUploadMediaSlot('audio', e.target.files?.[0])}
                  />
                </label>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-[#F5F3EE]">{t('studio.videoSlotLabel')}</p>
                <p
                  data-testid="studio-video-instruction"
                  className="text-[11px] text-[#D6D2C9] leading-relaxed"
                >
                  {t('studio.videoPortraitInstruction')}
                </p>
                <p
                  data-testid="studio-attached-video-ref"
                  className="text-[11px] text-[#8A857B] truncate"
                >
                  {episodeForm.videoMediaRef
                    ? `${episodeForm.videoMediaRef.provider}:${episodeForm.videoMediaRef.id}`
                    : 'None attached'}
                  {videoDetectedDimensions && (
                    <span className="ml-1.5 text-emerald-400 font-mono-tabular">
                      · {formatVideoDimensions(videoDetectedDimensions.width, videoDetectedDimensions.height)} ({videoDetectedDimensions.format})
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="min-h-[44px] px-3.5 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-2 cursor-pointer">
                    {validatingVideo || uploadingSlot === 'video' ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#E5A93C] animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                    )}
                    {validatingVideo
                      ? t('studio.videoValidating')
                      : uploadingSlot === 'video'
                        ? 'Uploading...'
                        : t('studio.uploadVideoBtn')}
                    <input
                      ref={videoInputRef}
                      data-testid="studio-video-file-input"
                      type="file"
                      accept="video/*"
                      disabled={validatingVideo || uploadingSlot === 'video'}
                      className="sr-only"
                      onChange={(e) => void handleUploadMediaSlot('video', e.target.files?.[0])}
                    />
                  </label>
                  {episodeForm.videoMediaRef && (
                    <button
                      type="button"
                      onClick={() => {
                        setEpisodeForm({ ...episodeForm, videoMediaRef: null });
                        setVideoDetectedDimensions(null);
                        setVideoValidationError(null);
                      }}
                      className="min-h-[44px] px-3 rounded-lg border border-white/10 text-xs text-[#A39E93] hover:text-rose-300"
                    >
                      {t('studio.clearVideoBtn')}
                    </button>
                  )}
                </div>

                {videoValidationError && (
                  <div
                    role="alert"
                    data-testid="studio-video-validation-error"
                    className="rounded-xl bg-rose-950/50 border border-rose-500/35 p-3 space-y-2 text-xs text-rose-200"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
                      <p className="leading-relaxed">{videoValidationError.message}</p>
                    </div>
                    {videoValidationError.kind === 'unreadable_metadata' && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {videoValidationError.file && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleUploadMediaSlot('video', videoValidationError.file)
                            }
                            className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50"
                          >
                            {t('studio.videoRetryCheck')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => videoInputRef.current?.click()}
                          className="min-h-[36px] px-3 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669]"
                        >
                          {t('studio.videoChooseAnother')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Shared Adaptive Studio Video Preview (9:16 or 16:9 matching uploaded format) */}
              {episodeForm.videoMediaRef && (
                <div className="sm:col-span-2 pt-3 border-t border-white/[0.08] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-[#F3C669]">
                      {t('studio.videoPreviewHeading')} · {studioPreviewAspect}
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenFullStudioPreview}
                      className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-1.5"
                    >
                      <Film className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                      {t('studio.videoFullPreviewBtn')}
                    </button>
                  </div>
                  <PortraitVideoFrame
                    aspect={studioPreviewAspect}
                    frameTestId="studio-portrait-video-preview"
                    maxHeightCss={studioPreviewAspect === '16:9' ? '260px' : '320px'}
                    maxWidthCss={studioPreviewAspect === '16:9' ? '460px' : '180px'}
                  >
                    {studioPreviewLoading ? (
                      <div className="w-full h-full flex items-center justify-center bg-black">
                        <Loader2 className="w-6 h-6 text-[#E5A93C] animate-spin" aria-hidden="true" />
                      </div>
                    ) : studioPreviewUrl ? (
                      <video
                        key={studioPreviewUrl}
                        src={studioPreviewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget;
                          if (v.videoWidth > 0 && v.videoHeight > 0) {
                            setStudioPreviewAspect(
                              detectVideoAspectFormat(v.videoWidth, v.videoHeight)
                            );
                          }
                        }}
                        className="w-full h-full object-contain bg-black"
                        aria-label={t('studio.videoPreviewHeading')}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-black p-3 text-center text-[11px] text-[#A39E93]">
                        {t('video.errorTitle')}
                      </div>
                    )}
                  </PortraitVideoFrame>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2.5 text-xs text-[#D6D2C9] cursor-pointer">
              <input
                type="checkbox"
                checked={episodeForm.isEnding}
                onChange={(e) => setEpisodeForm({ ...episodeForm, isEnding: e.target.checked })}
                className="w-4 h-4 accent-[#E5A93C]"
              />
              {t('studio.epIsEnding')}
            </label>

            {/* Interactive Choice Point Editor */}
            <div className="rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                  {t('studio.choiceEditorHeading')}
                </h3>
                <label className="flex items-center gap-2 text-xs text-[#D6D2C9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={episodeForm.hasChoicePoint}
                    onChange={(e) =>
                      setEpisodeForm({ ...episodeForm, hasChoicePoint: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#E5A93C]"
                  />
                  {t('studio.enableChoiceToggle')}
                </label>
              </div>

              {episodeForm.hasChoicePoint && (
                <div className="space-y-4 pt-2 border-t border-white/[0.08]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-[#A39E93] block">
                        {t('studio.choiceTriggerMode')}
                      </label>
                      <select
                        value={episodeForm.choiceTriggerAtEnd ? 'end' : 'timestamp'}
                        onChange={(e) =>
                          setEpisodeForm({
                            ...episodeForm,
                            choiceTriggerAtEnd: e.target.value === 'end',
                          })
                        }
                        className="w-full h-10 px-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#F5F3EE]"
                      >
                        <option value="end">{t('studio.triggerAtEnd')}</option>
                        <option value="timestamp">{t('studio.triggerAtTimestamp')}</option>
                      </select>
                    </div>
                    {!episodeForm.choiceTriggerAtEnd && (
                      <div className="space-y-1">
                        <label className="text-xs text-[#A39E93] block">
                          {t('studio.triggerAtTimestamp')}
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={episodeForm.durationSec}
                          value={episodeForm.choiceTriggerAtSec}
                          onChange={(e) =>
                            setEpisodeForm({
                              ...episodeForm,
                              choiceTriggerAtSec: Number(e.target.value) || 15,
                            })
                          }
                          className="w-full h-10 px-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] tabular-nums"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder={t('studio.choicePromptEn')}
                      value={episodeForm.choicePromptEn}
                      onChange={(e) =>
                        setEpisodeForm({ ...episodeForm, choicePromptEn: e.target.value })
                      }
                      className="w-full h-10 px-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#F5F3EE]"
                    />
                    <input
                      type="text"
                      placeholder={t('studio.choicePromptHi')}
                      value={episodeForm.choicePromptHi}
                      onChange={(e) =>
                        setEpisodeForm({ ...episodeForm, choicePromptHi: e.target.value })
                      }
                      className="w-full h-10 px-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#F5F3EE]"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-[#A39E93]">
                        {t('studio.choiceOptionsHeading')}
                      </p>
                      {episodeForm.choiceOptions.length < 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEpisodeForm({
                              ...episodeForm,
                              choiceOptions: [
                                ...episodeForm.choiceOptions,
                                {
                                  id: `opt-${Date.now()}`,
                                  labelEn: '',
                                  labelHi: '',
                                  nextEpisodeId: '',
                                },
                              ],
                            })
                          }
                          className="text-xs text-[#E5A93C] hover:text-[#F3C669] font-medium"
                        >
                          + {t('studio.addOptionBtn')}
                        </button>
                      )}
                    </div>

                    {episodeForm.choiceOptions.map((opt, idx) => (
                      <div
                        key={opt.id}
                        className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg bg-[#141418] border border-white/[0.06] p-3"
                      >
                        <input
                          type="text"
                          placeholder={`${t('studio.optionLabelEn')} #${idx + 1}`}
                          value={opt.labelEn}
                          onChange={(e) => {
                            const next = [...episodeForm.choiceOptions];
                            next[idx] = { ...opt, labelEn: e.target.value };
                            setEpisodeForm({ ...episodeForm, choiceOptions: next });
                          }}
                          className="h-9 px-2.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#F5F3EE]"
                        />
                        <input
                          type="text"
                          placeholder={`${t('studio.optionLabelHi')} #${idx + 1}`}
                          value={opt.labelHi}
                          onChange={(e) => {
                            const next = [...episodeForm.choiceOptions];
                            next[idx] = { ...opt, labelHi: e.target.value };
                            setEpisodeForm({ ...episodeForm, choiceOptions: next });
                          }}
                          className="h-9 px-2.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#F5F3EE]"
                        />
                        <div className="flex items-center gap-1.5">
                          <select
                            value={opt.nextEpisodeId}
                            onChange={(e) => {
                              const next = [...episodeForm.choiceOptions];
                              next[idx] = { ...opt, nextEpisodeId: e.target.value };
                              setEpisodeForm({ ...episodeForm, choiceOptions: next });
                            }}
                            className="flex-1 h-9 px-2 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#F5F3EE]"
                          >
                            <option value="">{t('studio.optionTargetEp')}...</option>
                            {selectedStoryEpisodes
                              .filter((candidate) => candidate.id !== episodeForm.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  Ep {candidate.episodeNumber}: {candidate.title}
                                </option>
                              ))}
                          </select>
                          {episodeForm.choiceOptions.length > 2 && (
                            <button
                              type="button"
                              aria-label="Remove option"
                              onClick={() =>
                                setEpisodeForm({
                                  ...episodeForm,
                                  choiceOptions: episodeForm.choiceOptions.filter((_, i) => i !== idx),
                                })
                              }
                              className="w-8 h-9 rounded-lg border border-white/10 text-[#A39E93] hover:text-rose-300 flex items-center justify-center shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEpisodeModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50"
              >
                {t('studio.saveEpisodeBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DELETE STORY CONFIRMATION MODAL */}
      {deleteStoryTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('studio.deleteStoryBtn')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
              {t('studio.deleteStoryBtn')}
            </h2>
            <p className="text-sm text-[#A39E93] leading-relaxed">
              {t('studio.deleteStoryConfirm')} &ldquo;{deleteStoryTarget.title}&rdquo;
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteStoryTarget(null)}
                className="min-h-[40px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteStory()}
                className="min-h-[40px] px-4 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 disabled:opacity-50"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE DRIVE / DIRECT BATCH EPISODE IMPORT MODAL */}
      <DriveFolderImportModal
        open={driveImportOpen}
        story={selectedStory}
        existingEpisodes={selectedStoryEpisodes}
        actorUid={profile?.uid}
        onClose={() => setDriveImportOpen(false)}
        onImportComplete={async (res) => {
          await refreshCatalog();
          await loadStudioData();
          setBanner({
            type: 'success',
            text: `Imported ${res.created.length} episode(s) (${res.skipped.length} skipped, ${res.invalid.length} invalid).`,
          });
        }}
      />
    </div>
  );
};

