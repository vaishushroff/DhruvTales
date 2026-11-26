import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  BookmarkEntry,
  BookmarkTargetType,
  DailyUnlockEntry,
  ListeningHistoryEntry,
  PlaybackFormat,
  UserChoiceEntry,
} from '../../types';
import { getTodayDateKey } from '../access/episodeAccess';
import {
  buildListeningHistoryPayload,
  combineSettledActivity,
  isPermissionDeniedError,
  type HydratedActivityResult,
} from './activityPersistence';
import { db, handleFirestoreError, OperationType } from './config';

export interface UserActivityState {
  history: ListeningHistoryEntry[];
  bookmarks: BookmarkEntry[];
  dailyUnlocks: DailyUnlockEntry[];
  userChoices: UserChoiceEntry[];
  preferredFormat: PlaybackFormat;
}

const LOCAL_STORAGE_KEY = 'dhruv_tales_guest_activity_v1';
const USER_CACHE_KEY_PREFIX = 'dhruv_tales_user_activity_v1_';

function emptyActivityState(): UserActivityState {
  return {
    history: [],
    bookmarks: [],
    dailyUnlocks: [],
    userChoices: [],
    preferredFormat: 'audio',
  };
}

function tsToMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  return Date.now();
}

function readLocalActivityByKey(storageKey: string): UserActivityState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return emptyActivityState();
    const parsed = JSON.parse(raw) as Partial<UserActivityState>;
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      dailyUnlocks: Array.isArray(parsed.dailyUnlocks) ? parsed.dailyUnlocks : [],
      userChoices: Array.isArray(parsed.userChoices) ? parsed.userChoices : [],
      preferredFormat: parsed.preferredFormat === 'video' ? 'video' : 'audio',
    };
  } catch {
    return emptyActivityState();
  }
}

function writeLocalActivityByKey(storageKey: string, state: UserActivityState): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors in restricted frames
  }
}

export function loadGuestActivity(): UserActivityState {
  return readLocalActivityByKey(LOCAL_STORAGE_KEY);
}

export function saveGuestActivity(state: UserActivityState): void {
  writeLocalActivityByKey(LOCAL_STORAGE_KEY, state);
}

export function loadLocalActivityForUser(uid: string): UserActivityState {
  return readLocalActivityByKey(`${USER_CACHE_KEY_PREFIX}${uid}`);
}

export function saveLocalActivityForUser(uid: string, state: UserActivityState): void {
  writeLocalActivityByKey(`${USER_CACHE_KEY_PREFIX}${uid}`, state);
}

export async function fetchUserActivity(uid: string): Promise<HydratedActivityResult> {
  const [histRes, bmRes, unlockRes, choiceRes] = await Promise.allSettled([
    getDocs(query(collection(db, 'listeningHistory'), where('userId', '==', uid))).then((snap) =>
      snap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id),
            userId: String(raw.userId),
            storyId: String(raw.storyId),
            storyOwnerUid: raw.storyOwnerUid ? String(raw.storyOwnerUid) : undefined,
            episodeId: String(raw.episodeId),
            episodeNumber: Number(raw.episodeNumber),
            positionSec: Number(raw.positionSec),
            durationSec: Number(raw.durationSec),
            completed: Boolean(raw.completed),
            updatedAt: tsToMillis(raw.updatedAt),
          } as ListeningHistoryEntry;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
    ),
    getDocs(query(collection(db, 'bookmarks'), where('userId', '==', uid))).then((snap) =>
      snap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id),
            userId: String(raw.userId),
            targetType: raw.targetType as BookmarkTargetType,
            targetId: String(raw.targetId),
            createdAt: tsToMillis(raw.createdAt),
          } as BookmarkEntry;
        })
        .sort((a, b) => b.createdAt - a.createdAt)
    ),
    getDocs(query(collection(db, 'dailyUnlocks'), where('userId', '==', uid))).then((snap) =>
      snap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id),
            userId: String(raw.userId),
            storyId: String(raw.storyId),
            episodeId: String(raw.episodeId),
            unlockDate: String(raw.unlockDate),
            createdAt: tsToMillis(raw.createdAt),
          } as DailyUnlockEntry;
        })
        .sort((a, b) => b.createdAt - a.createdAt)
    ),
    getDocs(query(collection(db, 'userChoices'), where('userId', '==', uid))).then((snap) =>
      snap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id),
            userId: String(raw.userId),
            storyId: String(raw.storyId),
            episodeId: String(raw.episodeId),
            choicePointId: String(raw.choicePointId),
            optionId: String(raw.optionId),
            optionLabelEn: String(raw.optionLabelEn),
            optionLabelHi: String(raw.optionLabelHi),
            nextEpisodeId: String(raw.nextEpisodeId),
            chosenAt: tsToMillis(raw.chosenAt),
          } as UserChoiceEntry;
        })
        .sort((a, b) => a.chosenAt - b.chosenAt)
    ),
  ]);

  const settledMap = {
    listeningHistory: histRes,
    bookmarks: bmRes,
    dailyUnlocks: unlockRes,
    userChoices: choiceRes,
  };

  for (const [name, result] of Object.entries(settledMap)) {
    if (result.status === 'rejected') {
      console.warn(`Could not load ${name} for user ${uid}:`, result.reason);
    }
  }

  return combineSettledActivity(settledMap);
}

