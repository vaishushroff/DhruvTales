import type {
  BookmarkEntry,
  BookmarkTargetType,
  DailyUnlockEntry,
  LanguageCode,
  ListeningHistoryEntry,
  PlaybackFormat,
  UserChoiceEntry,
  UserProfile,
} from '../../types';

export interface AuthUserLike {
  uid: string;
  email: string | null;
  phoneNumber?: string | null;
  displayName: string | null;
  emailVerified: boolean;
}

export interface DisplayIdentity {
  isSignedIn: boolean;
  displayName: string;
  email: string;
  avatarInitials: string;
}

export const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';

export function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DT';
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
  const first = Array.from(parts[0])[0] ?? '';
  const last = Array.from(parts[parts.length - 1])[0] ?? '';
  return (first + last).toUpperCase() || 'DT';
}

/**
 * Derives a complete, non-blank fallback UserProfile directly from the Firebase Auth user.
 * Supports Google, Email/Password, and Phone Auth accounts cleanly.
 */
export function buildFallbackUserProfile(
  user: AuthUserLike,
  defaultLanguage: LanguageCode
): UserProfile {
  const phone = user.phoneNumber?.trim() || undefined;
  const email = (user.email || (phone ? '' : 'unknown@dhruvtales.app')).slice(0, 200);
  const displayName = (
    user.displayName ||
    user.email?.split('@')[0] ||
    phone ||
    'Listener'
  ).slice(0, 80);
  const isBootstrapAdmin =
    user.emailVerified && user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;

  return {
    uid: user.uid,
    email,
    ...(phone ? { phoneNumber: phone } : {}),
    displayName,
    bio: '',
    preferredLanguage: defaultLanguage,
    preferredFormat: 'audio',
    role: isBootstrapAdmin ? 'admin' : 'user',
    avatarInitials: computeInitials(displayName),
  };
}

/**
 * Single source of truth for header & profile identity rendering so AppShell
 * and ProfilePage never disagree on signed-in status or render blank identity fields.
 */
export function resolveDisplayIdentity(
  profile: UserProfile | null,
  firebaseUser: AuthUserLike | null
): DisplayIdentity {
  if (!profile && !firebaseUser) {
    return {
      isSignedIn: false,
      displayName: '',
      email: '',
      avatarInitials: 'DT',
    };
  }

  const displayName = (
    profile?.displayName?.trim() ||
    firebaseUser?.displayName?.trim() ||
    profile?.email?.split('@')[0] ||
    firebaseUser?.email?.split('@')[0] ||
    profile?.phoneNumber?.trim() ||
    firebaseUser?.phoneNumber?.trim() ||
    'Listener'
  ).slice(0, 80);

  const email =
    profile?.email?.trim() ||
    firebaseUser?.email?.trim() ||
    profile?.phoneNumber?.trim() ||
    firebaseUser?.phoneNumber?.trim() ||
    '';
  const avatarInitials =
    profile?.avatarInitials?.trim() || computeInitials(displayName);

  return {
    isSignedIn: true,
    displayName,
    email,
    avatarInitials,
  };
}

export interface BookmarkToggleResult {
  entryId: string;
  currentlyActive: boolean;
  nextActive: boolean;
  nextBookmarks: BookmarkEntry[];
}

/**
 * Pure, synchronous bookmark/favorite/follow toggle computation.
 * Avoids mutating a local variable inside React 19's deferred `setState(prev => ...)` updater,
 * which previously caused unbookmark/unfollow clicks to send `setDoc` instead of `deleteDoc`.
 */
export function computeBookmarkToggle(
  currentBookmarks: BookmarkEntry[],
  uid: string,
  targetType: BookmarkTargetType,
  targetId: string,
  nowMs: number = Date.now()
): BookmarkToggleResult {
  const entryId = `${uid}_${targetType}_${targetId}`.slice(0, 128);
  const currentlyActive = currentBookmarks.some(
    (b) => b.targetType === targetType && b.targetId === targetId
  );
  const nextActive = !currentlyActive;

  const nextBookmarks = currentlyActive
    ? currentBookmarks.filter(
        (b) => !(b.targetType === targetType && b.targetId === targetId)
      )
    : [
        {
          id: entryId,
          userId: uid,
          targetType,
          targetId,
          createdAt: nowMs,
        },
        ...currentBookmarks,
      ];

  return {
    entryId,
    currentlyActive,
    nextActive,
    nextBookmarks,
  };
}

