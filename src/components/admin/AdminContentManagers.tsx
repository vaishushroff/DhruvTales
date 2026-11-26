import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { Save, X } from 'lucide-react';
import type {
  Category,
  ContentLanguage,
  CoverTheme,
  Creator,
  Episode,
  Story,
  StoryFormat,
  StoryVisibility,
  UserProfile,
} from '../../types';
import {
  adminSaveCreatorCms,
  adminSaveEpisodeCms,
  adminSaveStoryCms,
  adminUpdateUserDisplayName,
} from '../../services/firebase/adminCmsService';

const COVER_THEMES: CoverTheme[] = [
  'mythology-gold',
  'horror-amber',
  'thriller-noir',
  'romance-mist',
  'crime-deco',
  'kids-lantern',
  'motivation-dawn',
  'comedy-bazaar',
  'mystery-emerald',
  'folklore-crimson',
  'scifi-indigo',
  'drama-sepia',
];

interface StoryModalProps {
  firebaseUser: User | null;
  actor: UserProfile;
  story: Story | null;
  categories: Category[];
  creators: Creator[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const AdminStoryEditorModal: React.FC<StoryModalProps> = ({
  firebaseUser,
  actor,
  story,
  categories,
  creators,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(story);
  const defaultCreator = creators[0];
  const [title, setTitle] = useState(story?.title ?? '');
  const [titleHi, setTitleHi] = useState(story?.titleHi ?? '');
  const [synopsis, setSynopsis] = useState(story?.synopsis ?? '');
  const [synopsisHi, setSynopsisHi] = useState(story?.synopsisHi ?? '');
  const [genreId, setGenreId] = useState(story?.genreId ?? categories[0]?.id ?? 'mythology');
  const [creatorId, setCreatorId] = useState(story?.creatorId ?? defaultCreator?.id ?? 'creator-admin');
  const [language, setLanguage] = useState<ContentLanguage>(story?.language ?? 'bilingual');
  const [format, setFormat] = useState<StoryFormat>(story?.format ?? 'audio');
  const [visibility, setVisibility] = useState<StoryVisibility>(story?.visibility ?? 'published');
  const [coverTheme, setCoverTheme] = useState<CoverTheme>(story?.coverTheme ?? 'mythology-gold');
  const [coverUrl, setCoverUrl] = useState(story?.coverUrl ?? '');
  const [priceOverride, setPriceOverride] = useState(
    story?.priceOverrideCoins !== null && story?.priceOverrideCoins !== undefined
      ? String(story.priceOverrideCoins)
      : ''
  );
  const [isTrending, setIsTrending] = useState(Boolean(story?.isTrending));
  const [isEditorsPick, setIsEditorsPick] = useState(Boolean(story?.isEditorsPick));
  const [isPopular, setIsPopular] = useState(Boolean(story?.isPopular));
  const [isFeatured, setIsFeatured] = useState(Boolean(story?.isFeatured));
  const [isInteractive, setIsInteractive] = useState(Boolean(story?.isInteractive));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !synopsis.trim()) {
      setError('English title and synopsis are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const selectedCreator = creators.find((c) => c.id === creatorId);
      await adminSaveStoryCms(
        firebaseUser,
        actor,
        {
          id: story?.id,
          title,
          titleHi: titleHi || title,
          synopsis,
          synopsisHi: synopsisHi || synopsis,
          genreId,
          language,
          creatorId,
          creatorName: selectedCreator?.name ?? story?.creatorName ?? 'Dhruv Tales Studio',
          creatorOwnerUid: selectedCreator?.ownerUid ?? story?.creatorOwnerUid ?? actor.uid,
          coverUrl,
          coverTheme,
          visibility,
          format,
          isInteractive,
          isTrending,
          isEditorsPick,
          isPopular,
          isFeatured,
          priceOverrideCoins: priceOverride.trim() === '' ? null : Math.max(0, Math.floor(Number(priceOverride) || 0)),
        },
        isEdit
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save story.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit Story' : 'Create Story'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-2xl rounded-2xl bg-[#141418] border border-white/12 p-6 space-y-4 my-8"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-[#F5F3EE]">
            {isEdit ? `Edit Story: ${story?.title}` : 'Add New Story'}
          </h3>
          <button type="button" onClick={onClose} className="p-2 text-[#A39E93] hover:text-[#F5F3EE]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Title (EN) *</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Title (HI)</span>
            <input
              value={titleHi}
              onChange={(e) => setTitleHi(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Synopsis (EN) *</span>
            <textarea
              required
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Synopsis (HI)</span>
            <textarea
              rows={3}
              value={synopsisHi}
              onChange={(e) => setSynopsisHi(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Genre / Category</span>
            <select
              value={genreId}
              onChange={(e) => setGenreId(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Creator</span>
            <select
              value={creatorId}
              onChange={(e) => setCreatorId(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              {creators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="bilingual">Bilingual</option>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as StoryFormat)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="audio">Audio</option>
              <option value="video">Video</option>
              <option value="hybrid">Hybrid (Audio + Video)</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Visibility</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as StoryVisibility)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Story Price Override (Coins)</span>
            <input
              type="number"
              min={0}
              placeholder="Empty = per-episode"
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Cover Theme</span>
            <select
              value={coverTheme}
              onChange={(e) => setCoverTheme(e.target.value as CoverTheme)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              {COVER_THEMES.map((th) => (
                <option key={th} value={th}>
                  {th}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Cover Image URL (optional)</span>
            <input
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-[#D6D2C9] pt-1">
          {[
            ['Featured', isFeatured, setIsFeatured],
            ["Editor's Pick", isEditorsPick, setIsEditorsPick],
            ['Trending', isTrending, setIsTrending],
            ['Popular', isPopular, setIsPopular],
            ['Interactive', isInteractive, setIsInteractive],
          ].map(([label, val, setter]) => (
            <label key={label as string} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={val as boolean}
                onChange={(e) => (setter as React.Dispatch<React.SetStateAction<boolean>>)(e.target.checked)}
                className="accent-[#E5A93C]"
              />
              <span>{label as string}</span>
            </label>
          ))}
        </div>

        {error && <p className="text-xs text-[#F5C2B4]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl border border-white/15 text-xs text-[#D6D2C9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : isEdit ? 'Save Story' : 'Create Story'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface EpisodeModalProps {
  firebaseUser: User | null;
  actor: UserProfile;
  episode: Episode | null;
  stories: Story[];
  defaultStoryId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const AdminEpisodeEditorModal: React.FC<EpisodeModalProps> = ({
  firebaseUser,
  actor,
  episode,
  stories,
  defaultStoryId,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(episode);
  const [storyId, setStoryId] = useState(episode?.storyId ?? defaultStoryId ?? stories[0]?.id ?? '');
  const [episodeNumber, setEpisodeNumber] = useState(String(episode?.episodeNumber ?? 1));
  const [title, setTitle] = useState(episode?.title ?? '');
  const [titleHi, setTitleHi] = useState(episode?.titleHi ?? '');
  const [description, setDescription] = useState(episode?.description ?? '');
  const [descriptionHi, setDescriptionHi] = useState(episode?.descriptionHi ?? '');
  const [durationSec, setDurationSec] = useState(String(episode?.durationSec ?? 180));
  const [priceCoins, setPriceCoins] = useState(String(episode?.priceCoins ?? 0));
  const [provider, setProvider] = useState<'demo' | 'drive'>(
    episode?.mediaRef?.provider === 'drive' ? 'drive' : 'demo'
  );
  const [mediaId, setMediaId] = useState(episode?.mediaRef?.id ?? '');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>(
    episode?.mediaRef?.type === 'video' ? 'video' : 'audio'
  );
  const [videoDriveId, setVideoDriveId] = useState(
    episode?.videoMediaRef?.provider === 'drive' ? episode.videoMediaRef.id : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyId || !title.trim()) {
      setError('Story and Episode title are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parentStory = stories.find((s) => s.id === storyId);
      await adminSaveEpisodeCms(
        firebaseUser,
        actor,
        {
          id: episode?.id,
          storyId,
          creatorOwnerUid: parentStory?.creatorOwnerUid ?? actor.uid,
          episodeNumber: Math.max(1, Math.floor(Number(episodeNumber) || 1)),
          title,
          titleHi: titleHi || title,
          description,
          descriptionHi: descriptionHi || description,
          durationSec: Math.max(10, Math.floor(Number(durationSec) || 180)),
          priceCoins: Math.max(0, Math.floor(Number(priceCoins) || 0)),
          provider,
          mediaId: mediaId || `demo-${Date.now().toString(36)}`,
          mediaType,
          videoDriveId,
        },
        isEdit
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save episode.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit Episode' : 'Add Episode'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-xl rounded-2xl bg-[#141418] border border-white/12 p-6 space-y-4 my-8"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-[#F5F3EE]">
            {isEdit ? `Edit Episode ${episode?.episodeNumber}` : 'Add New Episode'}
          </h3>
          <button type="button" onClick={onClose} className="p-2 text-[#A39E93] hover:text-[#F5F3EE]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="sm:col-span-2 space-y-1">
            <span className="text-[#A39E93]">Story</span>
            <select
              disabled={isEdit}
              value={storyId}
              onChange={(e) => setStoryId(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE] disabled:opacity-60"
            >
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Episode #</span>
            <input
              type="number"
              min={1}
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(e.target.value)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Title (EN) *</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Title (HI)</span>
            <input
              value={titleHi}
              onChange={(e) => setTitleHi(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Duration (seconds)</span>
            <input
              type="number"
              min={10}
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Price (Coins, 0 = Free)</span>
            <input
              type="number"
              min={0}
              value={priceCoins}
              onChange={(e) => setPriceCoins(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Media Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'demo' | 'drive')}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="demo">Demo</option>
              <option value="drive">Google Drive</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Format</span>
            <select
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as 'audio' | 'video')}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Media / Drive File ID</span>
            <input
              value={mediaId}
              onChange={(e) => setMediaId(e.target.value)}
              placeholder="demo-id or Drive file ID"
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="text-[#A39E93]">Optional Drive Video File ID (for Audio/Video switch)</span>
          <input
            value={videoDriveId}
            onChange={(e) => setVideoDriveId(e.target.value)}
            placeholder="Drive video file ID (leave blank if audio-only)"
            className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Description (EN)</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Description (HI)</span>
            <textarea
              rows={2}
              value={descriptionHi}
              onChange={(e) => setDescriptionHi(e.target.value)}
              className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        {error && <p className="text-xs text-[#F5C2B4]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl border border-white/15 text-xs text-[#D6D2C9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : isEdit ? 'Save Episode' : 'Create Episode'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface CreatorModalProps {
  firebaseUser: User | null;
  actor: UserProfile;
  creator: Creator | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const AdminCreatorEditorModal: React.FC<CreatorModalProps> = ({
  firebaseUser,
  actor,
  creator,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(creator);
  const [name, setName] = useState(creator?.name ?? '');
  const [handle, setHandle] = useState(creator?.handle ?? '');
  const [ownerUid, setOwnerUid] = useState(creator?.ownerUid ?? actor.uid);
  const [language, setLanguage] = useState<ContentLanguage>(creator?.language ?? 'bilingual');
  const [bioEn, setBioEn] = useState(creator?.bioEn ?? '');
  const [bioHi, setBioHi] = useState(creator?.bioHi ?? '');
  const [accentPalette, setAccentPalette] = useState(creator?.accentPalette ?? '#E5A93C');
  const [verified, setVerified] = useState(Boolean(creator?.verified ?? true));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Creator studio name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminSaveCreatorCms(
        firebaseUser,
        actor,
        {
          id: creator?.id,
          ownerUid,
          name,
          handle,
          bioEn,
          bioHi,
          language,
          verified,
          accentPalette,
        },
        isEdit
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save creator.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit Creator' : 'Add Creator'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-lg rounded-2xl bg-[#141418] border border-white/12 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-[#F5F3EE]">
            {isEdit ? `Edit Creator: ${creator?.name}` : 'Add Creator Profile'}
          </h3>
          <button type="button" onClick={onClose} className="p-2 text-[#A39E93] hover:text-[#F5F3EE]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Creator / Studio Name *</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Handle</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@studio"
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-[#A39E93]">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
              className="w-full min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            >
              <option value="bilingual">Bilingual</option>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[#A39E93]">Owner User UID</span>
            <input
              disabled={isEdit}
              value={ownerUid}
              onChange={(e) => setOwnerUid(e.target.value)}
              className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE] disabled:opacity-60"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="text-[#A39E93]">Bio (EN)</span>
          <textarea
            rows={2}
            value={bioEn}
            onChange={(e) => setBioEn(e.target.value)}
            className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-[#A39E93]">Bio (HI)</span>
          <textarea
            rows={2}
            value={bioHi}
            onChange={(e) => setBioHi(e.target.value)}
            className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
          />
        </label>

        <div className="flex items-center justify-between text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="accent-[#E5A93C]"
            />
            <span className="text-[#D6D2C9]">Verified Creator</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <span className="text-[#A39E93]">Accent</span>
            <input
              type="color"
              value={accentPalette}
              onChange={(e) => setAccentPalette(e.target.value)}
              className="w-8 h-8 rounded bg-transparent border border-white/15"
            />
          </label>
        </div>

        {error && <p className="text-xs text-[#F5C2B4]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl border border-white/15 text-xs text-[#D6D2C9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : isEdit ? 'Save Creator' : 'Create Creator'}
          </button>
        </div>
      </form>
    </div>
  );
};

interface UserEditModalProps {
  firebaseUser: User | null;
  actor: UserProfile;
  target: UserProfile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export const AdminUserEditModal: React.FC<UserEditModalProps> = ({
  firebaseUser,
  actor,
  target,
  onClose,
  onSaved,
}) => {
  const [displayName, setDisplayName] = useState(target.displayName);
  const [bio, setBio] = useState(target.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminUpdateUserDisplayName(firebaseUser, actor, target, displayName, bio);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit User Profile"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/12 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-[#F5F3EE]">
            Edit User: {target.email || target.uid}
          </h3>
          <button type="button" onClick={onClose} className="p-2 text-[#A39E93] hover:text-[#F5F3EE]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="text-[#A39E93]">Display Name</span>
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
          />
        </label>

        <label className="block space-y-1 text-xs">
          <span className="text-[#A39E93]">Bio</span>
          <textarea
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
          />
        </label>

        {error && <p className="text-xs text-[#F5C2B4]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 rounded-xl border border-white/15 text-xs text-[#D6D2C9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};
