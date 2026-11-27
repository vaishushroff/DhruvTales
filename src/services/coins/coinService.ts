import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import type {
  CoinPackage,
  CoinTransaction,
  CoinTransactionType,
  CoinWallet,
  EconomySettings,
  Episode,
  EpisodeUnlockRecord,
  Story,
} from '../../types';
import {
  DEFAULT_ECONOMY_SETTINGS,
  resolveEffectiveEpisodePrice,
} from '../access/episodeAccess';
import {
  DEFAULT_COIN_PACKAGES,
  mockPaymentProvider,
  type CoinCheckoutReceipt,
} from '../payments/PaymentProvider';
import { db } from '../firebase/config';
import { buildApiUnavailableMessage, fetchApiJson } from '../api/apiClient';

const LOCAL_DEMO_WALLET_PREFIX = 'dhruv_tales_demo_coin_wallet_v1_';

export type CoinRuntimeMode = 'server' | 'local-demo';

export interface WalletBundle {
  wallet: CoinWallet;
  transactions: CoinTransaction[];
  unlocks: EpisodeUnlockRecord[];
  packages: CoinPackage[];
  economySettings: EconomySettings;
  mode: CoinRuntimeMode;
}

export interface PurchaseCoinResult {
  wallet: CoinWallet;
  transactions: CoinTransaction[];
  receipt: CoinCheckoutReceipt;
  mode: CoinRuntimeMode;
}

export interface UnlockEpisodeCoinResult {
  unlocked: boolean;
  alreadyUnlocked: boolean;
  freeEpisode?: boolean;
  insufficientBalance?: boolean;
  effectivePrice: number;
  currentBalance?: number;
  shortfall?: number;
  wallet?: CoinWallet;
  transaction?: CoinTransaction;
  unlock?: EpisodeUnlockRecord;
  error?: string;
  mode: CoinRuntimeMode;
}

interface LocalDemoCoinStore {
  wallet: CoinWallet;
  transactions: CoinTransaction[];
  unlocks: EpisodeUnlockRecord[];
}

function tsToMs(val: unknown, fallback = 0): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return fallback;
}

function emptyWallet(uid: string): CoinWallet {
  return {
    uid,
    balance: 0,
    lifetimePurchased: 0,
    lifetimeSpent: 0,
    updatedAt: 0,
  };
}

function demoStorageKey(uid: string): string {
  return `${LOCAL_DEMO_WALLET_PREFIX}${uid || 'guest'}`;
}

export function loadLocalDemoCoinStore(uid: string): LocalDemoCoinStore {
  try {
    const raw = localStorage.getItem(demoStorageKey(uid));
    if (!raw) {
      return {
        wallet: emptyWallet(uid || 'guest'),
        transactions: [],
        unlocks: [],
      };
    }
    const parsed = JSON.parse(raw) as Partial<LocalDemoCoinStore>;
    return {
      wallet: parsed.wallet ?? emptyWallet(uid || 'guest'),
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      unlocks: Array.isArray(parsed.unlocks) ? parsed.unlocks : [],
    };
  } catch {
    return {
      wallet: emptyWallet(uid || 'guest'),
      transactions: [],
      unlocks: [],
    };
  }
}

function saveLocalDemoCoinStore(uid: string, store: LocalDemoCoinStore): void {
  try {
    localStorage.setItem(demoStorageKey(uid), JSON.stringify(store));
  } catch {
    // Ignore storage errors in restricted frames
  }
}

/**
 * Loads public coin packages and economy settings from Firestore (read-only),
 * falling back to defaults when collections are not yet seeded.
 */