export async function saveListeningProgressToFirestore(
  uid: string,
  entry: Omit<ListeningHistoryEntry, 'id' | 'userId' | 'updatedAt'>
): Promise<ListeningHistoryEntry> {
  const payload = buildListeningHistoryPayload(uid, entry, serverTimestamp(), {
    includeStoryOwnerUid: true,
  });
  const ref = doc(db, 'listeningHistory', payload.id);

  try {
    try {
      await setDoc(ref, payload);
    } catch (writeErr) {
      if (payload.storyOwnerUid && isPermissionDeniedError(writeErr)) {
        // Backwards-compatible retry if deployed Firestore rules predate Phase 4's storyOwnerUid field
        const legacyPayload = buildListeningHistoryPayload(uid, entry, serverTimestamp(), {
          includeStoryOwnerUid: false,
        });
        await setDoc(ref, legacyPayload);
      } else {
        throw writeErr;
      }
    }

    return {
      id: payload.id,
      userId: uid,
      storyId: payload.storyId,
      storyOwnerUid: payload.storyOwnerUid,
      episodeId: payload.episodeId,
      episodeNumber: payload.episodeNumber,
      positionSec: payload.positionSec,
      durationSec: payload.durationSec,
      completed: payload.completed,
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `listeningHistory/${payload.id}`);
  }
}

export async function toggleBookmarkInFirestore(
  uid: string,
  targetType: BookmarkTargetType,
  targetId: string,
  currentlyActive: boolean
): Promise<BookmarkEntry | null> {
  const id = `${uid}_${targetType}_${targetId}`.slice(0, 128);
  const ref = doc(db, 'bookmarks', id);

  try {
    if (currentlyActive) {
      await deleteDoc(ref);
      return null;
    }
    await setDoc(ref, {
      id,
      userId: uid,
      targetType,
      targetId,
      createdAt: serverTimestamp(),
    });
    return {
      id,
      userId: uid,
      targetType,
      targetId,
      createdAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(
      error,
      currentlyActive ? OperationType.DELETE : OperationType.CREATE,
      `bookmarks/${id}`
    );
  }
}

export async function recordDailyUnlockInFirestore(
  uid: string,
  storyId: string,
  episodeId: string
): Promise<DailyUnlockEntry> {
  const id = `${uid}_${episodeId}`.slice(0, 128);
  const unlockDate = getTodayDateKey();
  const ref = doc(db, 'dailyUnlocks', id);

  try {
    await setDoc(ref, {
      id,
      userId: uid,
      storyId,
      episodeId,
      unlockDate,
      createdAt: serverTimestamp(),
    });
    return {
      id,
      userId: uid,
      storyId,
      episodeId,
      unlockDate,
      createdAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `dailyUnlocks/${id}`);
  }
}

export async function saveUserChoiceToFirestore(
  uid: string,
  entry: Omit<UserChoiceEntry, 'id' | 'userId' | 'chosenAt'>
): Promise<UserChoiceEntry> {
  const id = `${uid}_${entry.storyId}_${entry.episodeId}`.slice(0, 128);
  const ref = doc(db, 'userChoices', id);

  try {
    await setDoc(ref, {
      id,
      userId: uid,
      storyId: entry.storyId,
      episodeId: entry.episodeId,
      choicePointId: entry.choicePointId,
      optionId: entry.optionId,
      optionLabelEn: entry.optionLabelEn.slice(0, 160),
      optionLabelHi: entry.optionLabelHi.slice(0, 160),
      nextEpisodeId: entry.nextEpisodeId,
      chosenAt: serverTimestamp(),
    });
    return {
      id,
      userId: uid,
      ...entry,
      chosenAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `userChoices/${id}`);
  }
}

export async function deleteUserChoicesFromFirestore(choiceIds: string[]): Promise<void> {
  if (choiceIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const id of choiceIds) {
      batch.delete(doc(db, 'userChoices', id));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `userChoices/${choiceIds.join(',')}`);
  }
}
