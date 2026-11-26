import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackUserProfile,
  buildListeningHistoryPayload,
  combineSettledActivity,
  computeBookmarkToggle,
  isPermissionDeniedError,
  resolveDisplayIdentity,
} from './activityPersistence';
import type { BookmarkEntry, ListeningHistoryEntry } from '../../types';

test('resolveDisplayIdentity never shows signed-out or blank identity when firebaseUser exists and profile is null', () => {
  const identity = resolveDisplayIdentity(null, {
    uid: 'u-listener-1',
    email: 'listener@example.com',
    displayName: 'Aarav Mehta',
    emailVerified: true,
  });

  assert.equal(identity.isSignedIn, true);
  assert.equal(identity.displayName, 'Aarav Mehta');
  assert.equal(identity.email, 'listener@example.com');
  assert.equal(identity.avatarInitials, 'AM');
});

test('buildFallbackUserProfile derives valid profile fields from firebaseUser', () => {
  const profile = buildFallbackUserProfile(
    {
      uid: 'u-listener-2',
      email: 'meera@example.com',
      displayName: null,
      emailVerified: true,
    },
    'hi'
  );

  assert.equal(profile.uid, 'u-listener-2');
  assert.equal(profile.displayName, 'meera');
  assert.equal(profile.email, 'meera@example.com');
  assert.equal(profile.avatarInitials, 'ME');
  assert.equal(profile.role, 'user');
  assert.equal(profile.preferredLanguage, 'hi');
  assert.equal(profile.preferredFormat, 'audio');
});

test('computeBookmarkToggle synchronously computes add and remove states without deferred React updater race', () => {
  const uid = 'u-bhangarh-1';
  const initial: BookmarkEntry[] = [];

  // 1. Add story bookmark
  const addedBookmark = computeBookmarkToggle(
    initial,
    uid,
    'story_bookmark',
    'story-bhangarh-raat',
    1000
  );
  assert.equal(addedBookmark.currentlyActive, false);
  assert.equal(addedBookmark.nextActive, true);
  assert.equal(addedBookmark.entryId, `${uid}_story_bookmark_story-bhangarh-raat`);
  assert.equal(addedBookmark.nextBookmarks.length, 1);

  // 2. Add creator follow
  const addedFollow = computeBookmarkToggle(
    addedBookmark.nextBookmarks,
    uid,
    'creator_follow',
    'creator-raat-collective',
    2000
  );
  assert.equal(addedFollow.currentlyActive, false);
  assert.equal(addedFollow.nextActive, true);
  assert.equal(addedFollow.nextBookmarks.length, 2);

  // 3. Remove story bookmark — currentlyActive MUST be true so Firestore calls deleteDoc, not setDoc!
  const removedBookmark = computeBookmarkToggle(
    addedFollow.nextBookmarks,
    uid,
    'story_bookmark',
    'story-bhangarh-raat',
    3000
  );
  assert.equal(removedBookmark.currentlyActive, true);
  assert.equal(removedBookmark.nextActive, false);
  assert.equal(removedBookmark.nextBookmarks.length, 1);
  assert.equal(removedBookmark.nextBookmarks[0].targetType, 'creator_follow');
});

test('buildListeningHistoryPayload clamps NaN/bounds and supports omitting optional storyOwnerUid for legacy rules fallback', () => {
  const token = { _type: 'serverTimestamp' };

  const full = buildListeningHistoryPayload(
    'u-listener-1',
    {
      storyId: 'story-bhangarh-raat',
      storyOwnerUid: 'nQkhxQBo5fQO6kBEiz843jiDJus2',
      episodeId: 'story-bhangarh-raat-ep-2',
      episodeNumber: 2,
      positionSec: 28.4,
      durationSec: 40,
      completed: false,
    },
    token
  );
  assert.equal(full.id, 'u-listener-1_story-bhangarh-raat-ep-2');
  assert.equal(full.positionSec, 28);
  assert.equal(full.durationSec, 40);
  assert.equal(full.storyOwnerUid, 'nQkhxQBo5fQO6kBEiz843jiDJus2');

  const withoutOwner = buildListeningHistoryPayload(
    'u-listener-1',
    {
      storyId: 'story-kaalchakra',
      storyOwnerUid: 'nQkhxQBo5fQO6kBEiz843jiDJus2',
      episodeId: 'story-kaalchakra-ep-3',
      episodeNumber: 3,
      positionSec: Number.NaN,
      durationSec: 40,
      completed: false,
    },
    token,
    { includeStoryOwnerUid: false }
  );
  assert.equal(withoutOwner.positionSec, 0);
  assert.equal(withoutOwner.durationSec, 40);
  assert.equal('storyOwnerUid' in withoutOwner, false);
});

test('combineSettledActivity preserves listeningHistory and bookmarks even if userChoices fails', () => {
  const bhangarhHistory: ListeningHistoryEntry = {
    id: 'u1_story-bhangarh-raat-ep-2',
    userId: 'u1',
    storyId: 'story-bhangarh-raat',
    episodeId: 'story-bhangarh-raat-ep-2',
    episodeNumber: 2,
    positionSec: 28,
    durationSec: 40,
    completed: false,
    updatedAt: 5000,
  };
  const bhangarhBookmark: BookmarkEntry = {
    id: 'u1_story_bookmark_story-bhangarh-raat',
    userId: 'u1',
    targetType: 'story_bookmark',
    targetId: 'story-bhangarh-raat',
    createdAt: 4000,
  };

  const result = combineSettledActivity({
    listeningHistory: { status: 'fulfilled', value: [bhangarhHistory] },
    bookmarks: { status: 'fulfilled', value: [bhangarhBookmark] },
    dailyUnlocks: { status: 'fulfilled', value: [] },
    userChoices: { status: 'rejected', reason: new Error('Missing or insufficient permissions.') },
  });

  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].positionSec, 28);
  assert.equal(result.bookmarks.length, 1);
  assert.equal(result.bookmarks[0].targetId, 'story-bhangarh-raat');
  assert.deepEqual(result.failedCollections, ['userChoices']);
});

test('isPermissionDeniedError detects Firebase permission error codes and messages', () => {
  assert.equal(isPermissionDeniedError(new Error('Missing or insufficient permissions.')), true);
  assert.equal(
    isPermissionDeniedError(Object.assign(new Error('denied'), { code: 'permission-denied' })),
    true
  );
  assert.equal(isPermissionDeniedError(new Error('network timeout')), false);
});
