import type {
  CoinPackage,
  CoinTransaction,
  CoinTransactionType,
  CoinWallet,
  Episode,
  EpisodeUnlockRecord,
  Story,
  UserRole,
} from '../../src/types';
import { resolveEffectiveEpisodePrice } from '../../src/services/access/episodeAccess';

export const MAX_COIN_PRICE = 100_000;
export const MAX_ADMIN_ADJUST_AMOUNT = 1_000_000;

export function createEmptyWallet(uid: string, nowMs: number = Date.now()): CoinWallet {
  return {
    uid,
    balance: 0,
    lifetimePurchased: 0,
    lifetimeSpent: 0,
    updatedAt: nowMs,
  };
}

export function buildEpisodeUnlockDocId(uid: string, episodeId: string): string {
  return `${uid}_${episodeId}`.slice(0, 128);
}

export function parseValidCoinPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0 || value > MAX_COIN_PRICE) {
    return null;
  }
  return value;
}

export interface PurchasePlanResult {
  nextWallet: CoinWallet;
  transactions: CoinTransaction[];
}

/**
 * Pure atomic ledger computation for buying a coin package.
 * Produces a `purchase` ledger entry for base coins and an optional `bonus` ledger entry
 * when `bonusCoins > 0`, ensuring `balanceAfter` is exact at every step.
 */
export function computePackagePurchaseMutation(params: {
  wallet: CoinWallet;
  coinPackage: CoinPackage;
  receiptId: string;
  txIdBase: string;
  nowMs?: number;
}): PurchasePlanResult {
  const nowMs = params.nowMs ?? Date.now();
  const baseCoins = Math.max(0, Math.floor(params.coinPackage.coins));
  const bonusCoins = Math.max(0, Math.floor(params.coinPackage.bonusCoins));
  if (baseCoins + bonusCoins <= 0) {
    throw new Error('Coin package must grant at least 1 coin.');
  }

  let runningBalance = Math.max(0, Math.floor(params.wallet.balance));
  const transactions: CoinTransaction[] = [];

  if (baseCoins > 0) {
    runningBalance += baseCoins;
    transactions.push({
      id: `${params.txIdBase}-buy`,
      uid: params.wallet.uid,
      type: 'purchase',
      amount: baseCoins,
      balanceAfter: runningBalance,
      episodeId: null,
      storyId: null,
      creatorId: null,
      createdAt: nowMs,
      note: `Demo purchase: ${params.coinPackage.name} (₹${params.coinPackage.priceInr}, ${params.receiptId})`,
    });
  }

  if (bonusCoins > 0) {
    runningBalance += bonusCoins;
    transactions.push({
      id: `${params.txIdBase}-bonus`,
      uid: params.wallet.uid,
      type: 'bonus',
      amount: bonusCoins,
      balanceAfter: runningBalance,
      episodeId: null,
      storyId: null,
      creatorId: null,
      createdAt: nowMs + 1,
      note: `Bonus coins from ${params.coinPackage.name} (${params.receiptId})`,
    });
  }

  const nextWallet: CoinWallet = {
    uid: params.wallet.uid,
    balance: runningBalance,
    lifetimePurchased: Math.max(0, Math.floor(params.wallet.lifetimePurchased)) + baseCoins + bonusCoins,
    lifetimeSpent: Math.max(0, Math.floor(params.wallet.lifetimeSpent)),
    updatedAt: nowMs,
  };

  return { nextWallet, transactions };
}

export type UnlockComputationOutcome =
  | {
      status: 'already_unlocked';
      effectivePrice: number;
      wallet: CoinWallet;
      unlock: EpisodeUnlockRecord | null;
    }
  | {
      status: 'free_episode';
      effectivePrice: 0;
      wallet: CoinWallet;
    }
  | {
      status: 'insufficient_balance';
      effectivePrice: number;
      currentBalance: number;
      shortfall: number;
    }
  | {
      status: 'unlocked';
      effectivePrice: number;
      nextWallet: CoinWallet;
      transaction: CoinTransaction;
      unlock: EpisodeUnlockRecord;
    };

