import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessEpisode,
  DEFAULT_ECONOMY_SETTINGS,
  filterAndSortStories,
  formatDuration,
  formatPlayCount,
  getRemainingDailyUnlocks,
  resolveEffectiveEpisodePrice,
} from './episodeAccess';
import type {
  DailyUnlockEntry,
  EconomySettings,
  Episode,
  EpisodeUnlockRecord,
  Story,
  UserProfile,
} from '../../types';

const baseUser: UserProfile = {
  uid: 'user-1',
  email: 'listener@example.com',
  displayName: 'Aarav',
  preferredLanguage: 'en',
  role: 'user',
  avatarInitials: 'AA',
};

const makeEpisode = (priceCoins: number, id = 'ep-1'): Episode => ({
  id,
  storyId: 'story-1',
  creatorOwnerUid: 'creator-owner-1',
  episodeNumber: 3,
  title: 'Episode 3',
  titleHi: 'एपिसोड 3',
  durationSec: 420,
  priceCoins,
  mediaRef: { provider: 'demo', id: 'demo-track-1', type: 'audio' },
  publishedAt: '2026-10-01T00:00:00Z',
});

test('canAccessEpisode allows free episodes (priceCoins = 0) for guests and signed-in users', () => {
  const freeEp = makeEpisode(0);
  assert.equal(canAccessEpisode(null, freeEp).allowed, true);
  assert.equal(canAccessEpisode(baseUser, freeEp).reason, 'free_episode');
});

test('canAccessEpisode allows permanent coin unlock, creator owner, and admin on paid episodes', () => {
  const paidEp = makeEpisode(15, 'ep-paid');
  const adminUser: UserProfile = { ...baseUser, role: 'admin' };
  const ownerCreator: UserProfile = { ...baseUser, uid: 'creator-owner-1', role: 'creator' };

  const locked = canAccessEpisode(baseUser, paidEp, {
    economySettings: { ...DEFAULT_ECONOMY_SETTINGS, dailyFreeEnabled: false },
  });
  assert.equal(locked.allowed, false);
  assert.equal(locked.reason, 'requires_coin_unlock');
  assert.equal(locked.effectivePriceCoins, 15);

  const coinUnlock: EpisodeUnlockRecord = {
    id: 'user-1_ep-paid',
    uid: 'user-1',
    episodeId: 'ep-paid',
    storyId: 'story-1',
    creatorId: 'creator-1',
    pricePaidCoins: 15,
    transactionId: 'tx-1',
    unlockedAt: Date.now(),
  };

  const unlockedRes = canAccessEpisode(baseUser, paidEp, {
    episodeUnlocks: [coinUnlock],
  });
  assert.equal(unlockedRes.allowed, true);
  assert.equal(unlockedRes.reason, 'coin_unlocked');

  assert.equal(canAccessEpisode(adminUser, paidEp).allowed, true);
  assert.equal(canAccessEpisode(adminUser, paidEp).reason, 'admin_or_creator_owner');
  assert.equal(canAccessEpisode(ownerCreator, paidEp).allowed, true);
  assert.equal(canAccessEpisode(ownerCreator, paidEp).reason, 'admin_or_creator_owner');
});

test('resolveEffectiveEpisodePrice respects Admin story-level priceOverrideCoins (including 0 = free)', () => {
  const ep = makeEpisode(20, 'ep-override');
  assert.equal(resolveEffectiveEpisodePrice(ep, null), 20);
  assert.equal(resolveEffectiveEpisodePrice(ep, { priceOverrideCoins: null }), 20);
  assert.equal(resolveEffectiveEpisodePrice(ep, { priceOverrideCoins: 5 }), 5);
  assert.equal(resolveEffectiveEpisodePrice(ep, { priceOverrideCoins: 0 }), 0);

  const overriddenFree = canAccessEpisode(baseUser, ep, {
    story: { priceOverrideCoins: 0 },
  });
  assert.equal(overriddenFree.allowed, true);
  assert.equal(overriddenFree.reason, 'free_episode');
});

