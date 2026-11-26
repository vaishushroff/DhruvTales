import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Timestamp, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type {
  AnalyticsDateRangePreset,
  AnalyticsTimeGranularity,
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
  computeAdminAnalyticsReport,
  computePerUserAnalytics,
  resolveDateRangeBounds,
} from '../_lib/analyticsEngine';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import {
  isValidFirestoreDocId,
  mapFirestoreCoinTransaction,
  mapFirestoreEpisode,
  mapFirestoreUserProfile,
  mapFirestoreWallet,
  timestampToMs,
} from '../_lib/firestoreModels';

const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';
const PAGE_SIZE = 500;
const MAX_PAGES = 20; // Hard cap: 10,000 docs per collection per request

async function isAdminActor(uid: string, email: string | undefined): Promise<boolean> {
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true;
  const db = getAdminDb();
  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  return adminSnap.exists || userSnap.data()?.role === 'admin';
}

function getQueryString(req: VercelRequest, key: string): string {
  const raw = req.query?.[key];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  return typeof raw === 'string' ? raw.trim() : '';
}

async function fetchPaginatedDocs(
  baseQuery: Query,
  maxPages = MAX_PAGES
): Promise<{ docs: QueryDocumentSnapshot[]; truncated: boolean }> {
  const collected: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    let q = baseQuery.limit(PAGE_SIZE);
    if (cursor) {
      q = q.startAfter(cursor);
    }
    const snap = await q.get();
    if (snap.empty) break;
    collected.push(...snap.docs);
    if (snap.docs.length < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
    if (page === maxPages - 1) {
      truncated = true;
    }
  }

  return { docs: collected, truncated };
}

function mapStoryDoc(id: string, raw: Record<string, unknown>): Story {
  return {
    id: String(raw.id ?? id),
    slug: String(raw.slug ?? id),
    title: String(raw.title ?? id),
    titleHi: String(raw.titleHi ?? raw.title ?? id),
    synopsis: String(raw.synopsis ?? ''),
    synopsisHi: String(raw.synopsisHi ?? ''),
    genreId: String(raw.genreId ?? 'uncategorized'),
    language:
      raw.language === 'hi' || raw.language === 'en' || raw.language === 'bilingual'
        ? raw.language
        : 'bilingual',
    creatorId: String(raw.creatorId ?? ''),
    creatorOwnerUid: String(raw.creatorOwnerUid ?? ''),
    creatorName: String(raw.creatorName ?? ''),
    coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined,
    backdropUrl: typeof raw.backdropUrl === 'string' ? raw.backdropUrl : undefined,
    coverTheme: (raw.coverTheme as Story['coverTheme']) ?? 'mythology-gold',
    rating: Number(raw.rating ?? 4.5),
    totalPlays: Number(raw.totalPlays ?? 0),
    episodeCount: Number(raw.episodeCount ?? 0),
    isTrending: Boolean(raw.isTrending),
    isEditorsPick: Boolean(raw.isEditorsPick),
    isPopular: Boolean(raw.isPopular),
    isFeatured: Boolean(raw.isFeatured),
    visibility:
      raw.visibility === 'published' || raw.visibility === 'draft' || raw.visibility === 'archived'
        ? raw.visibility
        : 'published',
    format:
      raw.format === 'audio' || raw.format === 'video' || raw.format === 'hybrid'
        ? raw.format
        : 'audio',
    isInteractive: Boolean(raw.isInteractive),
    priceOverrideCoins:
      typeof raw.priceOverrideCoins === 'number' && Number.isFinite(raw.priceOverrideCoins)
        ? Math.max(0, Math.floor(raw.priceOverrideCoins))
        : null,
    isDeleted: Boolean(raw.isDeleted),
    publishedAt: new Date(timestampToMs(raw.publishedAt, Date.now())).toISOString(),
  };
}

