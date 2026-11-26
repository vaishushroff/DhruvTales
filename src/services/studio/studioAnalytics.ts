import type {
  Episode,
  EpisodeChoicePoint,
  ListeningHistoryEntry,
  Story,
  UserProfile,
  UserRole,
} from '../../types';

export interface EpisodeAnalyticsRow {
  episodeId: string;
  episodeNumber: number;
  title: string;
  titleHi: string;
  plays: number;
  completions: number;
  completionRatePct: number;
  avgProgressPct: number;
}

export interface StoryAnalyticsSummary {
  storyId: string;
  totalTrackedPlays: number;
  totalCompletions: number;
  completionRatePct: number;
  episodes: EpisodeAnalyticsRow[];
}

export interface CreatorDashboardStats {
  totalStories: number;
  publishedStories: number;
  draftStories: number;
  totalEpisodes: number;
  totalPlays: number;
  followers: number;
}

/**
 * Pure RBAC route guard evaluator.
 */
export function hasRouteAccess(
  profile: UserProfile | null,
  allowedRoles: UserRole[]
): { allowed: boolean; reason: 'ok' | 'unauthenticated' | 'disabled' | 'insufficient_role' } {
  if (!profile) {
    return { allowed: false, reason: 'unauthenticated' };
  }
  if (profile.isDisabled || profile.banned) {
    return { allowed: false, reason: 'disabled' };
  }
  if (!allowedRoles.includes(profile.role)) {
    return { allowed: false, reason: 'insufficient_role' };
  }
  return { allowed: true, reason: 'ok' };
}

/**
 * Enforces ownership on client side (mirrored strictly in firestore.rules).
 */
export function canManageStory(profile: UserProfile | null, story: Story): boolean {
  if (!profile || profile.isDisabled || profile.banned) return false;
  if (profile.role === 'admin') return true;
  return profile.role === 'creator' && story.creatorOwnerUid === profile.uid;
}

/**
 * Computes Creator Studio top-level KPI stat cards.
 */
export function computeCreatorStats(
  ownedStories: Story[],
  ownedEpisodes: Episode[],
  followersCount: number
): CreatorDashboardStats {
  const publishedStories = ownedStories.filter((s) => s.visibility === 'published').length;
  const draftStories = ownedStories.filter((s) => s.visibility === 'draft').length;
  const totalPlays = ownedStories.reduce((sum, s) => sum + (s.totalPlays || 0), 0);

  return {
    totalStories: ownedStories.length,
    publishedStories,
    draftStories,
    totalEpisodes: ownedEpisodes.length,
    totalPlays,
    followers: Math.max(0, followersCount),
  };
}

/**
 * Computes per-story and per-episode plays and completion metrics from listeningHistory.
 */
export function computeStoryAnalytics(
  storyId: string,
  storyEpisodes: Episode[],
  historyEntries: ListeningHistoryEntry[]
): StoryAnalyticsSummary {
  const sortedEpisodes = [...storyEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const relevant = historyEntries.filter((h) => h.storyId === storyId);

  const byEpisode = new Map<string, ListeningHistoryEntry[]>();
  for (const h of relevant) {
    const arr = byEpisode.get(h.episodeId) ?? [];
    arr.push(h);
    byEpisode.set(h.episodeId, arr);
  }

  let totalTrackedPlays = 0;
  let totalCompletions = 0;

  const episodes: EpisodeAnalyticsRow[] = sortedEpisodes.map((ep) => {
    const entries = byEpisode.get(ep.id) ?? [];
    const plays = entries.length;
    const completions = entries.filter((e) => e.completed).length;
    const avgProgressPct =
      plays > 0
        ? Math.round(
            entries.reduce((sum, e) => {
              const dur = Math.max(1, e.durationSec || ep.durationSec || 1);
              return sum + Math.min(100, (e.positionSec / dur) * 100);
            }, 0) / plays
          )
        : 0;
    const completionRatePct = plays > 0 ? Math.round((completions / plays) * 100) : 0;

    totalTrackedPlays += plays;
    totalCompletions += completions;

    return {
      episodeId: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      titleHi: ep.titleHi,
      plays,
      completions,
      completionRatePct,
      avgProgressPct,
    };
  });

  const completionRatePct =
    totalTrackedPlays > 0 ? Math.round((totalCompletions / totalTrackedPlays) * 100) : 0;

  return {
    storyId,
    totalTrackedPlays,
    totalCompletions,
    completionRatePct,
    episodes,
  };
}

/**
 * Pure episode reorder helper: moves an episode up or down and returns clean 1..N numbering.
 */
export function reorderEpisodeList(
  episodes: Episode[],
  episodeId: string,
  direction: 'up' | 'down'
): Episode[] {
  const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
  const idx = sorted.findIndex((e) => e.id === episodeId);
  if (idx === -1) return sorted;

  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sorted.length) return sorted;

  const next = [...sorted];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);

  return next.map((ep, i) => ({
    ...ep,
    episodeNumber: i + 1,
  }));
}

/**
 * Validates an interactive choice point before saving in Creator Studio.
 */
export function validateChoicePoint(
  cp: EpisodeChoicePoint,
  validEpisodeIds: Set<string>,
  currentEpisodeId?: string
): string | null {
  if (!cp.promptEn.trim() || !cp.promptHi.trim()) {
    return 'Choice prompt is required in both English and Hindi.';
  }
  if (cp.options.length < 2 || cp.options.length > 3) {
    return 'Each choice point must have 2 or 3 options.';
  }
  for (const opt of cp.options) {
    if (!opt.labelEn.trim() || !opt.labelHi.trim()) {
      return 'Every choice option needs both English and Hindi labels.';
    }
    if (!opt.nextEpisodeId || !validEpisodeIds.has(opt.nextEpisodeId)) {
      return 'Every choice option must link to an existing episode in this story.';
    }
    if (currentEpisodeId && opt.nextEpisodeId === currentEpisodeId) {
      return 'A choice option cannot link back to the exact same episode.';
    }
  }
  return null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `item-${Date.now()}`;
}