test('canAccessEpisode respects admin-configurable daily free episode setting and quota', () => {
  const paidEp = makeEpisode(10, 'ep-daily-1');
  const today = '2026-11-23';
  const ecoOn: EconomySettings = {
    id: 'economy',
    dailyFreeEnabled: true,
    dailyFreeLimit: 2,
    updatedAt: 0,
  };
  const ecoOff: EconomySettings = {
    id: 'economy',
    dailyFreeEnabled: false,
    dailyFreeLimit: 2,
    updatedAt: 0,
  };

  // Eligible when enabled and under quota
  const eligible = canAccessEpisode(baseUser, paidEp, {
    dailyUnlocks: [],
    economySettings: ecoOn,
    todayDateKey: today,
  });
  assert.equal(eligible.allowed, false);
  assert.equal(eligible.canUseDailyFree, true);
  assert.equal(eligible.reason, 'requires_coin_unlock');

  // Disabled by admin -> canUseDailyFree is false
  const disabled = canAccessEpisode(baseUser, paidEp, {
    dailyUnlocks: [],
    economySettings: ecoOff,
    todayDateKey: today,
  });
  assert.equal(disabled.canUseDailyFree, false);
  assert.equal(getRemainingDailyUnlocks([], ecoOff, today), 0);

  // Claimed daily unlock grants access
  const claimedUnlock: DailyUnlockEntry = {
    id: 'user-1_ep-daily-1',
    userId: 'user-1',
    storyId: 'story-1',
    episodeId: 'ep-daily-1',
    unlockDate: today,
    createdAt: Date.now(),
  };
  const unlockedRes = canAccessEpisode(baseUser, paidEp, {
    dailyUnlocks: [claimedUnlock],
    economySettings: ecoOn,
    todayDateKey: today,
  });
  assert.equal(unlockedRes.allowed, true);
  assert.equal(unlockedRes.reason, 'daily_unlock_claimed');

  // Quota reached disables daily free option for new episodes today
  const twoUnlocks: DailyUnlockEntry[] = [
    { ...claimedUnlock, id: 'u1', episodeId: 'other-1' },
    { ...claimedUnlock, id: 'u2', episodeId: 'other-2' },
  ];
  assert.equal(getRemainingDailyUnlocks(twoUnlocks, ecoOn, today), 0);
  const blocked = canAccessEpisode(baseUser, paidEp, {
    dailyUnlocks: twoUnlocks,
    economySettings: ecoOn,
    todayDateKey: today,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.canUseDailyFree, false);
});

test('formatDuration and formatPlayCount format clean tabular strings', () => {
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(3665), '1:01:05');
  assert.equal(formatPlayCount(850), '850');
  assert.equal(formatPlayCount(14500), '14.5K');
  assert.equal(formatPlayCount(2400000), '2.4M');
});

test('filterAndSortStories filters by genre, language, query, and sort order', () => {
  const sampleStories: Story[] = [
    {
      id: 's1',
      slug: 'kaalchakra',
      title: 'Kaalchakra',
      titleHi: 'कालचक्र',
      synopsis: 'Ancient astrolabe mystery',
      synopsisHi: 'प्राचीन रहस्य',
      genreId: 'mythology',
      language: 'hi',
      creatorId: 'c1',
      creatorOwnerUid: 'o1',
      creatorName: 'Meera Studio',
      coverTheme: 'mythology-gold',
      rating: 4.9,
      totalPlays: 120000,
      episodeCount: 6,
      isTrending: true,
      isEditorsPick: true,
      isPopular: true,
      isFeatured: true,
      visibility: 'published',
      format: 'hybrid',
      isInteractive: false,
      publishedAt: '2026-11-10T00:00:00Z',
    },
    {
      id: 's2',
      slug: 'shimla-rain',
      title: 'Monsoon Letters',
      titleHi: 'मानसून के ख़त',
      synopsis: 'Letters found in Shimla',
      synopsisHi: 'शिमला में मिले ख़त',
      genreId: 'romance',
      language: 'en',
      creatorId: 'c2',
      creatorOwnerUid: 'o2',
      creatorName: 'Kabir Sen',
      coverTheme: 'romance-mist',
      rating: 4.7,
      totalPlays: 250000,
      episodeCount: 5,
      isTrending: true,
      isEditorsPick: false,
      isPopular: true,
      isFeatured: false,
      visibility: 'published',
      format: 'audio',
      isInteractive: false,
      publishedAt: '2026-11-20T00:00:00Z',
    },
  ];

  assert.equal(filterAndSortStories(sampleStories, { genreId: 'mythology' }).length, 1);
  assert.equal(filterAndSortStories(sampleStories, { query: 'shimla' })[0].id, 's2');
  assert.equal(filterAndSortStories(sampleStories, { sortBy: 'rating' })[0].id, 's1');
  assert.equal(filterAndSortStories(sampleStories, { sortBy: 'recent' })[0].id, 's2');
  assert.equal(filterAndSortStories(sampleStories, { sortBy: 'popular' })[0].id, 's2');
});
