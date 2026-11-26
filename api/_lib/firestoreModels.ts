import type { DocumentData } from 'firebase-admin/firestore';
import type {
  CoinPackage,
  CoinTransaction,
  CoinTransactionType,
  CoinWallet,
  DailyUnlockEntry,
  EconomySettings,
  Episode,
  EpisodeUnlockRecord,
  MediaRef,
  Story,
  UserProfile,
} from '../../src/types';
import { DEFAULT_ECONOMY_SETTINGS } from '../../src/services/access/episodeAccess';
import type { StreamFormat } from './mediaToken';

const SAFE_DOC_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidFirestoreDocId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_DOC_ID.test(id.trim());
}

export function timestampToMs(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function timestampToIso(value: unknown): string {
  const ms = timestampToMs(value, Date.now());
  return new Date(ms).toISOString();
}

function parseMediaRef(value: unknown): MediaRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const provider = raw.provider;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const type = raw.type;
  if (
    (provider === 'demo' || provider === 'drive' || provider === 'youtube' || provider === 'gcs') &&
    id.length > 0 &&
    (type === 'audio' || type === 'video')
  ) {
    return { provider, id, type };
  }
  return undefined;
}

export function mapFirestoreEpisode(id: string, data: DocumentData): Episode {
  const audioRef = parseMediaRef(data.audioRef);
  const videoMediaRef = parseMediaRef(data.videoMediaRef) ?? parseMediaRef(data.videoRef);
  const mediaRef =
    parseMediaRef(data.mediaRef) ??
    audioRef ??
    videoMediaRef ?? {
      provider: 'demo',
      id,
      type: 'audio',
    };

  let priceCoins = 0;
  if (typeof data.priceCoins === 'number' && Number.isFinite(data.priceCoins) && data.priceCoins >= 0) {
    priceCoins = Math.floor(data.priceCoins);
  } else if (data.accessTier && data.accessTier !== 'free') {
    // Graceful migration fallback for legacy docs not yet re-seeded
    priceCoins = data.accessTier === 'premium' ? 20 : 10;
  }

  return {
    id: typeof data.id === 'string' ? data.id : id,
    storyId: String(data.storyId ?? ''),
    creatorOwnerUid: typeof data.creatorOwnerUid === 'string' ? data.creatorOwnerUid : '',
    episodeNumber: Number(data.episodeNumber ?? 1),
    title: String(data.title ?? `Episode ${data.episodeNumber ?? 1}`),
    titleHi: String(data.titleHi ?? data.title ?? `एपिसोड ${data.episodeNumber ?? 1}`),
    description: typeof data.description === 'string' ? data.description : undefined,
    descriptionHi: typeof data.descriptionHi === 'string' ? data.descriptionHi : undefined,
    durationSec: Number(data.durationSec ?? 180),
    priceCoins,
    mediaRef,
    audioRef,
    videoMediaRef,
    isEnding: typeof data.isEnding === 'boolean' ? data.isEnding : undefined,
    publishedAt: timestampToIso(data.publishedAt),
    createdAt: data.createdAt ? timestampToIso(data.createdAt) : undefined,
  };
}

export function mapFirestoreStorySummary(
  id: string,
  data: DocumentData | undefined
): Pick<Story, 'id' | 'title' | 'creatorId' | 'creatorOwnerUid' | 'priceOverrideCoins'> | null {
  if (!data) return null;
  const rawOverride = data.priceOverrideCoins;
  const priceOverrideCoins =
    typeof rawOverride === 'number' && Number.isFinite(rawOverride) && rawOverride >= 0
      ? Math.floor(rawOverride)
      : null;

  return {
    id: typeof data.id === 'string' ? data.id : id,
    title: String(data.title ?? ''),
    creatorId: String(data.creatorId ?? ''),
    creatorOwnerUid: String(data.creatorOwnerUid ?? ''),
    priceOverrideCoins,
  };
}