export interface ListeningHistoryWritePayload {
  id: string;
  userId: string;
  storyId: string;
  storyOwnerUid?: string;
  episodeId: string;
  episodeNumber: number;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  updatedAt: unknown;
}

/**
 * Builds a rule-compliant `listeningHistory` payload with NaN/Infinity clamping.
 * Optionally omits `storyOwnerUid` for backwards compatibility if a Firestore ruleset
 * has not yet deployed the Phase 4 creator-analytics field.
 */
export function buildListeningHistoryPayload(
  uid: string,
  entry: Omit<ListeningHistoryEntry, 'id' | 'userId' | 'updatedAt'>,
  updatedAtToken: unknown,
  options?: { includeStoryOwnerUid?: boolean }
): ListeningHistoryWritePayload {
  const id = `${uid}_${entry.episodeId}`.slice(0, 128);
  const rawPos = Number.isFinite(entry.positionSec) ? entry.positionSec : 0;
  const rawDur = Number.isFinite(entry.durationSec) && entry.durationSec > 0 ? entry.durationSec : 1;
  const clampedDur = Math.max(1, Math.min(86400, Math.round(rawDur)));
  const clampedPos = Math.max(0, Math.min(clampedDur, Math.round(rawPos)));
  const safeEpisodeNumber =
    Number.isFinite(entry.episodeNumber) && entry.episodeNumber >= 1
      ? Math.min(1000, Math.round(entry.episodeNumber))
      : 1;

  const payload: ListeningHistoryWritePayload = {
    id,
    userId: uid,
    storyId: entry.storyId,
    episodeId: entry.episodeId,
    episodeNumber: safeEpisodeNumber,
    positionSec: clampedPos,
    durationSec: clampedDur,
    completed: Boolean(entry.completed),
    updatedAt: updatedAtToken,
  };

  const includeOwner = options?.includeStoryOwnerUid !== false;
  if (includeOwner && entry.storyOwnerUid && /^[a-zA-Z0-9_-]{1,128}$/.test(entry.storyOwnerUid)) {
    payload.storyOwnerUid = entry.storyOwnerUid;
  }

  return payload;
}

export type ActivityCollectionKey =
  | 'listeningHistory'
  | 'bookmarks'
  | 'dailyUnlocks'
  | 'userChoices';

export interface HydratedActivityResult {
  history: ListeningHistoryEntry[];
  bookmarks: BookmarkEntry[];
  dailyUnlocks: DailyUnlockEntry[];
  userChoices: UserChoiceEntry[];
  preferredFormat: PlaybackFormat;
  failedCollections: ActivityCollectionKey[];
}

/**
 * Combines `Promise.allSettled` results from the 4 personal activity collections so a failure
 * in one collection (e.g. `userChoices`) never wipes out `listeningHistory`
 * or `bookmarks` during page refresh hydration.
 */
export function combineSettledActivity(settled: {
  listeningHistory: PromiseSettledResult<ListeningHistoryEntry[]>;
  bookmarks: PromiseSettledResult<BookmarkEntry[]>;
  dailyUnlocks: PromiseSettledResult<DailyUnlockEntry[]>;
  userChoices: PromiseSettledResult<UserChoiceEntry[]>;
}): HydratedActivityResult {
  const failedCollections: ActivityCollectionKey[] = [];

  const history =
    settled.listeningHistory.status === 'fulfilled'
      ? settled.listeningHistory.value
      : (failedCollections.push('listeningHistory'), []);

  const bookmarks =
    settled.bookmarks.status === 'fulfilled'
      ? settled.bookmarks.value
      : (failedCollections.push('bookmarks'), []);

  const dailyUnlocks =
    settled.dailyUnlocks.status === 'fulfilled'
      ? settled.dailyUnlocks.value
      : (failedCollections.push('dailyUnlocks'), []);

  const userChoices =
    settled.userChoices.status === 'fulfilled'
      ? settled.userChoices.value
      : (failedCollections.push('userChoices'), []);

  return {
    history,
    bookmarks,
    dailyUnlocks,
    userChoices,
    preferredFormat: 'audio',
    failedCollections,
  };
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    error instanceof Error
      ? `${(error as { code?: string }).code ?? ''} ${error.message}`
      : String(error);
  const lower = msg.toLowerCase();
  return lower.includes('permission-denied') || lower.includes('missing or insufficient permissions');
}
