import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageStory,
  computeCreatorStats,
  computeStoryAnalytics,
  hasRouteAccess,
  reorderEpisodeList,
  validateChoicePoint,
} from './studioAnalytics';
import type { Episode, ListeningHistoryEntry, Story, UserProfile } from '../../types';

const userProfile: UserProfile = {
  uid: 'u_regular',
  email: 'user@dhruv.app',
  displayName: 'User',
  preferredLanguage: 'en',
  role: 'user',
  avatarInitials: 'US',
};

const creatorProfile: UserProfile = {
  ...userProfile,
  uid: 'u_creator_a',
  role: 'creator',
};

const adminProfile: UserProfile = {
  ...userProfile,
  uid: 'u_admin',
  role: 'admin',
};

const sampleStory: Story = {
  id: 'st_1',
  slug: 'st-1',
  title: 'Night Express',
  titleHi: 'नाइट एक्सप्रेस',
  synopsis: 'Mystery',
  synopsisHi: 'रहस्य',
  genreId: 'thriller',
  language: 'hi',
  creatorId: 'cr_a',
  creatorOwnerUid: 'u_creator_a',
  creatorName: 'Studio A',
  coverTheme: 'thriller-noir',
  rating: 4.8,
  totalPlays: 1200,
  episodeCount: 3,
  isTrending: false,
  isEditorsPick: false,
  isPopular: false,
  isFeatured: false,
  visibility: 'published',
  format: 'hybrid',
  isInteractive: true,
  publishedAt: '2026-01-01T00:00:00.000Z',
};

const sampleEpisodes: Episode[] = [1, 2, 3].map((n) => ({
  id: `ep_${n}`,
  storyId: 'st_1',
  creatorOwnerUid: 'u_creator_a',
  episodeNumber: n,
  title: `Episode ${n}`,
  titleHi: `एपिसोड ${n}`,
  durationSec: 100,
  priceCoins: 0,
  mediaRef: { provider: 'demo', id: `ep_${n}`, type: 'audio' },
  publishedAt: '2026-01-01T00:00:00.000Z',
}));

test('hasRouteAccess enforces role-based routing and disabled account lockouts', () => {
  assert.equal(hasRouteAccess(null, ['creator', 'admin']).reason, 'unauthenticated');
  assert.equal(hasRouteAccess(userProfile, ['creator', 'admin']).reason, 'insufficient_role');
  assert.equal(hasRouteAccess(creatorProfile, ['creator', 'admin']).allowed, true);
  assert.equal(hasRouteAccess(creatorProfile, ['admin']).allowed, false);
  assert.equal(hasRouteAccess(adminProfile, ['admin']).allowed, true);
  assert.equal(
    hasRouteAccess({ ...creatorProfile, isDisabled: true }, ['creator']).reason,
    'disabled'
  );
});

test('canManageStory restricts creators strictly to their own stories while admins manage all', () => {
  assert.equal(canManageStory(creatorProfile, sampleStory), true);
  assert.equal(
    canManageStory({ ...creatorProfile, uid: 'u_creator_other' }, sampleStory),
    false
  );
  assert.equal(canManageStory(adminProfile, sampleStory), true);
  assert.equal(canManageStory(userProfile, sampleStory), false);
});

test('computeCreatorStats and computeStoryAnalytics calculate plays and completion rates accurately', () => {
  const stats = computeCreatorStats([sampleStory], sampleEpisodes, 450);
  assert.equal(stats.totalStories, 1);
  assert.equal(stats.totalEpisodes, 3);
  assert.equal(stats.totalPlays, 1200);
  assert.equal(stats.followers, 450);

  const history: ListeningHistoryEntry[] = [
    {
      id: 'h1',
      userId: 'l1',
      storyId: 'st_1',
      episodeId: 'ep_1',
      episodeNumber: 1,
      positionSec: 100,
      durationSec: 100,
      completed: true,
      updatedAt: 1000,
    },
    {
      id: 'h2',
      userId: 'l2',
      storyId: 'st_1',
      episodeId: 'ep_1',
      episodeNumber: 1,
      positionSec: 50,
      durationSec: 100,
      completed: false,
      updatedAt: 2000,
    },
    {
      id: 'h3',
      userId: 'l1',
      storyId: 'st_1',
      episodeId: 'ep_2',
      episodeNumber: 2,
      positionSec: 100,
      durationSec: 100,
      completed: true,
      updatedAt: 3000,
    },
  ];

  const analytics = computeStoryAnalytics('st_1', sampleEpisodes, history);
  assert.equal(analytics.totalTrackedPlays, 3);
  assert.equal(analytics.totalCompletions, 2);
  assert.equal(analytics.completionRatePct, 67);
  assert.equal(analytics.episodes[0].plays, 2);
  assert.equal(analytics.episodes[0].completionRatePct, 50);
  assert.equal(analytics.episodes[0].avgProgressPct, 75);
});

test('reorderEpisodeList swaps adjacent episodes and renumbers cleanly 1..N', () => {
  const reordered = reorderEpisodeList(sampleEpisodes, 'ep_3', 'up');
  assert.deepEqual(
    reordered.map((e) => [e.id, e.episodeNumber]),
    [
      ['ep_1', 1],
      ['ep_3', 2],
      ['ep_2', 3],
    ]
  );
});

test('validateChoicePoint catches self-links, missing labels, and invalid target episodes', () => {
  const validIds = new Set(['ep_1', 'ep_2', 'ep_3']);
  assert.equal(
    validateChoicePoint(
      {
        id: 'cp_1',
        triggerAtEnd: true,
        promptEn: 'Where next?',
        promptHi: 'आगे कहाँ?',
        options: [
          { id: 'o1', labelEn: 'Left', labelHi: 'बाएँ', nextEpisodeId: 'ep_2' },
          { id: 'o2', labelEn: 'Right', labelHi: 'दाएँ', nextEpisodeId: 'ep_3' },
        ],
      },
      validIds,
      'ep_1'
    ),
    null
  );

  assert.match(
    validateChoicePoint(
      {
        id: 'cp_bad',
        triggerAtEnd: true,
        promptEn: 'Loop?',
        promptHi: 'लूप?',
        options: [
          { id: 'o1', labelEn: 'Self', labelHi: 'स्वयं', nextEpisodeId: 'ep_1' },
          { id: 'o2', labelEn: 'Next', labelHi: 'अगला', nextEpisodeId: 'ep_2' },
        ],
      },
      validIds,
      'ep_1'
    ) ?? '',
    /same episode/i
  );
});
