import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Category, Creator, Episode, Story } from '../../types';
import { getSafeErrorMessage } from '../../utils/validation';
import { DEFAULT_ECONOMY_SETTINGS } from '../access/episodeAccess';
import { DEFAULT_COIN_PACKAGES } from '../payments/PaymentProvider';
import { db, handleFirestoreError, OperationType } from './config';
import {
  SEED_CATEGORIES,
  SEED_CREATORS,
  SEED_EPISODES,
  SEED_STORIES,
} from './seedData';

export const CATALOG_QUERY_LIMITS = {
  categories: 50,
  creators: 100,
  stories: 60,
  episodes: 360,
} as const;

export interface CatalogBundle {
  categories: Category[];
  creators: Creator[];
  stories: Story[];
  episodes: Episode[];
  source: 'firestore' | 'seed-fallback';
  error?: string;
}

export interface PaginatedStoriesResult {
  stories: Story[];
  lastCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

function timestampToIso(val: unknown, fallback: string): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return fallback;
}

/**
 * Loads the story catalog using plain Firestore queries (zero AI).
 * If Cloud Firestore has not been seeded yet, gracefully returns the local seed
 * catalog and tags `source: 'seed-fallback'` so the UI stays 100% functional
 * and transparent.
 */
export async function fetchCatalog(): Promise<CatalogBundle> {
  try {
    const [catSnap, creatorSnap, storySnap, epSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'categories'),
          where('isActive', '==', true),
          limit(CATALOG_QUERY_LIMITS.categories)
        )
      ),
      getDocs(
        query(
          collection(db, 'creators'),
          where('followersCount', '>=', 0),
          limit(CATALOG_QUERY_LIMITS.creators)
        )
      ),
      getDocs(
        query(
          collection(db, 'stories'),
          where('visibility', '==', 'published'),
          limit(CATALOG_QUERY_LIMITS.stories)
        )
      ),
      getDocs(
        query(
          collection(db, 'episodes'),
          where('episodeNumber', '>=', 1),
          limit(CATALOG_QUERY_LIMITS.episodes)
        )
      ),
    ]);

    if (storySnap.empty) {
      return {
        categories: SEED_CATEGORIES,
        creators: SEED_CREATORS,
        stories: SEED_STORIES,
        episodes: SEED_EPISODES,
        source: 'seed-fallback',
      };
    }

    const categories: Category[] = catSnap.docs
      .map((d) => d.data() as Category)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const creators: Creator[] = creatorSnap.docs.map((d) => d.data() as Creator);

    const seedStoriesById = new Map(SEED_STORIES.map((s) => [s.id, s]));
    const seedEpisodesById = new Map(SEED_EPISODES.map((e) => [e.id, e]));

    const stories: Story[] = storySnap.docs
      .filter((d) => d.data().isDeleted !== true)
      .map((d) => {
        const raw = d.data() as Story;
        const seedMatch = seedStoriesById.get(raw.id);
        const base: Story = {
          ...raw,
          publishedAt: timestampToIso(raw.publishedAt, new Date().toISOString()),
          createdAt: timestampToIso(raw.createdAt, new Date().toISOString()),
          updatedAt: timestampToIso(raw.updatedAt, new Date().toISOString()),
        };
        if (seedMatch?.isInteractive) {
          const isLegacyStory = !base.isInteractive;
          return {
            ...base,
            synopsis: isLegacyStory ? seedMatch.synopsis : base.synopsis,
            synopsisHi: isLegacyStory ? seedMatch.synopsisHi : base.synopsisHi,
            format: seedMatch.format,
            isInteractive: true,
            episodeCount: Math.max(base.episodeCount, seedMatch.episodeCount),
          };
        }
        return base;
      });

    const activeStoryIds = new Set(stories.map((s) => s.id));
    const firestoreEpisodeIds = new Set<string>();
    const episodes: Episode[] = epSnap.docs
      .filter((d) => {
        const raw = d.data();
        if (raw.isDeleted === true) return false;
        if (typeof raw.storyId === 'string' && !activeStoryIds.has(raw.storyId)) return false;
        return true;
      })
      .map((d) => {
        const raw = d.data() as Episode & { accessTier?: string };
        firestoreEpisodeIds.add(raw.id);
        const seedMatch = seedEpisodesById.get(raw.id);
        const resolvedPriceCoins =
          typeof raw.priceCoins === 'number' && Number.isFinite(raw.priceCoins) && raw.priceCoins >= 0
            ? Math.floor(raw.priceCoins)
            : seedMatch
              ? seedMatch.priceCoins
              : raw.accessTier === 'premium'
                ? 20
                : raw.accessTier === 'daily_unlock'
                  ? 10
                  : 0;
        const base: Episode = {
          ...raw,
          priceCoins: resolvedPriceCoins,
          publishedAt: timestampToIso(raw.publishedAt, new Date().toISOString()),
          createdAt: timestampToIso(raw.createdAt, new Date().toISOString()),
        };
        const isInteractiveSeedEpisode = Boolean(
          seedMatch && seedStoriesById.get(seedMatch.storyId)?.isInteractive
        );
        if (seedMatch && (isInteractiveSeedEpisode || seedMatch.choicePoint || seedMatch.isEnding || seedMatch.videoMediaRef)) {
          const isLegacyInteractiveDoc =
            isInteractiveSeedEpisode && !base.choicePoint && !base.isEnding && !base.videoMediaRef;
          return {
            ...base,
            title: isLegacyInteractiveDoc ? seedMatch.title : base.title,
            titleHi: isLegacyInteractiveDoc ? seedMatch.titleHi : base.titleHi,
            description: isLegacyInteractiveDoc ? seedMatch.description : base.description,
            descriptionHi: isLegacyInteractiveDoc ? seedMatch.descriptionHi : base.descriptionHi,
            priceCoins: isInteractiveSeedEpisode ? 0 : base.priceCoins,
            durationSec: base.choicePoint ? base.durationSec : seedMatch.durationSec,
            audioRef: base.audioRef ?? seedMatch.audioRef,
            videoMediaRef: base.videoMediaRef ?? seedMatch.videoMediaRef,
            choicePoint: base.choicePoint ?? seedMatch.choicePoint,
            isEnding: base.isEnding ?? seedMatch.isEnding,
          };
        }
        return base;
      });

    // Include newly added Phase 3 branching episodes for interactive seed stories if not yet re-seeded in Firestore
    for (const seedEp of SEED_EPISODES) {
      if (
        !firestoreEpisodeIds.has(seedEp.id) &&
        activeStoryIds.has(seedEp.storyId) &&
        seedStoriesById.get(seedEp.storyId)?.isInteractive
      ) {
        episodes.push(seedEp);
      }
    }

    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

    return {
      categories: categories.length > 0 ? categories : SEED_CATEGORIES,
      creators: creators.length > 0 ? creators : SEED_CREATORS,
      stories,
      episodes,
      source: 'firestore',
    };
  } catch (error) {
    console.warn('Firestore catalog read failed, falling back to local seed catalog:', error);
    return {
      categories: SEED_CATEGORIES,
      creators: SEED_CREATORS,
      stories: SEED_STORIES,
      episodes: SEED_EPISODES,
      source: 'seed-fallback',
      error: getSafeErrorMessage(
        error,
        'Cloud catalog temporarily unavailable — showing local seed stories.'
      ),
    };
  }
}