export async function fetchPublicEconomyConfig(): Promise<{
  packages: CoinPackage[];
  economySettings: EconomySettings;
}> {
  try {
    const [pkgSnap, ecoSnap] = await Promise.all([
      getDocs(query(collection(db, 'coinPackages'), where('active', '==', true))),
      getDoc(doc(db, 'platformSettings', 'economy')),
    ]);

    const dbPackages: CoinPackage[] = pkgSnap.docs
      .map((d) => {
        const raw = d.data();
        return {
          id: String(raw.id ?? d.id),
          name: String(raw.name ?? 'Coin Pack'),
          nameHi: typeof raw.nameHi === 'string' ? raw.nameHi : undefined,
          coins: Number(raw.coins ?? 10),
          bonusCoins: Number(raw.bonusCoins ?? 0),
          priceInr: Number(raw.priceInr ?? 0),
          active: Boolean(raw.active),
          sortOrder: Number(raw.sortOrder ?? 0),
          createdAt: tsToMs(raw.createdAt),
          updatedAt: tsToMs(raw.updatedAt),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const economySettings: EconomySettings = ecoSnap.exists()
      ? {
          id: 'economy',
          dailyFreeEnabled:
            typeof ecoSnap.data().dailyFreeEnabled === 'boolean'
              ? Boolean(ecoSnap.data().dailyFreeEnabled)
              : true,
          dailyFreeLimit:
            typeof ecoSnap.data().dailyFreeLimit === 'number'
              ? Math.max(0, Math.min(20, Math.floor(ecoSnap.data().dailyFreeLimit)))
              : DEFAULT_ECONOMY_SETTINGS.dailyFreeLimit,
          updatedAt: tsToMs(ecoSnap.data().updatedAt),
          updatedByUid:
            typeof ecoSnap.data().updatedByUid === 'string'
              ? ecoSnap.data().updatedByUid
              : undefined,
        }
      : DEFAULT_ECONOMY_SETTINGS;

    return {
      packages: dbPackages.length > 0 ? dbPackages : DEFAULT_COIN_PACKAGES,
      economySettings,
    };
  } catch {
    return {
      packages: DEFAULT_COIN_PACKAGES,
      economySettings: DEFAULT_ECONOMY_SETTINGS,
    };
  }
}

/**
 * Loads the signed-in user's wallet, immutable ledger, and permanent episode unlocks.
 * Prefers server-side `GET /api/coins/wallet` on Vercel; falls back cleanly to
 * read-only Firestore reads + local preview store when running pure `vite` locally.
 */
export async function fetchWalletBundle(user: User | null): Promise<WalletBundle> {
  const publicConfig = await fetchPublicEconomyConfig();

  if (!user) {
    const local = loadLocalDemoCoinStore('guest');
    return {
      wallet: local.wallet,
      transactions: local.transactions,
      unlocks: local.unlocks,
      packages: publicConfig.packages,
      economySettings: publicConfig.economySettings,
      mode: 'local-demo',
    };
  }

  try {
    const idToken = await user.getIdToken();
    const api = await fetchApiJson('/api/coins/wallet', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (api.available && api.status === 200) {
      return {
        wallet: (api.data.wallet as CoinWallet) ?? emptyWallet(user.uid),
        transactions: Array.isArray(api.data.transactions)
          ? (api.data.transactions as CoinTransaction[])
          : [],
        unlocks: Array.isArray(api.data.unlocks)
          ? (api.data.unlocks as EpisodeUnlockRecord[])
          : [],
        packages: Array.isArray(api.data.packages) && api.data.packages.length > 0
          ? (api.data.packages as CoinPackage[])
          : publicConfig.packages,
        economySettings:
          (api.data.economySettings as EconomySettings) ?? publicConfig.economySettings,
        mode: 'server',
      };
    }
  } catch {
    // Fall through to read-only Firestore + local preview fallback
  }

  // Read-only Firestore read (wallets/coinTransactions/episodeUnlocks are read-only for owner)
  const local = loadLocalDemoCoinStore(user.uid);
  try {
    const [walletSnap, txSnap, unlockSnap] = await Promise.all([
      getDoc(doc(db, 'wallets', user.uid)),
      getDocs(query(collection(db, 'coinTransactions'), where('uid', '==', user.uid))),
      getDocs(query(collection(db, 'episodeUnlocks'), where('uid', '==', user.uid))),
    ]);

    if (walletSnap.exists() || !txSnap.empty || !unlockSnap.empty) {
      const rawW = walletSnap.data();
      const wallet: CoinWallet = rawW
        ? {
            uid: user.uid,
            balance: Number(rawW.balance ?? 0),
            lifetimePurchased: Number(rawW.lifetimePurchased ?? 0),
            lifetimeSpent: Number(rawW.lifetimeSpent ?? 0),
            updatedAt: tsToMs(rawW.updatedAt),
          }
        : emptyWallet(user.uid);

      const transactions: CoinTransaction[] = txSnap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id ?? d.id),
            uid: String(raw.uid ?? user.uid),
            type: raw.type as CoinTransactionType,
            amount: Number(raw.amount ?? 0),
            balanceAfter: Number(raw.balanceAfter ?? 0),
            episodeId: raw.episodeId ? String(raw.episodeId) : null,
            storyId: raw.storyId ? String(raw.storyId) : null,
            creatorId: raw.creatorId ? String(raw.creatorId) : null,
            createdAt: tsToMs(raw.createdAt),
            note: String(raw.note ?? ''),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);

      const unlocks: EpisodeUnlockRecord[] = unlockSnap.docs
        .map((d) => {
          const raw = d.data();
          return {
            id: String(raw.id ?? d.id),
            uid: String(raw.uid ?? user.uid),
            episodeId: String(raw.episodeId ?? ''),
            storyId: String(raw.storyId ?? ''),
            creatorId: String(raw.creatorId ?? ''),
            pricePaidCoins: Number(raw.pricePaidCoins ?? 0),
            transactionId: String(raw.transactionId ?? ''),
            unlockedAt: tsToMs(raw.unlockedAt),
          };
        })
        .sort((a, b) => b.unlockedAt - a.unlockedAt);

      return {
        wallet,
        transactions,
        unlocks,
        packages: publicConfig.packages,
        economySettings: publicConfig.economySettings,
        mode: 'local-demo',
      };
    }
  } catch {
    // Rules or offline preview — fall back to local demo store without attempting client writes
  }

  return {
    wallet: local.wallet,
    transactions: local.transactions,
    unlocks: local.unlocks,
    packages: publicConfig.packages,
    economySettings: publicConfig.economySettings,
    mode: 'local-demo',
  };
}

/**
 * Purchases an active coin package using the Mock PaymentProvider.
 * On Vercel, calls `POST /api/coins/purchase` (server-side atomic Admin SDK transaction).
 * In local Vite-only preview (no `/api` server) or guest mode, runs the identical
 * mock ledger mutation locally in `localStorage` (NEVER writes wallets to Firestore from client).
 */
export async function purchaseCoinPackage(
  user: User | null,
  coinPackage: CoinPackage
): Promise<PurchaseCoinResult> {
  if (user) {
    const idToken = await user.getIdToken();
    const api = await fetchApiJson('/api/coins/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ packageId: coinPackage.id }),
    });

    if (api.available) {
      if (api.status !== 200) {
        throw new Error(String(api.data.error ?? 'Could not complete coin purchase.'));
      }
      return {
        wallet: api.data.wallet as CoinWallet,
        transactions: (api.data.transactions as CoinTransaction[]) ?? [],
        receipt: api.data.receipt as CoinCheckoutReceipt,
        mode: 'server',
      };
    }
  }

  // Local Vite preview or guest simulation (zero Firestore writes)
  const uid = user?.uid ?? 'guest';
  const receipt = await mockPaymentProvider.completeCoinPackagePurchase(coinPackage, uid);
  const store = loadLocalDemoCoinStore(uid);
  const nowMs = Date.now();
  const txBase = `demo_tx_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;

  let running = Math.max(0, Math.floor(store.wallet.balance));
  const createdTxs: CoinTransaction[] = [];

  if (coinPackage.coins > 0) {
    running += coinPackage.coins;
    createdTxs.push({
      id: `${txBase}-buy`,
      uid,
      type: 'purchase',
      amount: coinPackage.coins,
      balanceAfter: running,
      episodeId: null,
      storyId: null,
      creatorId: null,
      createdAt: nowMs,
      note: `Demo purchase: ${coinPackage.name} (₹${coinPackage.priceInr}, ${receipt.receiptId})`,
    });
  }

  if (coinPackage.bonusCoins > 0) {
    running += coinPackage.bonusCoins;
    createdTxs.push({
      id: `${txBase}-bonus`,
      uid,
      type: 'bonus',
      amount: coinPackage.bonusCoins,
      balanceAfter: running,
      episodeId: null,
      storyId: null,
      creatorId: null,
      createdAt: nowMs + 1,
      note: `Bonus coins from ${coinPackage.name} (${receipt.receiptId})`,
    });
  }

  const nextWallet: CoinWallet = {
    uid,
    balance: running,
    lifetimePurchased: store.wallet.lifetimePurchased + coinPackage.coins + coinPackage.bonusCoins,
    lifetimeSpent: store.wallet.lifetimeSpent,
    updatedAt: nowMs,
  };

  saveLocalDemoCoinStore(uid, {
    wallet: nextWallet,
    transactions: [...createdTxs.slice().reverse(), ...store.transactions],
    unlocks: store.unlocks,
  });

  return {
    wallet: nextWallet,
    transactions: createdTxs,
    receipt,
    mode: 'local-demo',
  };
}

/**
 * Permanently unlocks a paid episode by spending coins.
 * On Vercel, executes `POST /api/coins/unlock` atomically via Firebase Admin SDK.
 * In local Vite-only preview or guest mode, applies the identical idempotent unlock
 * against the local demo wallet (NEVER writes wallets/unlocks to Firestore from client).
 */
export async function unlockEpisodeWithCoinsApi(
  user: User | null,
  episode: Episode,
  story?: Story | null
): Promise<UnlockEpisodeCoinResult> {
  const effectivePrice = resolveEffectiveEpisodePrice(episode, story);

  if (user) {
    const idToken = await user.getIdToken();
    const api = await fetchApiJson('/api/coins/unlock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ episodeId: episode.id }),
    });

    if (api.available) {
      if (api.status === 402 || api.data.code === 'insufficient_balance') {
        return {
          unlocked: false,
          alreadyUnlocked: false,
          insufficientBalance: true,
          effectivePrice: Number(api.data.effectivePrice ?? effectivePrice),
          currentBalance: Number(api.data.currentBalance ?? 0),
          shortfall: Number(api.data.shortfall ?? effectivePrice),
          error: String(api.data.error ?? 'Insufficient coin balance.'),
          mode: 'server',
        };
      }
      if (api.status !== 200) {
        return {
          unlocked: false,
          alreadyUnlocked: false,
          effectivePrice,
          error: String(api.data.error ?? 'Could not unlock this episode.'),
          mode: 'server',
        };
      }
      return {
        unlocked: true,
        alreadyUnlocked: Boolean(api.data.alreadyUnlocked),
        freeEpisode: Boolean(api.data.freeEpisode),
        effectivePrice: Number(api.data.effectivePrice ?? effectivePrice),
        wallet: api.data.wallet as CoinWallet | undefined,
        transaction: api.data.transaction as CoinTransaction | undefined,
        unlock: api.data.unlock as EpisodeUnlockRecord | undefined,
        mode: 'server',
      };
    }
  }

  // Local Vite preview or guest simulation (zero Firestore writes)
  const uid = user?.uid ?? 'guest';
  const store = loadLocalDemoCoinStore(uid);
  if (effectivePrice === 0) {
    return {
      unlocked: true,
      alreadyUnlocked: false,
      freeEpisode: true,
      effectivePrice: 0,
      wallet: store.wallet,
      mode: 'local-demo',
    };
  }

  const existingUnlock = store.unlocks.find((u) => u.episodeId === episode.id);
  if (existingUnlock) {
    return {
      unlocked: true,
      alreadyUnlocked: true,
      effectivePrice,
      wallet: store.wallet,
      unlock: existingUnlock,
      mode: 'local-demo',
    };
  }

  if (store.wallet.balance < effectivePrice) {
    return {
      unlocked: false,
      alreadyUnlocked: false,
      insufficientBalance: true,
      effectivePrice,
      currentBalance: store.wallet.balance,
      shortfall: effectivePrice - store.wallet.balance,
      error: `You need ${effectivePrice} coins to unlock this episode.`,
      mode: 'local-demo',
    };
  }

  const nowMs = Date.now();
  const txId = `demo_spend_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;
  const nextBalance = store.wallet.balance - effectivePrice;
  const creatorId = story?.creatorId ?? episode.creatorOwnerUid ?? '';

  const transaction: CoinTransaction = {
    id: txId,
    uid,
    type: 'spend',
    amount: -effectivePrice,
    balanceAfter: nextBalance,
    episodeId: episode.id,
    storyId: episode.storyId,
    creatorId: creatorId || null,
    createdAt: nowMs,
    note: `Unlocked Ep ${episode.episodeNumber}: ${episode.title}`,
  };

  const unlock: EpisodeUnlockRecord = {
    id: `${uid}_${episode.id}`.slice(0, 128),
    uid,
    episodeId: episode.id,
    storyId: episode.storyId,
    creatorId,
    pricePaidCoins: effectivePrice,
    transactionId: txId,
    unlockedAt: nowMs,
  };

  const nextWallet: CoinWallet = {
    uid,
    balance: nextBalance,
    lifetimePurchased: store.wallet.lifetimePurchased,
    lifetimeSpent: store.wallet.lifetimeSpent + effectivePrice,
    updatedAt: nowMs,
  };

  saveLocalDemoCoinStore(uid, {
    wallet: nextWallet,
    transactions: [transaction, ...store.transactions],
    unlocks: [unlock, ...store.unlocks],
  });

  return {
    unlocked: true,
    alreadyUnlocked: false,
    effectivePrice,
    wallet: nextWallet,
    transaction,
    unlock,
    mode: 'local-demo',
  };
}

/**
 * Calls POST /api/coins/pricing (server-side RBAC check enforcing creator price lock & Admin overrides).
 */
export async function updatePricingViaApi(
  user: User,
  payload:
    | { target: 'episode_price'; episodeId: string; priceCoins: number }
    | { target: 'story_override'; storyId: string; priceCoins: number | null }
): Promise<{ usedServerApi: boolean }> {
  const idToken = await user.getIdToken();
  const api = await fetchApiJson('/api/coins/pricing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!api.available) {
    return { usedServerApi: false };
  }
  if (api.status !== 200) {
    throw new Error(String(api.data.error ?? 'Not authorized to change pricing.'));
  }
  return { usedServerApi: true };
}

/**
 * Calls POST /api/coins/admin-adjust for Admin-only wallet adjustments, bonuses, and refunds.
 * Requires the backend API server (never mutates wallets from the browser).
 */
export async function adminAdjustWalletViaApi(
  user: User,
  payload: {
    targetUid: string;
    type: Extract<CoinTransactionType, 'admin_adjust' | 'bonus' | 'refund'>;
    amount: number;
    note: string;
    episodeId?: string | null;
    storyId?: string | null;
  }
): Promise<{ wallet: CoinWallet; transaction: CoinTransaction }> {
  const idToken = await user.getIdToken();
  const api = await fetchApiJson('/api/coins/admin-adjust', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!api.available) {
    throw new Error(buildApiUnavailableMessage('/api/coins/admin-adjust', api));
  }
  if (api.status !== 200) {
    throw new Error(String(api.data.error ?? 'Failed to adjust user coin wallet.'));
  }

  return {
    wallet: api.data.wallet as CoinWallet,
    transaction: api.data.transaction as CoinTransaction,
  };
}
