import type {
  DailyUnlockEntry,
  EconomySettings,
  Episode,
  EpisodeAccessResult,
  EpisodeUnlockRecord,
  Story,
  UserProfile,
} from '../../types';

export const DEFAULT_ECONOMY_SETTINGS: EconomySettings = {
  id: 'economy',
  dailyFreeEnabled: true,
  dailyFreeLimit: 1,
};

export function getTodayDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Pure price resolver shared between frontend UI and Vercel server APIs.
 * If an Admin set `story.priceOverrideCoins` (a non-null integer >= 0), it overrides
 * per-episode pricing at the story level; otherwise falls back to `episode.priceCoins`.
 */
export function resolveEffectiveEpisodePrice(
  episode: Pick<Episode, 'priceCoins'>,
  story?: Pick<Story, 'priceOverrideCoins'> | null
): number {
  if (
    story &&
    typeof story.priceOverrideCoins === 'number' &&
    Number.isFinite(story.priceOverrideCoins) &&
    story.priceOverrideCoins >= 0
  ) {
    return Math.floor(story.priceOverrideCoins);
  }
  const base =
    typeof episode.priceCoins === 'number' && Number.isFinite(episode.priceCoins)
      ? Math.floor(episode.priceCoins)
      : 0;
  return Math.max(0, base);
}

export interface EpisodeAccessContext {
  story?: Pick<Story, 'priceOverrideCoins'> | null;
  episodeUnlocks?: EpisodeUnlockRecord[];
  dailyUnlocks?: DailyUnlockEntry[];
  economySettings?: Pick<EconomySettings, 'dailyFreeEnabled' | 'dailyFreeLimit'> | null;
  todayDateKey?: string;
}

/**
 * Shared pure access control evaluator used identically by React UI and Vercel `/api/media/authorize`.
 * Checks:
 * 1. Effective price === 0 (free episode or story-level free override)
 * 2. Admin or owning story creator
 * 3. Permanent coin unlock (`episodeUnlocks`)
 * 4. Claimed daily free unlock (`dailyUnlocks`)
 * 5. Otherwise locked — reports whether Daily Free Episode is available today alongside Coin Unlock.
 */
export function canAccessEpisode(
  user: UserProfile | null,
  episode: Episode,
  context: EpisodeAccessContext = {}
): EpisodeAccessResult {
  const effectivePriceCoins = resolveEffectiveEpisodePrice(episode, context.story);
  const settings = context.economySettings ?? DEFAULT_ECONOMY_SETTINGS;
  const dailyUnlocks = context.dailyUnlocks ?? [];
  const episodeUnlocks = context.episodeUnlocks ?? [];
  const today = context.todayDateKey ?? getTodayDateKey();

  // 1. Free episodes (priceCoins === 0 or story override === 0) are universally playable
  if (effectivePriceCoins === 0) {
    return {
      allowed: true,
      effectivePriceCoins: 0,
      reason: 'free_episode',
      canUseDailyFree: false,
    };
  }

  // 2. Admins and owning creators always have full playback access
  if (user && !user.isDisabled && (user.role === 'admin' || user.uid === episode.creatorOwnerUid)) {
    return {
      allowed: true,
      effectivePriceCoins,
      reason: 'admin_or_creator_owner',
      canUseDailyFree: false,
    };
  }

  // 3. Permanent coin unlock (user paid once -> replay forever without paying again)
  const hasPermanentUnlock = episodeUnlocks.some((entry) => entry.episodeId === episode.id);
  if (hasPermanentUnlock) {
    return {
      allowed: true,
      effectivePriceCoins,
      reason: 'coin_unlocked',
      canUseDailyFree: false,
    };
  }

  // 4. Already unlocked via Daily Free Episode
  const hasDailyUnlock = dailyUnlocks.some((entry) => entry.episodeId === episode.id);
  if (hasDailyUnlock) {
    return {
      allowed: true,
      effectivePriceCoins,
      reason: 'daily_unlock_claimed',
      canUseDailyFree: false,
    };
  }

  // 5. Locked paid episode — evaluate whether daily free episode option is currently available
  const remainingDaily = getRemainingDailyUnlocks(dailyUnlocks, settings, today);
  const canUseDailyFree = Boolean(settings.dailyFreeEnabled && remainingDaily > 0);

  return {
    allowed: false,
    effectivePriceCoins,
    reason: user ? 'requires_coin_unlock' : 'requires_sign_in',
    canUseDailyFree,
  };
}

export function getRemainingDailyUnlocks(
  dailyUnlocks: DailyUnlockEntry[],
  economySettings: Pick<EconomySettings, 'dailyFreeEnabled' | 'dailyFreeLimit'> = DEFAULT_ECONOMY_SETTINGS,
  todayDateKey: string = getTodayDateKey()
): number {
  if (!economySettings.dailyFreeEnabled) return 0;
  const safeLimit = Math.max(0, Math.floor(economySettings.dailyFreeLimit));
  const usedToday = dailyUnlocks.filter((u) => u.unlockDate === todayDateKey).length;
  return Math.max(0, safeLimit - usedToday);
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatPlayCount(plays: number): string {
  if (plays >= 1_000_000) {
    return `${(plays / 1_000_000).toFixed(1)}M`;
  }
  if (plays >= 1_000) {
    return `${(plays / 1_000).toFixed(1)}K`;
  }
  return String(plays);
}

export interface StoryFilterOptions {
  query?: string;
  genreId?: string;
  language?: string;
  creatorId?: string;
  sortBy?: 'popular' | 'rating' | 'recent';
}

/**
 * Pure deterministic database-query-style story filtering & sorting (zero AI).
 */
export function filterAndSortStories(
  stories: Story[],
  options: StoryFilterOptions
): Story[] {
  const q = (options.query ?? '').trim().toLowerCase();
  const filtered = stories.filter((story) => {
    if (story.visibility !== 'published') return false;
    if (options.genreId && options.genreId !== 'all' && story.genreId !== options.genreId) {
      return false;
    }
    if (options.language && options.language !== 'all') {
      if (story.language !== options.language && story.language !== 'bilingual') {
        return false;
      }
    }
    if (options.creatorId && options.creatorId !== 'all' && story.creatorId !== options.creatorId) {
      return false;
    }
    if (q) {
      const haystack = `${story.title} ${story.titleHi} ${story.synopsis} ${story.synopsisHi} ${story.creatorName}`.toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    return true;
  });

  const sorted = [...filtered];
  const sortBy = options.sortBy ?? 'popular';
  if (sortBy === 'rating') {
    sorted.sort((a, b) => b.rating - a.rating || b.totalPlays - a.totalPlays);
  } else if (sortBy === 'recent') {
    sorted.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  } else {
    sorted.sort((a, b) => b.totalPlays - a.totalPlays);
  }
  return sorted;
}