export function mapFirestoreActiveDevice(raw: unknown): UserProfile['activeDevice'] {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const deviceId = typeof obj.deviceId === 'string' ? obj.deviceId.trim() : '';
  if (!deviceId) return null;
  const infoRaw = (obj.deviceInfo && typeof obj.deviceInfo === 'object'
    ? obj.deviceInfo
    : {}) as Record<string, unknown>;
  return {
    deviceId,
    deviceInfo: {
      label: typeof infoRaw.label === 'string' && infoRaw.label.trim() ? infoRaw.label.trim() : 'Web Browser',
      platform: typeof infoRaw.platform === 'string' ? infoRaw.platform : undefined,
      userAgent: typeof infoRaw.userAgent === 'string' ? infoRaw.userAgent : undefined,
    },
    registeredAt: timestampToMs(obj.registeredAt),
    lastSeen: timestampToMs(obj.lastSeen),
  };
}

export function mapFirestoreUserProfile(uid: string, data: DocumentData | undefined): UserProfile | null {
  if (!data) return null;
  return {
    uid: typeof data.uid === 'string' ? data.uid : uid,
    email: String(data.email ?? ''),
    phoneNumber: typeof data.phoneNumber === 'string' && data.phoneNumber.trim() ? data.phoneNumber.trim() : undefined,
    displayName: String(data.displayName ?? ''),
    bio: typeof data.bio === 'string' ? data.bio : undefined,
    preferredLanguage: data.preferredLanguage === 'hi' ? 'hi' : 'en',
    preferredFormat: data.preferredFormat === 'video' ? 'video' : 'audio',
    role:
      data.role === 'admin' || data.role === 'creator' || data.role === 'user'
        ? data.role
        : 'user',
    isDisabled: Boolean(data.isDisabled),
    warningCount:
      typeof data.warningCount === 'number' && Number.isFinite(data.warningCount)
        ? Math.max(0, Math.floor(data.warningCount))
        : 0,
    banned: Boolean(data.banned),
    bannedAt: data.bannedAt ? timestampToMs(data.bannedAt) : null,
    banReason: typeof data.banReason === 'string' ? data.banReason : null,
    activeDevice: mapFirestoreActiveDevice(data.activeDevice),
    lastSeen: data.lastSeen ? timestampToMs(data.lastSeen) : null,
    avatarInitials: String(data.avatarInitials ?? 'DT'),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export function mapFirestoreWallet(uid: string, data: DocumentData | undefined): CoinWallet {
  if (!data) {
    return {
      uid,
      balance: 0,
      lifetimePurchased: 0,
      lifetimeSpent: 0,
      updatedAt: 0,
    };
  }
  return {
    uid: typeof data.uid === 'string' ? data.uid : uid,
    balance: typeof data.balance === 'number' && Number.isFinite(data.balance) ? Math.max(0, Math.floor(data.balance)) : 0,
    lifetimePurchased:
      typeof data.lifetimePurchased === 'number' && Number.isFinite(data.lifetimePurchased)
        ? Math.max(0, Math.floor(data.lifetimePurchased))
        : 0,
    lifetimeSpent:
      typeof data.lifetimeSpent === 'number' && Number.isFinite(data.lifetimeSpent)
        ? Math.max(0, Math.floor(data.lifetimeSpent))
        : 0,
    updatedAt: timestampToMs(data.updatedAt),
  };
}

const VALID_TX_TYPES = new Set<CoinTransactionType>([
  'purchase',
  'spend',
  'admin_adjust',
  'bonus',
  'refund',
]);

export function mapFirestoreCoinTransaction(id: string, data: DocumentData): CoinTransaction {
  const rawType = String(data.type ?? 'admin_adjust') as CoinTransactionType;
  return {
    id: typeof data.id === 'string' ? data.id : id,
    uid: String(data.uid ?? ''),
    type: VALID_TX_TYPES.has(rawType) ? rawType : 'admin_adjust',
    amount: typeof data.amount === 'number' && Number.isFinite(data.amount) ? Math.trunc(data.amount) : 0,
    balanceAfter:
      typeof data.balanceAfter === 'number' && Number.isFinite(data.balanceAfter)
        ? Math.max(0, Math.floor(data.balanceAfter))
        : 0,
    episodeId: typeof data.episodeId === 'string' && data.episodeId ? data.episodeId : null,
    storyId: typeof data.storyId === 'string' && data.storyId ? data.storyId : null,
    creatorId: typeof data.creatorId === 'string' && data.creatorId ? data.creatorId : null,
    createdAt: timestampToMs(data.createdAt),
    note: String(data.note ?? ''),
  };
}

export function mapFirestoreEpisodeUnlock(id: string, data: DocumentData): EpisodeUnlockRecord {
  return {
    id: typeof data.id === 'string' ? data.id : id,
    uid: String(data.uid ?? ''),
    episodeId: String(data.episodeId ?? ''),
    storyId: String(data.storyId ?? ''),
    creatorId: String(data.creatorId ?? ''),
    pricePaidCoins:
      typeof data.pricePaidCoins === 'number' && Number.isFinite(data.pricePaidCoins)
        ? Math.max(0, Math.floor(data.pricePaidCoins))
        : 0,
    transactionId: String(data.transactionId ?? ''),
    unlockedAt: timestampToMs(data.unlockedAt),
  };
}

export function mapFirestoreCoinPackage(id: string, data: DocumentData): CoinPackage {
  return {
    id: typeof data.id === 'string' ? data.id : id,
    name: String(data.name ?? 'Coin Pack'),
    nameHi: typeof data.nameHi === 'string' && data.nameHi.trim() ? data.nameHi : undefined,
    coins: typeof data.coins === 'number' && Number.isFinite(data.coins) ? Math.max(1, Math.floor(data.coins)) : 10,
    bonusCoins:
      typeof data.bonusCoins === 'number' && Number.isFinite(data.bonusCoins)
        ? Math.max(0, Math.floor(data.bonusCoins))
        : 0,
    priceInr:
      typeof data.priceInr === 'number' && Number.isFinite(data.priceInr)
        ? Math.max(0, Math.round(data.priceInr))
        : 0,
    active: Boolean(data.active),
    sortOrder: typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder) ? data.sortOrder : 0,
    createdAt: data.createdAt ? timestampToMs(data.createdAt) : undefined,
    updatedAt: data.updatedAt ? timestampToMs(data.updatedAt) : undefined,
  };
}

export function mapFirestoreEconomySettings(data: DocumentData | undefined): EconomySettings {
  if (!data) return DEFAULT_ECONOMY_SETTINGS;
  return {
    id: 'economy',
    dailyFreeEnabled: typeof data.dailyFreeEnabled === 'boolean' ? data.dailyFreeEnabled : true,
    dailyFreeLimit:
      typeof data.dailyFreeLimit === 'number' && Number.isFinite(data.dailyFreeLimit)
        ? Math.max(0, Math.min(20, Math.floor(data.dailyFreeLimit)))
        : DEFAULT_ECONOMY_SETTINGS.dailyFreeLimit,
    updatedAt: data.updatedAt ? timestampToMs(data.updatedAt) : undefined,
    updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : undefined,
  };
}

export function mapFirestoreDailyUnlock(id: string, data: DocumentData): DailyUnlockEntry {
  return {
    id: typeof data.id === 'string' ? data.id : id,
    userId: String(data.userId ?? ''),
    storyId: String(data.storyId ?? ''),
    episodeId: String(data.episodeId ?? ''),
    unlockDate: String(data.unlockDate ?? ''),
    createdAt: timestampToMs(data.createdAt),
  };
}

/**
 * Resolves the Google Drive MediaRef for a requested playback format ('audio' | 'video').
 */
export function resolveDriveRefForFormat(
  episode: Episode,
  format: StreamFormat
): MediaRef | null {
  if (format === 'video') {
    if (episode.videoMediaRef?.provider === 'drive') {
      return episode.videoMediaRef;
    }
    if (episode.mediaRef.provider === 'drive' && episode.mediaRef.type === 'video') {
      return episode.mediaRef;
    }
    return null;
  }

  if (episode.audioRef?.provider === 'drive') {
    return episode.audioRef;
  }
  if (episode.mediaRef.provider === 'drive' && episode.mediaRef.type === 'audio') {
    return episode.mediaRef;
  }
  return null;
}

export function getDefaultMimeTypeForFormat(format: StreamFormat): string {
  return format === 'video' ? 'video/mp4' : 'audio/mpeg';
}
