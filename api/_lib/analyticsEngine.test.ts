import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Category,
  CoinTransaction,
  CoinWallet,
  Creator,
  Episode,
  ListeningHistoryEntry,
  SessionLogEntry,
  Story,
  UserProfile,
} from '../../src/types';
import {
  buildAdminAnalyticsCsv,
  buildPerUserAnalyticsCsv,
  computeAdminAnalyticsReport,
  computePerUserAnalytics,
  computeUserMyCoinsAnalytics,
  escapeCsvCell,
  getTimeBucketKeyAndLabel,
} from './analyticsEngine';

const NOW = Date.UTC(2026, 4, 20, 12, 0, 0); // 2026-05-20T12:00:00Z
const DAY = 24 * 60 * 60 * 1000;

const CATEGORIES: Category[] = [
  { id: 'horror', slug: 'horror', nameEn: 'Horror', nameHi: 'हॉरर', sortOrder: 1, isActive: true },
  { id: 'mythology', slug: 'mythology', nameEn: 'Mythology', nameHi: 'पौराणिक', sortOrder: 2, isActive: true },
];

const CREATORS: Creator[] = [
  {
    id: 'creator-1',
    ownerUid: 'u-creator',
    name: 'Aarav Studios',
    handle: '@aarav',
    language: 'hi',
    followersCount: 120,
    storiesCount: 1,
    verified: true,
  },
  {
    id: 'creator-2',
    ownerUid: 'u-creator-2',
    name: 'Meera Audio',
    handle: '@meera',
    language: 'en',
    followersCount: 80,
    storiesCount: 1,
    verified: false,
  },
];

const STORIES: Story[] = [
  {
    id: 'story-1',
    slug: 'bhangarh',
    title: 'Bhangarh Echoes',
    titleHi: 'भानगढ़ की गूंज',
    synopsis: 'Haunted fort',
    synopsisHi: 'भूतिया किला',
    genreId: 'horror',
    language: 'hi',
    creatorId: 'creator-1',
    creatorOwnerUid: 'u-creator',
    creatorName: 'Aarav Studios',
    coverTheme: 'horror-amber',
    rating: 4.8,
    totalPlays: 500,
    episodeCount: 2,
    isTrending: true,
    isEditorsPick: true,
    isPopular: true,
    isFeatured: true,
    visibility: 'published',
    format: 'audio',
    isInteractive: false,
    publishedAt: '2026-04-01T00:00:00Z',
  },
  {
    id: 'story-2',
    slug: 'kaalchakra',
    title: 'Kaalchakra',
    titleHi: 'कालचक्र',
    synopsis: 'Mythic time loop',
    synopsisHi: 'पौराणिक चक्र',
    genreId: 'mythology',
    language: 'en',
    creatorId: 'creator-2',
    creatorOwnerUid: 'u-creator-2',
    creatorName: 'Meera Audio',
    coverTheme: 'mythology-gold',
    rating: 4.7,
    totalPlays: 300,
    episodeCount: 1,
    isTrending: false,
    isEditorsPick: false,
    isPopular: true,
    isFeatured: false,
    visibility: 'published',
    format: 'hybrid',
    isInteractive: true,
    publishedAt: '2026-05-01T00:00:00Z',
  },
];

const EPISODES: Episode[] = [
  {
    id: 'ep-1',
    storyId: 'story-1',
    creatorOwnerUid: 'u-creator',
    episodeNumber: 2,
    title: 'Night Gate',
    titleHi: 'रात्रि द्वार',
    durationSec: 400,
    priceCoins: 20,
    mediaRef: { provider: 'demo', id: 'ep-1', type: 'audio' },
    publishedAt: '2026-04-02T00:00:00Z',
  },
  {
    id: 'ep-2',
    storyId: 'story-2',
    creatorOwnerUid: 'u-creator-2',
    episodeNumber: 3,
    title: 'The Wheel Turns',
    titleHi: 'चक्र घूमता है',
    durationSec: 500,
    priceCoins: 30,
    mediaRef: { provider: 'demo', id: 'ep-2', type: 'audio' },
    publishedAt: '2026-05-02T00:00:00Z',
  },
];

const USERS: UserProfile[] = [
  {
    uid: 'u1',
    email: 'ananya@example.com',
    displayName: 'Ananya',
    preferredLanguage: 'hi',
    role: 'user',
    avatarInitials: 'AN',
    warningCount: 1,
    banned: false,
  },
  {
    uid: 'u2',
    email: 'rohan@example.com',
    displayName: '=SUM(A1:A2)',
    preferredLanguage: 'en',
    role: 'user',
    avatarInitials: 'RO',
    warningCount: 3,
    banned: true,
    banReason: 'Exceeded 3 warnings',
  },
];

