import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomepageSectionConfig, Story } from '../../types';
import {
  DEFAULT_SITE_SETTINGS,
  isValidHexColor,
  resolveSectionStories,
  sanitizeSafeUrl,
  sanitizeSiteSettings,
} from './siteSettingsPure';

const SAMPLE_STORIES: Story[] = [
  {
    id: 's-1',
    slug: 's1',
    title: 'Bhangarh',
    titleHi: 'भानगढ़',
    synopsis: 'Horror',
    synopsisHi: 'हॉरर',
    genreId: 'horror',
    language: 'hi',
    creatorId: 'c1',
    creatorOwnerUid: 'u1',
    creatorName: 'Studio A',
    coverTheme: 'horror-amber',
    rating: 4.9,
    totalPlays: 1000,
    episodeCount: 5,
    isTrending: true,
    isEditorsPick: false,
    isPopular: true,
    isFeatured: true,
    visibility: 'published',
    format: 'audio',
    isInteractive: false,
    publishedAt: '2026-01-10T00:00:00Z',
  },
  {
    id: 's-2',
    slug: 's2',
    title: 'Kaalchakra',
    titleHi: 'कालचक्र',
    synopsis: 'Myth',
    synopsisHi: 'पौराणिक',
    genreId: 'mythology',
    language: 'en',
    creatorId: 'c2',
    creatorOwnerUid: 'u2',
    creatorName: 'Studio B',
    coverTheme: 'mythology-gold',
    rating: 4.7,
    totalPlays: 2500,
    episodeCount: 6,
    isTrending: false,
    isEditorsPick: true,
    isPopular: true,
    isFeatured: false,
    visibility: 'published',
    format: 'hybrid',
    isInteractive: true,
    publishedAt: '2026-05-01T00:00:00Z',
  },
];

test('sanitizeSafeUrl blocks javascript: and data: URLs while allowing https and relative paths', () => {
  assert.equal(sanitizeSafeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeSafeUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeSafeUrl('//evil.example/x.png'), '');
  assert.equal(sanitizeSafeUrl('/assets/logo.png'), '/assets/logo.png');
  assert.equal(sanitizeSafeUrl('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');
});

test('isValidHexColor strictly accepts 6-digit hex codes', () => {
  assert.equal(isValidHexColor('#E5A93C'), true);
  assert.equal(isValidHexColor('#0b0b0e'), true);
  assert.equal(isValidHexColor('red'), false);
  assert.equal(isValidHexColor('#fff; background:url(x)'), false);
});

test('sanitizeSiteSettings enforces safe defaults, strips malicious URLs/colors, and keeps >=1 language enabled', () => {
  const sanitized = sanitizeSiteSettings({
    branding: {
      appNameEn: 'Custom Tales',
      logoUrl: 'javascript:evil()',
      accentHex: 'not-a-color',
    },
    languages: [
      { code: 'en', labelEn: 'English', labelNative: 'English', enabled: false },
      { code: 'hi', labelEn: 'Hindi', labelNative: 'हिंदी', enabled: false },
    ],
    defaultLanguage: 'hi',
  });

  assert.equal(sanitized.branding.appNameEn, 'Custom Tales');
  assert.equal(sanitized.branding.logoUrl, '');
  assert.equal(sanitized.branding.accentHex, DEFAULT_SITE_SETTINGS.branding.accentHex);
  assert.equal(sanitized.languages.some((l) => l.enabled), true);
  assert.equal(sanitized.defaultLanguage, 'en');
});

test('resolveSectionStories honors manual picks and pins before auto pools', () => {
  const manualSection: HomepageSectionConfig = {
    id: 'sec-manual',
    titleEn: 'Curated',
    titleHi: 'चुनिंदा',
    source: 'manual_stories',
    storyIds: ['s-2'],
    visible: true,
    sortOrder: 0,
    maxItems: 5,
  };
  assert.deepEqual(
    resolveSectionStories(manualSection, SAMPLE_STORIES).map((s) => s.id),
    ['s-2']
  );

  const pinnedTrending: HomepageSectionConfig = {
    id: 'sec-trend',
    titleEn: 'Trending',
    titleHi: 'ट्रेंडिंग',
    source: 'auto_trending',
    storyIds: ['s-2'],
    visible: true,
    sortOrder: 1,
    maxItems: 5,
  };
  assert.deepEqual(
    resolveSectionStories(pinnedTrending, SAMPLE_STORIES).map((s) => s.id),
    ['s-2', 's-1']
  );
});