/**
 * Cursor-based paginated Firestore story query for large production catalogs.
 * Uses composite index `(visibility ASC, totalPlays DESC)` declared in `firestore.indexes.json`.
 */
export async function fetchStoriesPage(
  pageSize = 12,
  cursor: QueryDocumentSnapshot<DocumentData> | null = null
): Promise<PaginatedStoriesResult> {
  const safeSize = Math.max(1, Math.min(50, pageSize));
  const constraints = [
    where('visibility', '==', 'published'),
    orderBy('totalPlays', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(safeSize + 1),
  ];
  const snap = await getDocs(query(collection(db, 'stories'), ...constraints));
  const hasMore = snap.docs.length > safeSize;
  const pageDocs = hasMore ? snap.docs.slice(0, safeSize) : snap.docs;
  const stories: Story[] = pageDocs
    .filter((d) => d.data().isDeleted !== true)
    .map((d) => {
      const raw = d.data() as Story;
      return {
        ...raw,
        publishedAt: timestampToIso(raw.publishedAt, new Date().toISOString()),
        createdAt: timestampToIso(raw.createdAt, new Date().toISOString()),
        updatedAt: timestampToIso(raw.updatedAt, new Date().toISOString()),
      };
    });

  return {
    stories,
    lastCursor: pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null,
    hasMore,
  };
}

export interface SeedResult {
  categoriesWritten: number;
  creatorsWritten: number;
  storiesWritten: number;
  episodesWritten: number;
  skippedExisting: number;
}

/**
 * Admin-only Firestore seeder.
 * Writes all 8 categories, 6 creators, 12 stories (including 2 interactive branching
 * stories), and 70 episodes into Cloud Firestore strictly respecting firestore.rules.
 * Re-running upgrades existing seed stories/episodes with Phase 3 interactive metadata.
 */
export async function seedFirestoreCatalog(adminUid: string): Promise<SeedResult> {
  const result: SeedResult = {
    categoriesWritten: 0,
    creatorsWritten: 0,
    storiesWritten: 0,
    episodesWritten: 0,
    skippedExisting: 0,
  };

  try {
    const batch = writeBatch(db);

    for (const cat of SEED_CATEGORIES) {
      const ref = doc(db, 'categories', cat.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        result.skippedExisting += 1;
        continue;
      }
      batch.set(ref, {
        id: cat.id,
        slug: cat.slug,
        nameEn: cat.nameEn,
        nameHi: cat.nameHi,
        descriptionEn: cat.descriptionEn ?? '',
        descriptionHi: cat.descriptionHi ?? '',
        accentHex: cat.accentHex ?? '#E5A93C',
        sortOrder: cat.sortOrder,
        isActive: cat.isActive,
      });
      result.categoriesWritten += 1;
    }

    for (const creator of SEED_CREATORS) {
      const ref = doc(db, 'creators', creator.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        result.skippedExisting += 1;
        continue;
      }
      batch.set(ref, {
        id: creator.id,
        ownerUid: adminUid,
        name: creator.name,
        handle: creator.handle,
        bioEn: creator.bioEn ?? '',
        bioHi: creator.bioHi ?? '',
        language: creator.language,
        followersCount: creator.followersCount,
        storiesCount: creator.storiesCount,
        verified: creator.verified,
        accentPalette: creator.accentPalette ?? '#E5A93C',
      });
      result.creatorsWritten += 1;
    }

    for (const story of SEED_STORIES) {
      const ref = doc(db, 'stories', story.id);
      const snap = await getDoc(ref);
      const existingData = snap.exists() ? snap.data() : null;
      const needsInteractiveUpgrade =
        existingData &&
        (existingData.episodeCount !== story.episodeCount ||
          existingData.format !== story.format ||
          existingData.isInteractive !== story.isInteractive);

      if (existingData && !needsInteractiveUpgrade) {
        result.skippedExisting += 1;
        continue;
      }

      const payload: Record<string, unknown> = {
        id: story.id,
        slug: story.slug,
        title: story.title,
        titleHi: story.titleHi,
        synopsis: story.synopsis,
        synopsisHi: story.synopsisHi,
        genreId: story.genreId,
        language: story.language,
        creatorId: story.creatorId,
        creatorOwnerUid: existingData?.creatorOwnerUid ?? adminUid,
        creatorName: story.creatorName,
        coverTheme: story.coverTheme,
        rating: story.rating,
        totalPlays: story.totalPlays,
        episodeCount: story.episodeCount,
        isTrending: story.isTrending,
        isEditorsPick: story.isEditorsPick,
        isPopular: story.isPopular,
        isFeatured: story.isFeatured,
        visibility: story.visibility,
        format: story.format,
        isInteractive: story.isInteractive,
        publishedAt: Timestamp.fromDate(new Date(story.publishedAt)),
        createdAt: existingData?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (story.coverUrl) payload.coverUrl = story.coverUrl;
      if (story.backdropUrl) payload.backdropUrl = story.backdropUrl;
      batch.set(ref, payload);
      result.storiesWritten += 1;
    }

    const interactiveSeedStoryIds = new Set(
      SEED_STORIES.filter((s) => s.isInteractive).map((s) => s.id)
    );

    for (const ep of SEED_EPISODES) {
      const ref = doc(db, 'episodes', ep.id);
      const snap = await getDoc(ref);
      const existingData = snap.exists() ? snap.data() : null;
      const needsUpgrade =
        existingData &&
        ((ep.choicePoint && !existingData.choicePoint) ||
          (ep.videoMediaRef && !existingData.videoMediaRef) ||
          (ep.isEnding && !existingData.isEnding) ||
          (interactiveSeedStoryIds.has(ep.storyId) && existingData.title !== ep.title) ||
          typeof existingData.priceCoins !== 'number');

      if (existingData && !needsUpgrade) {
        result.skippedExisting += 1;
        continue;
      }

      const payload: Record<string, unknown> = {
        id: ep.id,
        storyId: ep.storyId,
        creatorOwnerUid: existingData?.creatorOwnerUid ?? adminUid,
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        titleHi: ep.titleHi,
        description: ep.description ?? '',
        descriptionHi: ep.descriptionHi ?? '',
        durationSec: ep.durationSec,
        priceCoins: typeof existingData?.priceCoins === 'number' ? existingData.priceCoins : ep.priceCoins,
        mediaRef: ep.mediaRef,
        publishedAt: Timestamp.fromDate(new Date(ep.publishedAt)),
        createdAt: existingData?.createdAt ?? serverTimestamp(),
      };
      if (ep.audioRef) {
        payload.audioRef = ep.audioRef;
      }
      if (ep.videoMediaRef) {
        payload.videoMediaRef = ep.videoMediaRef;
      }
      if (ep.choicePoint) {
        payload.choicePoint = ep.choicePoint;
      }
      if (typeof ep.isEnding === 'boolean') {
        payload.isEnding = ep.isEnding;
      }
      batch.set(ref, payload);
      result.episodesWritten += 1;
    }

    // Seed default admin-defined coin packages if missing
    for (const pkg of DEFAULT_COIN_PACKAGES) {
      const pkgRef = doc(db, 'coinPackages', pkg.id);
      const pkgSnap = await getDoc(pkgRef);
      if (!pkgSnap.exists()) {
        batch.set(pkgRef, {
          id: pkg.id,
          name: pkg.name,
          nameHi: pkg.nameHi ?? pkg.name,
          coins: pkg.coins,
          bonusCoins: pkg.bonusCoins,
          priceInr: pkg.priceInr,
          active: pkg.active,
          sortOrder: pkg.sortOrder,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    // Seed platformSettings/economy if missing
    const ecoRef = doc(db, 'platformSettings', 'economy');
    const ecoSnap = await getDoc(ecoRef);
    if (!ecoSnap.exists()) {
      batch.set(ecoRef, {
        id: 'economy',
        dailyFreeEnabled: DEFAULT_ECONOMY_SETTINGS.dailyFreeEnabled,
        dailyFreeLimit: DEFAULT_ECONOMY_SETTINGS.dailyFreeLimit,
        updatedByUid: adminUid,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'stories/episodes/categories/creators');
  }
}