const WALLETS: CoinWallet[] = [
  { uid: 'u1', balance: 60, lifetimePurchased: 100, lifetimeSpent: 40, updatedAt: NOW },
  { uid: 'u2', balance: 70, lifetimePurchased: 100, lifetimeSpent: 30, updatedAt: NOW },
];

const TRANSACTIONS: CoinTransaction[] = [
  {
    id: 'tx-1',
    uid: 'u1',
    type: 'purchase',
    amount: 100,
    balanceAfter: 100,
    episodeId: null,
    storyId: null,
    creatorId: null,
    createdAt: NOW - 2 * DAY,
    note: 'Starter Pack',
  },
  {
    id: 'tx-2',
    uid: 'u1',
    type: 'spend',
    amount: -20,
    balanceAfter: 80,
    episodeId: 'ep-1',
    storyId: 'story-1',
    creatorId: 'creator-1',
    createdAt: NOW - 2 * DAY + 1000,
    note: 'Unlock Ep 2',
  },
  {
    id: 'tx-3',
    uid: 'u2',
    type: 'purchase',
    amount: 100,
    balanceAfter: 100,
    episodeId: null,
    storyId: null,
    creatorId: null,
    createdAt: NOW - 1 * DAY,
    note: 'Starter Pack',
  },
  {
    id: 'tx-4',
    uid: 'u2',
    type: 'spend',
    amount: -30,
    balanceAfter: 70,
    episodeId: 'ep-2',
    storyId: 'story-2',
    creatorId: 'creator-2',
    createdAt: NOW - 1 * DAY + 500,
    note: 'Unlock Ep 3',
  },
  {
    id: 'tx-old',
    uid: 'u1',
    type: 'spend',
    amount: -20,
    balanceAfter: 60,
    episodeId: 'ep-1',
    storyId: 'story-1',
    creatorId: 'creator-1',
    createdAt: NOW - 45 * DAY,
    note: 'Older unlock outside 30d',
  },
];

const HISTORY: ListeningHistoryEntry[] = [
  {
    id: 'h1',
    userId: 'u1',
    storyId: 'story-1',
    episodeId: 'ep-1',
    episodeNumber: 2,
    positionSec: 120,
    durationSec: 400,
    completed: false,
    updatedAt: NOW - 2 * DAY + 5000,
  },
  {
    id: 'h2',
    userId: 'u2',
    storyId: 'story-1',
    episodeId: 'ep-1',
    episodeNumber: 2,
    positionSec: 400,
    durationSec: 400,
    completed: true,
    updatedAt: NOW - 1 * DAY + 1000,
  },
  {
    id: 'h3',
    userId: 'u2',
    storyId: 'story-2',
    episodeId: 'ep-2',
    episodeNumber: 3,
    positionSec: 250,
    durationSec: 500,
    completed: false,
    updatedAt: NOW - 1 * DAY + 2000,
  },
];

const SESSIONS: SessionLogEntry[] = [
  {
    id: 's1',
    uid: 'u2',
    deviceId: 'dev-1',
    eventType: 'violation_ban',
    warningCountAfter: 3,
    bannedAfter: true,
    note: 'Warning 3 of 3: auto-banned',
    createdAt: NOW - 1000,
  },
];

test('computeAdminAnalyticsReport aggregates KPIs, breakdowns, conversion, and respects 30d date filter', () => {
  const report = computeAdminAnalyticsReport({
    source: 'server',
    transactions: TRANSACTIONS,
    history: HISTORY,
    wallets: WALLETS,
    users: USERS,
    stories: STORIES,
    episodes: EPISODES,
    creators: CREATORS,
    categories: CATEGORIES,
    preset: '30d',
    granularity: 'daily',
    nowMs: NOW,
  });

  // tx-old (45d ago) must be excluded in 30d range
  assert.equal(report.kpis.totalPurchasedCoins, 200);
  assert.equal(report.kpis.totalSpentCoins, 50);
  assert.equal(report.kpis.balanceOutstandingCoins, 130); // 60 + 70
  assert.equal(report.kpis.totalUnlocks, 2);
  assert.equal(report.kpis.totalTrackedPlays, 3);
  assert.equal(report.kpis.activeSpenders, 2);
  assert.equal(report.kpis.bannedUsers, 1);
  assert.equal(report.kpis.overallConversionPct, 66.7);

  // Spend by story sorted descending (story-2: 30, story-1: 20)
  assert.equal(report.spendByStory[0].id, 'story-2');
  assert.equal(report.spendByStory[0].coinsSpent, 30);
  assert.equal(report.spendByStory[0].sharePct, 60);
  assert.equal(report.spendByStory[1].id, 'story-1');
  assert.equal(report.spendByStory[1].coinsSpent, 20);

  // Spend by genre, creator, language
  assert.equal(report.spendByGenre[0].label, 'Mythology');
  assert.equal(report.spendByCreator[0].label, 'Meera Audio');
  assert.equal(report.spendByLanguage[0].label, 'English');

  // Conversion for story-1: 1 unlock vs 2 plays = 50%
  const story1Conv = report.conversionByStory.find((c) => c.storyId === 'story-1');
  assert.ok(story1Conv);
  assert.equal(story1Conv.trackedPlays, 2);
  assert.equal(story1Conv.unlockCount, 1);
  assert.equal(story1Conv.conversionRatePct, 50);
});