function mapHistoryDoc(id: string, raw: Record<string, unknown>): ListeningHistoryEntry {
  return {
    id: String(raw.id ?? id),
    userId: String(raw.userId ?? ''),
    storyId: String(raw.storyId ?? ''),
    storyOwnerUid: typeof raw.storyOwnerUid === 'string' ? raw.storyOwnerUid : undefined,
    episodeId: String(raw.episodeId ?? ''),
    episodeNumber: Number(raw.episodeNumber ?? 1),
    positionSec: Number(raw.positionSec ?? 0),
    durationSec: Number(raw.durationSec ?? 0),
    completed: Boolean(raw.completed),
    updatedAt: timestampToMs(raw.updatedAt, Date.now()),
  };
}

function mapSessionDoc(id: string, raw: Record<string, unknown>): SessionLogEntry {
  const rawInfo =
    raw.deviceInfo && typeof raw.deviceInfo === 'object'
      ? (raw.deviceInfo as Record<string, unknown>)
      : null;
  return {
    id: String(raw.id ?? id),
    uid: String(raw.uid ?? ''),
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : null,
    deviceInfo: rawInfo
      ? {
          label: typeof rawInfo.label === 'string' ? rawInfo.label : 'Web Browser',
          platform: typeof rawInfo.platform === 'string' ? rawInfo.platform : undefined,
        }
      : null,
    eventType: (raw.eventType as SessionLogEntry['eventType']) ?? 'login_registered',
    warningCountAfter: Number(raw.warningCountAfter ?? 0),
    bannedAfter: Boolean(raw.bannedAfter),
    note: String(raw.note ?? ''),
    createdAt: timestampToMs(raw.createdAt, Date.now()),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/admin/analytics.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const isAdmin = await isAdminActor(decoded!.uid, decoded!.email);
    if (!isAdmin) {
      res.status(403).json({
        code: 'admin_only',
        error: 'Only Administrators can access platform analytics.',
      });
      return;
    }

    const rawRange = getQueryString(req, 'range');
    const preset: AnalyticsDateRangePreset =
      rawRange === '7d' ||
      rawRange === '30d' ||
      rawRange === '90d' ||
      rawRange === 'all' ||
      rawRange === 'custom'
        ? rawRange
        : '30d';

    const rawGranularity = getQueryString(req, 'granularity');
    const granularity: AnalyticsTimeGranularity =
      rawGranularity === 'daily' || rawGranularity === 'weekly' || rawGranularity === 'monthly'
        ? rawGranularity
        : preset === '90d' || preset === 'all'
          ? 'weekly'
          : 'daily';

    const fromParam = getQueryString(req, 'from');
    const toParam = getQueryString(req, 'to');
    const customStartMs = fromParam ? Date.parse(fromParam) : null;
    const customEndMs = toParam ? Date.parse(`${toParam}T23:59:59.999Z`) : null;
    const nowMs = Date.now();
    const { startMs, endMs } = resolveDateRangeBounds(preset, nowMs, customStartMs, customEndMs);

    const db = getAdminDb();
    const userIdParam = getQueryString(req, 'userId');

    // Per-user deep-dive query mode
    if (userIdParam) {
      if (!isValidFirestoreDocId(userIdParam)) {
        res.status(400).json({ code: 'invalid_user', error: 'Provide a valid userId.' });
        return;
      }

      const [userSnap, walletSnap, storiesSnap, episodesSnap] = await Promise.all([
        db.collection('users').doc(userIdParam).get(),
        db.collection('wallets').doc(userIdParam).get(),
        db.collection('stories').get(),
        db.collection('episodes').get(),
      ]);

      if (!userSnap.exists) {
        res.status(404).json({ code: 'user_not_found', error: 'User profile not found.' });
        return;
      }

      const user = mapFirestoreUserProfile(userIdParam, userSnap.data())!;
      const wallet = mapFirestoreWallet(userIdParam, walletSnap.data());
      const stories = storiesSnap.docs.map((d) => mapStoryDoc(d.id, d.data()));
      const episodes = episodesSnap.docs.map((d) => mapFirestoreEpisode(d.id, d.data()));

      // Paginated per-user queries (fall back gracefully if composite index not yet built)
      const [txDocs, histDocs, sessDocs] = await Promise.all([
        fetchPaginatedDocs(
          db.collection('coinTransactions').where('uid', '==', userIdParam).orderBy('createdAt', 'desc'),
          6
        ).catch(() =>
          fetchPaginatedDocs(db.collection('coinTransactions').where('uid', '==', userIdParam), 6)
        ),
        fetchPaginatedDocs(
          db.collection('listeningHistory').where('userId', '==', userIdParam).orderBy('updatedAt', 'desc'),
          6
        ).catch(() =>
          fetchPaginatedDocs(db.collection('listeningHistory').where('userId', '==', userIdParam), 6)
        ),
        fetchPaginatedDocs(
          db.collection('sessions').where('uid', '==', userIdParam).orderBy('createdAt', 'desc'),
          4
        ).catch(() =>
          fetchPaginatedDocs(db.collection('sessions').where('uid', '==', userIdParam), 4)
        ),
      ]);

      const detail = computePerUserAnalytics({
        user,
        wallet,
        transactions: txDocs.docs.map((d) => mapFirestoreCoinTransaction(d.id, d.data())),
        history: histDocs.docs.map((d) => mapHistoryDoc(d.id, d.data())),
        sessions: sessDocs.docs.map((d) => mapSessionDoc(d.id, d.data())),
        stories,
        episodes,
        startMs,
        endMs,
      });

      res.status(200).json({ ok: true, userDetail: detail });
      return;
    }

    // Platform-wide aggregated analytics with paginated date-bounded Firestore queries
    let txQuery: Query = db.collection('coinTransactions').orderBy('createdAt', 'desc');
    let histQuery: Query = db.collection('listeningHistory').orderBy('updatedAt', 'desc');

    if (startMs !== null) {
      txQuery = txQuery.where('createdAt', '>=', Timestamp.fromMillis(startMs));
      histQuery = histQuery.where('updatedAt', '>=', Timestamp.fromMillis(startMs));
    }
    if (endMs !== null) {
      txQuery = txQuery.where('createdAt', '<=', Timestamp.fromMillis(endMs));
      histQuery = histQuery.where('updatedAt', '<=', Timestamp.fromMillis(endMs));
    }

    const [
      txResult,
      histResult,
      walletsSnap,
      usersSnap,
      storiesSnap,
      episodesSnap,
      creatorsSnap,
      categoriesSnap,
    ] = await Promise.all([
      fetchPaginatedDocs(txQuery),
      fetchPaginatedDocs(histQuery),
      db.collection('wallets').get(),
      db.collection('users').get(),
      db.collection('stories').get(),
      db.collection('episodes').get(),
      db.collection('creators').get(),
      db.collection('categories').get(),
    ]);

    const transactions: CoinTransaction[] = txResult.docs.map((d) =>
      mapFirestoreCoinTransaction(d.id, d.data())
    );
    const history: ListeningHistoryEntry[] = histResult.docs.map((d) =>
      mapHistoryDoc(d.id, d.data())
    );
    const wallets: CoinWallet[] = walletsSnap.docs.map((d) =>
      mapFirestoreWallet(d.id, d.data())
    );
    const users: UserProfile[] = usersSnap.docs
      .map((d) => mapFirestoreUserProfile(d.id, d.data()))
      .filter((u): u is UserProfile => u !== null);
    const stories: Story[] = storiesSnap.docs.map((d) => mapStoryDoc(d.id, d.data()));
    const episodes: Episode[] = episodesSnap.docs.map((d) =>
      mapFirestoreEpisode(d.id, d.data())
    );
    const creators: Creator[] = creatorsSnap.docs.map((d) => d.data() as Creator);
    const categories: Category[] = categoriesSnap.docs.map((d) => d.data() as Category);

    const report = computeAdminAnalyticsReport({
      source: 'server',
      transactions,
      history,
      wallets,
      users,
      stories,
      episodes,
      creators,
      categories,
      preset,
      granularity,
      customStartMs: startMs,
      customEndMs: endMs,
      nowMs,
      pagination: {
        transactionsScanned: transactions.length,
        historyScanned: history.length,
        truncated: txResult.truncated || histResult.truncated,
      },
    });

    res.status(200).json({ ok: true, report });
  } catch (err) {
    if (err instanceof AuthVerificationError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/admin/analytics] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to compute analytics right now.',
    });
  }
}