/**
 * Pure atomic computation for permanently unlocking a paid episode with coins.
 * Guarantees:
 * - Free episodes & already-unlocked episodes NEVER deduct coins (idempotent replay).
 * - Insufficient balance fails cleanly with exact shortfall.
 * - Successful unlock atomically computes the deducted wallet, immutable `spend` ledger entry,
 *   and permanent `episodeUnlocks` record.
 */
export function computeEpisodeUnlockMutation(params: {
  wallet: CoinWallet;
  episode: Pick<Episode, 'id' | 'storyId' | 'episodeNumber' | 'title' | 'priceCoins' | 'creatorOwnerUid'>;
  story?: Pick<Story, 'id' | 'creatorId' | 'priceOverrideCoins'> | null;
  existingUnlock: EpisodeUnlockRecord | null;
  txId: string;
  nowMs?: number;
}): UnlockComputationOutcome {
  const nowMs = params.nowMs ?? Date.now();
  const effectivePrice = resolveEffectiveEpisodePrice(params.episode, params.story);

  if (effectivePrice === 0) {
    return {
      status: 'free_episode',
      effectivePrice: 0,
      wallet: params.wallet,
    };
  }

  if (params.existingUnlock) {
    return {
      status: 'already_unlocked',
      effectivePrice,
      wallet: params.wallet,
      unlock: params.existingUnlock,
    };
  }

  const currentBalance = Math.max(0, Math.floor(params.wallet.balance));
  if (currentBalance < effectivePrice) {
    return {
      status: 'insufficient_balance',
      effectivePrice,
      currentBalance,
      shortfall: effectivePrice - currentBalance,
    };
  }

  const nextBalance = currentBalance - effectivePrice;
  const creatorId = params.story?.creatorId ?? params.episode.creatorOwnerUid ?? '';

  const transaction: CoinTransaction = {
    id: params.txId,
    uid: params.wallet.uid,
    type: 'spend',
    amount: -effectivePrice,
    balanceAfter: nextBalance,
    episodeId: params.episode.id,
    storyId: params.episode.storyId,
    creatorId: creatorId || null,
    createdAt: nowMs,
    note: `Unlocked Ep ${params.episode.episodeNumber}: ${params.episode.title}`.slice(0, 300),
  };

  const unlock: EpisodeUnlockRecord = {
    id: buildEpisodeUnlockDocId(params.wallet.uid, params.episode.id),
    uid: params.wallet.uid,
    episodeId: params.episode.id,
    storyId: params.episode.storyId,
    creatorId,
    pricePaidCoins: effectivePrice,
    transactionId: transaction.id,
    unlockedAt: nowMs,
  };

  const nextWallet: CoinWallet = {
    uid: params.wallet.uid,
    balance: nextBalance,
    lifetimePurchased: Math.max(0, Math.floor(params.wallet.lifetimePurchased)),
    lifetimeSpent: Math.max(0, Math.floor(params.wallet.lifetimeSpent)) + effectivePrice,
    updatedAt: nowMs,
  };

  return {
    status: 'unlocked',
    effectivePrice,
    nextWallet,
    transaction,
    unlock,
  };
}

export interface AdminAdjustOutcome {
  ok: boolean;
  error?: string;
  nextWallet?: CoinWallet;
  transaction?: CoinTransaction;
}

/**
 * Pure computation for Admin wallet adjustment, bonus grant, or refund.
 * Blocks negative resulting balances and validates signed integer amount.
 */