test('getTimeBucketKeyAndLabel groups daily, weekly (ISO Monday), and monthly buckets accurately', () => {
  const wed = Date.UTC(2026, 4, 20, 15, 0, 0); // Wed May 20 2026 -> Mon is May 18
  assert.equal(getTimeBucketKeyAndLabel(wed, 'daily').key, '2026-05-20');
  assert.equal(getTimeBucketKeyAndLabel(wed, 'weekly').key, '2026-05-18');
  assert.equal(getTimeBucketKeyAndLabel(wed, 'monthly').key, '2026-05');
});

test('computePerUserAnalytics builds spend grouped by story/episode, listening history, and sessions', () => {
  const detail = computePerUserAnalytics({
    user: USERS[1],
    wallet: WALLETS[1],
    transactions: TRANSACTIONS,
    history: HISTORY,
    sessions: SESSIONS,
    stories: STORIES,
    episodes: EPISODES,
  });

  assert.equal(detail.uid, 'u2');
  assert.equal(detail.balance, 70);
  assert.equal(detail.banned, true);
  assert.equal(detail.warningCount, 3);
  assert.equal(detail.spendByStory.length, 1);
  assert.equal(detail.spendByStory[0].storyTitle, 'Kaalchakra');
  assert.equal(detail.spendByStory[0].totalCoins, 30);
  assert.equal(detail.listeningHistory.length, 2);
  assert.equal(detail.sessions.length, 1);
});

test('computeUserMyCoinsAnalytics aggregates a listener own spending by story and over time', () => {
  const u1Tx = TRANSACTIONS.filter((tx) => tx.uid === 'u1');
  const mine = computeUserMyCoinsAnalytics({
    transactions: u1Tx,
    stories: STORIES,
    episodes: EPISODES,
    granularity: 'monthly',
  });

  assert.equal(mine.totalPurchased, 100);
  assert.equal(mine.totalSpent, 40);
  assert.equal(mine.storiesSupportedCount, 1);
  assert.equal(mine.episodesUnlockedCount, 2);
  assert.equal(mine.spendByStory[0].storyTitle, 'Bhangarh Echoes');
  assert.equal(mine.spendByStory[0].coinsSpent, 40);
  assert.equal(mine.timeSeries.length, 2); // Apr 2026 & May 2026
});

test('CSV escaping neutralizes spreadsheet formula injection and handles commas/quotes', () => {
  assert.equal(escapeCsvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(escapeCsvCell('+1+2'), "'+1+2");
  assert.equal(escapeCsvCell('-cmd'), "'-cmd");
  assert.equal(escapeCsvCell('@evil'), "'@evil");
  assert.equal(escapeCsvCell('Hello, "World"'), '"Hello, ""World"""');

  const report = computeAdminAnalyticsReport({
    source: 'server',
    transactions: TRANSACTIONS,
    history: HISTORY,
    wallets: WALLETS,
    users: USERS,
    stories: STORIES,
    episodes: EPISODES,
    creators: CREATORS,
    categories: CATEGORIES,
    preset: 'all',
    granularity: 'daily',
    nowMs: NOW,
  });

  const { csv } = buildAdminAnalyticsCsv('top_spenders', report);
  assert.ok(csv.includes("'=SUM(A1:A2)"));

  const userCsv = buildPerUserAnalyticsCsv(
    computePerUserAnalytics({
      user: USERS[0],
      wallet: WALLETS[0],
      transactions: TRANSACTIONS,
      history: HISTORY,
      sessions: SESSIONS,
      stories: STORIES,
      episodes: EPISODES,
    })
  );
  assert.ok(userCsv.csv.includes('Transaction ID'));
  assert.ok(userCsv.csv.includes('tx-2'));
});