export function computeAdminWalletAdjustment(params: {
  wallet: CoinWallet;
  type: Extract<CoinTransactionType, 'admin_adjust' | 'bonus' | 'refund'>;
  amount: number;
  note: string;
  txId: string;
  episodeId?: string | null;
  storyId?: string | null;
  creatorId?: string | null;
  nowMs?: number;
}): AdminAdjustOutcome {
  const nowMs = params.nowMs ?? Date.now();
  if (!Number.isInteger(params.amount) || params.amount === 0) {
    return { ok: false, error: 'Adjustment amount must be a non-zero whole number of coins.' };
  }
  if (Math.abs(params.amount) > MAX_ADMIN_ADJUST_AMOUNT) {
    return { ok: false, error: `Adjustment amount cannot exceed ${MAX_ADMIN_ADJUST_AMOUNT} coins.` };
  }
  if ((params.type === 'bonus' || params.type === 'refund') && params.amount < 0) {
    return { ok: false, error: `${params.type} adjustments must be a positive coin amount.` };
  }

  const currentBalance = Math.max(0, Math.floor(params.wallet.balance));
  const nextBalance = currentBalance + params.amount;
  if (nextBalance < 0) {
    return {
      ok: false,
      error: `Adjustment would make balance negative (current balance: ${currentBalance}).`,
    };
  }

  const cleanNote = params.note.trim().slice(0, 300) || `Admin ${params.type}`;
  const transaction: CoinTransaction = {
    id: params.txId,
    uid: params.wallet.uid,
    type: params.type,
    amount: params.amount,
    balanceAfter: nextBalance,
    episodeId: params.episodeId ?? null,
    storyId: params.storyId ?? null,
    creatorId: params.creatorId ?? null,
    createdAt: nowMs,
    note: cleanNote,
  };

  const nextWallet: CoinWallet = {
    uid: params.wallet.uid,
    balance: nextBalance,
    lifetimePurchased: Math.max(0, Math.floor(params.wallet.lifetimePurchased)),
    lifetimeSpent: Math.max(0, Math.floor(params.wallet.lifetimeSpent)),
    updatedAt: nowMs,
  };

  return { ok: true, nextWallet, transaction };
}

export interface PriceChangeCheckResult {
  allowed: boolean;
  code?: 'creator_price_locked' | 'admin_only' | 'invalid_price';
  error?: string;
}

/**
 * Shared RBAC pricing rule enforced by both API routes and mirrored in `firestore.rules`:
 * - Creators set `priceCoins` ONCE at episode creation; after creation they CANNOT change it.
 * - Admins can change any episode's `priceCoins` or any story's `priceOverrideCoins` anytime.
 */
export function validatePriceChangePermission(params: {
  actorRole: UserRole;
  target: 'episode_price' | 'story_override';
  isExistingResource: boolean;
  newPriceCoins: number | null;
}): PriceChangeCheckResult {
  if (params.target === 'story_override') {
    if (params.actorRole !== 'admin') {
      return {
        allowed: false,
        code: 'admin_only',
        error: 'Only an Admin can set or clear a story-level coin price override.',
      };
    }
    if (params.newPriceCoins !== null && parseValidCoinPrice(params.newPriceCoins) === null) {
      return {
        allowed: false,
        code: 'invalid_price',
        error: `Story price override must be null or an integer between 0 and ${MAX_COIN_PRICE}.`,
      };
    }
    return { allowed: true };
  }

  // target === 'episode_price'
  if (params.newPriceCoins === null || parseValidCoinPrice(params.newPriceCoins) === null) {
    return {
      allowed: false,
      code: 'invalid_price',
      error: `Episode priceCoins must be an integer between 0 and ${MAX_COIN_PRICE}.`,
    };
  }

  if (params.actorRole === 'admin') {
    return { allowed: true };
  }

  if (params.isExistingResource) {
    return {
      allowed: false,
      code: 'creator_price_locked',
      error:
        'Episode price is locked after upload. Creators can only set priceCoins once when creating an episode; only an Admin can change it later.',
    };
  }

  if (params.actorRole === 'creator') {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: 'admin_only',
    error: 'You do not have permission to set episode pricing.',
  };
}
