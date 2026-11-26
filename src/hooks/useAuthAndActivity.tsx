import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type ConfirmationResult, type User } from 'firebase/auth';
import type {
  BookmarkEntry,
  BookmarkTargetType,
  Category,
  CoinPackage,
  CoinTransaction,
  CoinWallet,
  ContentLanguage,
  Creator,
  CreatorRequest,
  DailyUnlockEntry,
  EconomySettings,
  Episode,
  EpisodeUnlockRecord,
  LanguageCode,
  ListeningHistoryEntry,
  PlaybackFormat,
  SiteSettings,
  Story,
  UserChoiceEntry,
  UserProfile,
} from '../types';
import {
  applySiteThemeToDocument,
  fetchSiteSettings,
  loadCachedSiteSettings,
  saveCachedSiteSettings,
} from '../services/siteSettings/siteSettingsService';
import { DEFAULT_ECONOMY_SETTINGS, getTodayDateKey } from '../services/access/episodeAccess';
import {
  fetchWalletBundle,
  purchaseCoinPackage,
  unlockEpisodeWithCoinsApi,
  type CoinRuntimeMode,
  type PurchaseCoinResult,
  type UnlockEpisodeCoinResult,
} from '../services/coins/coinService';
import {
  confirmPhoneOtpSignIn,
  deleteAccountAndData,
  resendVerificationEmail,
  signInWithEmail,
  signInWithGoogleAccount,
  signOutAccount,
  signUpWithEmail,
  startPhoneOtpSignIn,
  syncUserProfile,
  updateUserPreferredFormat,
  updateUserProfileRecord,
} from '../services/firebase/authService';
import {
  fetchCatalog,
  seedFirestoreCatalog,
  type SeedResult,
} from '../services/firebase/catalogService';
import { auth } from '../services/firebase/config';
import {
  fetchMyCreatorRequest,
  submitCreatorRequestToFirestore,
} from '../services/firebase/studioService';
import {
  buildFallbackUserProfile,
  computeBookmarkToggle,
} from '../services/firebase/activityPersistence';
import {
  deleteUserChoicesFromFirestore,
  fetchUserActivity,
  loadGuestActivity,
  loadLocalActivityForUser,
  recordDailyUnlockInFirestore,
  saveGuestActivity,
  saveListeningProgressToFirestore,
  saveLocalActivityForUser,
  saveUserChoiceToFirestore,
  toggleBookmarkInFirestore,
} from '../services/firebase/userActivityService';
import { getDownstreamChoiceIds } from '../services/interactive/storyGraph';
import { DEFAULT_COIN_PACKAGES } from '../services/payments/PaymentProvider';
import {
  DEFAULT_SUPPORT_CONTACT,
  getOrCreateDeviceId,
  loadPendingBanNotice,
  loadPendingDeviceWarning,
  logoutDeviceSession,
  registerDeviceSession,
  savePendingBanNotice,
  savePendingDeviceWarning,
  type AccountBanNotice,
  type DeviceWarningNotice,
} from '../services/session/sessionService';
import { useLanguage } from './useLanguage';

const EMPTY_WALLET: CoinWallet = {
  uid: 'guest',
  balance: 0,
  lifetimePurchased: 0,
  lifetimeSpent: 0,
  updatedAt: 0,
};

function isAccountVerified(user: User | null): boolean {
  return Boolean(user && (user.emailVerified || user.phoneNumber));
}

function isUserDisabledAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code ?? '');
  const message = String((err as { message?: unknown }).message ?? '');
  return code === 'auth/user-disabled' || message.includes('auth/user-disabled');
}

interface AppDataContextValue {
  // Auth
  firebaseUser: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  isVerifiedUser: boolean;
  preferredFormat: PlaybackFormat;
  currentDeviceId: string;
  deviceWarning: DeviceWarningNotice | null;
  accountBanned: AccountBanNotice | null;
  dismissDeviceWarning: () => void;
  dismissAccountBanned: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  sendPhoneOtp: (
    rawPhone: string,
    containerElement: HTMLElement
  ) => Promise<{ confirmation: ConfirmationResult; clearRecaptcha: () => void }>;
  verifyPhoneOtp: (confirmation: ConfirmationResult, otpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshVerificationStatus: () => Promise<boolean>;
  sendVerification: () => Promise<void>;
  updateProfile: (updates: {
    displayName: string;
    bio: string;
    preferredLanguage: LanguageCode;
    preferredFormat?: PlaybackFormat;
  }) => Promise<void>;
  setPreferredFormat: (format: PlaybackFormat) => Promise<void>;
  deleteAccount: () => Promise<void>;

  // Catalog
  categories: Category[];
  creators: Creator[];
  stories: Story[];
  episodes: Episode[];
  catalogSource: 'firestore' | 'seed-fallback';
  catalogLoading: boolean;
  catalogError: string | null;
  refreshCatalog: () => Promise<void>;
  seedCatalog: () => Promise<SeedResult>;

  // Live Site Settings (Admin-editable without redeploy)
  siteSettings: SiteSettings;
  refreshSiteSettings: () => Promise<void>;
  applyLocalSiteSettings: (next: SiteSettings) => void;

  // Coin Economy (Server-Authoritative via /api/coins/*)
  wallet: CoinWallet;
  coinTransactions: CoinTransaction[];
  episodeUnlocks: EpisodeUnlockRecord[];
  coinPackages: CoinPackage[];
  economySettings: EconomySettings;
  walletMode: CoinRuntimeMode;
  walletLoading: boolean;
  refreshWallet: () => Promise<void>;
  buyCoinPackage: (coinPackage: CoinPackage) => Promise<PurchaseCoinResult>;
  unlockEpisodeWithCoins: (episode: Episode, story?: Story | null) => Promise<UnlockEpisodeCoinResult>;

  // User Activity & Creator Request
  history: ListeningHistoryEntry[];
  bookmarks: BookmarkEntry[];
  dailyUnlocks: DailyUnlockEntry[];
  userChoices: UserChoiceEntry[];
  creatorRequest: CreatorRequest | null;
  saveProgress: (entry: Omit<ListeningHistoryEntry, 'id' | 'userId' | 'updatedAt'>) => Promise<void>;
  toggleBookmark: (targetType: BookmarkTargetType, targetId: string) => Promise<boolean>;
  isBookmarked: (targetType: BookmarkTargetType, targetId: string) => boolean;
  claimDailyUnlock: (storyId: string, episodeId: string) => Promise<DailyUnlockEntry>;
  recordUserChoice: (
    entry: Omit<UserChoiceEntry, 'id' | 'userId' | 'chosenAt'>
  ) => Promise<UserChoiceEntry>;
  pruneStoryChoicesFromEpisode: (storyId: string, fromEpisodeId: string) => Promise<void>;
  submitCreatorRequest: (form: {
    studioName: string;
    handle: string;
    language: ContentLanguage;
    pitch: string;
    sampleLink?: string;
  }) => Promise<CreatorRequest>;
  refreshProfileAndRequest: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang, setLang } = useLanguage();

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Single-device enforcement state
  const [currentDeviceId] = useState<string>(() => getOrCreateDeviceId());
  const [deviceWarning, setDeviceWarning] = useState<DeviceWarningNotice | null>(() =>
    loadPendingDeviceWarning()
  );
  const [accountBanned, setAccountBanned] = useState<AccountBanNotice | null>(() =>
    loadPendingBanNotice()
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [catalogSource, setCatalogSource] = useState<'firestore' | 'seed-fallback'>('seed-fallback');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(() => loadCachedSiteSettings());

  // Coin Economy state
  const [wallet, setWallet] = useState<CoinWallet>(EMPTY_WALLET);
  const [coinTransactions, setCoinTransactions] = useState<CoinTransaction[]>([]);
  const [episodeUnlocks, setEpisodeUnlocks] = useState<EpisodeUnlockRecord[]>([]);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>(DEFAULT_COIN_PACKAGES);
  const [economySettings, setEconomySettings] = useState<EconomySettings>(DEFAULT_ECONOMY_SETTINGS);
  const [walletMode, setWalletMode] = useState<CoinRuntimeMode>('local-demo');
  const [walletLoading, setWalletLoading] = useState(true);

  const [history, setHistory] = useState<ListeningHistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [dailyUnlocks, setDailyUnlocks] = useState<DailyUnlockEntry[]>([]);
  const [userChoices, setUserChoices] = useState<UserChoiceEntry[]>([]);
  const [preferredFormat, setPreferredFormatState] = useState<PlaybackFormat>('audio');
  const [creatorRequest, setCreatorRequest] = useState<CreatorRequest | null>(null);

  const isVerifiedUser = isAccountVerified(firebaseUser);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    const bundle = await fetchCatalog();
    setCategories(bundle.categories);
    setCreators(bundle.creators);
    setStories(bundle.stories);
    setEpisodes(bundle.episodes);
    setCatalogSource(bundle.source);
    setCatalogError(bundle.error ?? null);
    setCatalogLoading(false);
  }, []);

  const refreshSiteSettings = useCallback(async () => {
    const loaded = await fetchSiteSettings();
    setSiteSettings(loaded);
  }, []);

  const applyLocalSiteSettings = useCallback((next: SiteSettings) => {
    setSiteSettings(next);
    saveCachedSiteSettings(next);
  }, []);

  useEffect(() => {
    void refreshCatalog();
    void refreshSiteSettings();
  }, [refreshCatalog, refreshSiteSettings]);

  useEffect(() => {
    applySiteThemeToDocument(siteSettings, lang);
  }, [siteSettings, lang]);

  const hydrationRunIdRef = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;

  const loadWalletForUser = useCallback(async (user: User | null, runId?: number) => {
    setWalletLoading(true);
    try {
      const bundle = await fetchWalletBundle(user);
      if (typeof runId === 'number' && hydrationRunIdRef.current !== runId) return;
      setWallet(bundle.wallet);
      setCoinTransactions(bundle.transactions);
      setEpisodeUnlocks(bundle.unlocks);
      setCoinPackages(bundle.packages);
      setEconomySettings(bundle.economySettings);
      setWalletMode(bundle.mode);
    } finally {
      if (typeof runId !== 'number' || hydrationRunIdRef.current === runId) {
        setWalletLoading(false);
      }
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    await loadWalletForUser(firebaseUser);
  }, [firebaseUser, loadWalletForUser]);

  const dismissDeviceWarning = useCallback(() => {
    savePendingDeviceWarning(null);
    setDeviceWarning(null);
  }, []);

  const dismissAccountBanned = useCallback(() => {
    savePendingBanNotice(null);
    setAccountBanned(null);
  }, []);

  const triggerBannedNotice = useCallback(
    (details?: Partial<AccountBanNotice>) => {
      const notice: AccountBanNotice = {
        warningCount: typeof details?.warningCount === 'number' ? details.warningCount : 3,
        banReason:
          details?.banReason?.trim() ||
          'This account has been banned and disabled by Dhruv Tales.',
        supportContact: details?.supportContact || DEFAULT_SUPPORT_CONTACT,
        occurredAt: Date.now(),
      };
      savePendingDeviceWarning(null);
      setDeviceWarning(null);
      savePendingBanNotice(notice);
      setAccountBanned(notice);
    },
    []
  );

  const hydrateAuthenticatedUser = useCallback(
    async (user: User, runId: number) => {
      const fallbackProfile = buildFallbackUserProfile(user, langRef.current);
      setProfile((prev) => (prev && prev.uid === user.uid ? prev : fallbackProfile));

      // Step 0: Server-side single-device enforcement (applies across Google, Email, and Phone)
      let confirmedActiveDevice = fallbackProfile.activeDevice ?? null;
      let confirmedWarningCount: number | null = null;
      try {
        const regResult = await registerDeviceSession(user);
        if (hydrationRunIdRef.current !== runId) return;

        if (regResult.status === 'violation_warning') {
          const notice: DeviceWarningNotice = {
            warningCount: regResult.warningCount,
            maxWarnings: regResult.maxWarnings,
            activeDeviceLabel: regResult.activeDeviceLabel,
            message: regResult.message,
            occurredAt: Date.now(),
          };
          savePendingDeviceWarning(notice);
          setDeviceWarning(notice);
          await signOutAccount();
          return;
        }

        if (regResult.status === 'banned') {
          triggerBannedNotice({
            warningCount: regResult.warningCount,
            banReason: regResult.banReason,
            supportContact: regResult.supportContact,
          });
          await signOutAccount();
          return;
        }

        if (regResult.status === 'token_revoked') {
          await signOutAccount();
          return;
        }

        if (regResult.status === 'active') {
          confirmedActiveDevice = regResult.activeDevice;
          confirmedWarningCount = regResult.warningCount;
          savePendingDeviceWarning(null);
          setDeviceWarning(null);
          savePendingBanNotice(null);
          setAccountBanned(null);
        }
      } catch (err) {
        console.warn('Could not register device session via /api/session/register:', err);
      }

      // Step 1: Sync users/{uid} independently
      try {
        const synced = await syncUserProfile(user, langRef.current);
        if (hydrationRunIdRef.current !== runId) return;

        if (synced.banned) {
          triggerBannedNotice({
            warningCount: synced.warningCount ?? 3,
            banReason:
              synced.banReason ??
              'Account banned after exceeding 3 concurrent device warnings.',
          });
          await signOutAccount();
          return;
        }

        const mergedProfile: UserProfile = {
          ...synced,
          activeDevice: confirmedActiveDevice ?? synced.activeDevice ?? null,
          warningCount: confirmedWarningCount ?? synced.warningCount ?? 0,
        };
        setProfile(mergedProfile);
        if (mergedProfile.preferredLanguage) {
          setLang(mergedProfile.preferredLanguage);
        }
        setPreferredFormatState(mergedProfile.preferredFormat === 'video' ? 'video' : 'audio');
      } catch (err) {
        console.warn('Could not sync Firestore user profile; using Auth identity fallback:', err);
      }

      // Step 2: Hydrate personal activity, creator request, and coin wallet in parallel
      const localCache = loadLocalActivityForUser(user.uid);
      const [activity, req] = await Promise.all([
        fetchUserActivity(user.uid),
        fetchMyCreatorRequest(user.uid),
        loadWalletForUser(user, runId),
      ]);
      if (hydrationRunIdRef.current !== runId) return;

      const verified = isAccountVerified(user);
      const failed = new Set(activity.failedCollections);
      const useLocalFallback = (
        key: 'listeningHistory' | 'bookmarks' | 'dailyUnlocks' | 'userChoices'
      ) => !verified || failed.has(key);

      const resolvedHistory = useLocalFallback('listeningHistory')
        ? localCache.history
        : activity.history;
      const resolvedBookmarks = useLocalFallback('bookmarks')
        ? localCache.bookmarks
        : activity.bookmarks;
      const resolvedUnlocks = useLocalFallback('dailyUnlocks')
        ? localCache.dailyUnlocks
        : activity.dailyUnlocks;
      const resolvedChoices = useLocalFallback('userChoices')
        ? localCache.userChoices
        : activity.userChoices;

      setHistory(resolvedHistory);
      setBookmarks(resolvedBookmarks);
      setDailyUnlocks(resolvedUnlocks);
      setUserChoices(resolvedChoices);
      setCreatorRequest(req);

      const merged = {
        history: resolvedHistory,
        bookmarks: resolvedBookmarks,
        dailyUnlocks: resolvedUnlocks,
        userChoices: resolvedChoices,
        preferredFormat: guestStateRef.current.preferredFormat,
      };
      guestStateRef.current = merged;
      saveLocalActivityForUser(user.uid, merged);
    },
    [loadWalletForUser, setLang, triggerBannedNotice]
  );

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const runId = ++hydrationRunIdRef.current;
      setFirebaseUser(user);
      if (user) {
        await hydrateAuthenticatedUser(user, runId);
      } else {
        setProfile(null);
        setCreatorRequest(null);
        const guest = loadGuestActivity();
        setHistory(guest.history);
        setBookmarks(guest.bookmarks);
        setDailyUnlocks(guest.dailyUnlocks);
        setUserChoices(guest.userChoices);
        setPreferredFormatState(guest.preferredFormat);
        guestStateRef.current = guest;
        await loadWalletForUser(null, runId);
      }
      if (hydrationRunIdRef.current === runId) {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, [hydrateAuthenticatedUser, loadWalletForUser]);

  const guestStateRef = useRef({
    history,
    bookmarks,
    dailyUnlocks,
    userChoices,
    preferredFormat,
  });

  useEffect(() => {
    guestStateRef.current = {
      history,
      bookmarks,
      dailyUnlocks,
      userChoices,
      preferredFormat,
    };
  }, [history, bookmarks, dailyUnlocks, userChoices, preferredFormat]);

  const syncGuest = useCallback(
    (overrides?: {
      history?: ListeningHistoryEntry[];
      bookmarks?: BookmarkEntry[];
      dailyUnlocks?: DailyUnlockEntry[];
      userChoices?: UserChoiceEntry[];
      preferredFormat?: PlaybackFormat;
    }) => {
      const merged = {
        history: overrides?.history ?? guestStateRef.current.history,
        bookmarks: overrides?.bookmarks ?? guestStateRef.current.bookmarks,
        dailyUnlocks: overrides?.dailyUnlocks ?? guestStateRef.current.dailyUnlocks,
        userChoices: overrides?.userChoices ?? guestStateRef.current.userChoices,
        preferredFormat: overrides?.preferredFormat ?? guestStateRef.current.preferredFormat,
      };
      guestStateRef.current = merged;
      if (firebaseUser) {
        saveLocalActivityForUser(firebaseUser.uid, merged);
      } else {
        saveGuestActivity(merged);
      }
    },
    [firebaseUser]
  );

  const loginWithGoogle = useCallback(async () => {
    try {
      await signInWithGoogleAccount();
    } catch (err) {
      if (isUserDisabledAuthError(err)) {
        triggerBannedNotice({
          banReason:
            'This account has been disabled or banned. Contact support to appeal.',
        });
        return;
      }
      throw err;
    }
  }, [triggerBannedNotice]);

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        await signInWithEmail(email, password);
      } catch (err) {
        if (isUserDisabledAuthError(err)) {
          triggerBannedNotice({
            banReason:
              'This account has been disabled or banned. Contact support to appeal.',
          });
          return;
        }
        throw err;
      }
    },
    [triggerBannedNotice]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      await signUpWithEmail(email, password, displayName);
    },
    []
  );

  const sendPhoneOtp = useCallback(
    async (rawPhone: string, containerElement: HTMLElement) => {
      return startPhoneOtpSignIn(rawPhone, containerElement);
    },
    []
  );

  const verifyPhoneOtp = useCallback(
    async (confirmation: ConfirmationResult, otpCode: string) => {
      try {
        await confirmPhoneOtpSignIn(confirmation, otpCode);
      } catch (err) {
        if (isUserDisabledAuthError(err)) {
          triggerBannedNotice({
            banReason:
              'This account has been disabled or banned. Contact support to appeal.',
          });
          return;
        }
        throw err;
      }
    },
    [triggerBannedNotice]
  );

  const logout = useCallback(async () => {
    await logoutDeviceSession(auth.currentUser ?? firebaseUser);
    await signOutAccount();
  }, [firebaseUser]);

  const sendVerification = useCallback(async () => {
    if (!firebaseUser) return;
    await resendVerificationEmail(firebaseUser);
  }, [firebaseUser]);

  const refreshVerificationStatus = useCallback(async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    const refreshed = auth.currentUser;
    setFirebaseUser(refreshed);
    if (isAccountVerified(refreshed)) {
      const runId = ++hydrationRunIdRef.current;
      await hydrateAuthenticatedUser(refreshed, runId);
      return true;
    }
    return false;
  }, [hydrateAuthenticatedUser]);

  const setPreferredFormat = useCallback(
    async (format: PlaybackFormat) => {
      setPreferredFormatState(format);
      setProfile((prev) => (prev ? { ...prev, preferredFormat: format } : prev));
      syncGuest({ preferredFormat: format });

      if (isAccountVerified(firebaseUser) && firebaseUser) {
        try {
          await updateUserPreferredFormat(firebaseUser.uid, format);
        } catch (err) {
          console.warn('Could not persist preferredFormat to Firestore:', err);
        }
      }
    },
    [firebaseUser, syncGuest]
  );

  const updateProfile = useCallback(
    async (updates: {
      displayName: string;
      bio: string;
      preferredLanguage: LanguageCode;
      preferredFormat?: PlaybackFormat;
    }) => {
      if (!firebaseUser || !isAccountVerified(firebaseUser)) {
        throw new Error('Please verify your account before saving profile changes.');
      }
      await updateUserProfileRecord(firebaseUser.uid, updates);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              displayName: updates.displayName.trim().slice(0, 80),
              bio: updates.bio.trim().slice(0, 300),
              preferredLanguage: updates.preferredLanguage,
              preferredFormat: updates.preferredFormat ?? prev.preferredFormat ?? 'audio',
            }
          : prev
      );
      if (updates.preferredFormat) {
        setPreferredFormatState(updates.preferredFormat);
      }
      setLang(updates.preferredLanguage);
    },
    [firebaseUser, setLang]
  );

  const deleteAccount = useCallback(async () => {
    if (!auth.currentUser) return;
    await deleteAccountAndData(auth.currentUser);
    setProfile(null);
    setHistory([]);
    setBookmarks([]);
    setDailyUnlocks([]);
    setUserChoices([]);
    setWallet(EMPTY_WALLET);
    setCoinTransactions([]);
    setEpisodeUnlocks([]);
  }, []);

  const seedCatalog = useCallback(async () => {
    if (!firebaseUser || profile?.role !== 'admin') {
      throw new Error('Admin privileges required to seed Cloud Firestore.');
    }
    const res = await seedFirestoreCatalog(firebaseUser.uid);
    await Promise.all([refreshCatalog(), refreshWallet()]);
    return res;
  }, [firebaseUser, profile, refreshCatalog, refreshWallet]);

  const buyCoinPackage = useCallback(
    async (coinPackage: CoinPackage): Promise<PurchaseCoinResult> => {
      const result = await purchaseCoinPackage(firebaseUser, coinPackage);
      setWallet(result.wallet);
      setWalletMode(result.mode);
      if (result.transactions.length > 0) {
        setCoinTransactions((prev) => {
          const existingIds = new Set(prev.map((tx) => tx.id));
          const fresh = result.transactions.filter((tx) => !existingIds.has(tx.id));
          return [...fresh.slice().reverse(), ...prev];
        });
      }
      return result;
    },
    [firebaseUser]
  );

  const unlockEpisodeWithCoins = useCallback(
    async (episode: Episode, story?: Story | null): Promise<UnlockEpisodeCoinResult> => {
      const result = await unlockEpisodeWithCoinsApi(firebaseUser, episode, story);
      setWalletMode(result.mode);
      if (result.wallet) {
        setWallet(result.wallet);
      }
      if (result.transaction) {
        setCoinTransactions((prev) => {
          if (prev.some((tx) => tx.id === result.transaction!.id)) return prev;
          return [result.transaction!, ...prev];
        });
      }
      if (result.unlock) {
        setEpisodeUnlocks((prev) => {
          if (prev.some((u) => u.episodeId === result.unlock!.episodeId)) return prev;
          return [result.unlock!, ...prev];
        });
      }
      return result;
    },
    [firebaseUser]
  );

  const saveProgress = useCallback(
    async (entry: Omit<ListeningHistoryEntry, 'id' | 'userId' | 'updatedAt'>) => {
      const uid = firebaseUser?.uid ?? 'guest';
      const id = `${uid}_${entry.episodeId}`.slice(0, 128);
      const safeDur = Math.max(
        1,
        Math.min(86400, Math.round(Number.isFinite(entry.durationSec) ? entry.durationSec : 1))
      );
      const safePos = Math.max(
        0,
        Math.min(safeDur, Math.round(Number.isFinite(entry.positionSec) ? entry.positionSec : 0))
      );
      const optimistic: ListeningHistoryEntry = {
        id,
        userId: uid,
        ...entry,
        positionSec: safePos,
        durationSec: safeDur,
        updatedAt: Date.now(),
      };

      const nextHistory = [
        optimistic,
        ...guestStateRef.current.history.filter((h) => h.episodeId !== entry.episodeId),
      ];
      setHistory(nextHistory);
      syncGuest({ history: nextHistory });

      if (firebaseUser && isAccountVerified(firebaseUser)) {
        try {
          await saveListeningProgressToFirestore(firebaseUser.uid, {
            ...entry,
            positionSec: safePos,
            durationSec: safeDur,
          });
        } catch (err) {
          console.warn('Could not persist listening progress to Firestore:', err);
        }
      }
    },
    [firebaseUser, syncGuest]
  );

  const isBookmarked = useCallback(
    (targetType: BookmarkTargetType, targetId: string) =>
      bookmarks.some((b) => b.targetType === targetType && b.targetId === targetId),
    [bookmarks]
  );

  const toggleBookmark = useCallback(
    async (targetType: BookmarkTargetType, targetId: string) => {
      const uid = firebaseUser?.uid ?? 'guest';
      const prevBookmarks = guestStateRef.current.bookmarks;
      const { currentlyActive, nextActive, nextBookmarks } = computeBookmarkToggle(
        prevBookmarks,
        uid,
        targetType,
        targetId
      );

      setBookmarks(nextBookmarks);
      syncGuest({ bookmarks: nextBookmarks });

      if (firebaseUser && isAccountVerified(firebaseUser)) {
        try {
          await toggleBookmarkInFirestore(firebaseUser.uid, targetType, targetId, currentlyActive);
        } catch (err) {
          console.warn('Could not persist bookmark toggle to Firestore:', err);
          setBookmarks(prevBookmarks);
          syncGuest({ bookmarks: prevBookmarks });
          return currentlyActive;
        }
      }

      return nextActive;
    },
    [firebaseUser, syncGuest]
  );

  const claimDailyUnlock = useCallback(
    async (storyId: string, episodeId: string) => {
      const uid = firebaseUser?.uid ?? 'guest';
      const unlockDate = getTodayDateKey();
      const entry: DailyUnlockEntry = {
        id: `${uid}_${episodeId}`,
        userId: uid,
        storyId,
        episodeId,
        unlockDate,
        createdAt: Date.now(),
      };

      setDailyUnlocks((prev) => {
        const next = [entry, ...prev.filter((d) => d.episodeId !== episodeId)];
        syncGuest({ dailyUnlocks: next });
        return next;
      });

      if (firebaseUser && isAccountVerified(firebaseUser)) {
        return recordDailyUnlockInFirestore(firebaseUser.uid, storyId, episodeId);
      }
      return entry;
    },
    [firebaseUser, syncGuest]
  );

  const recordUserChoice = useCallback(
    async (entry: Omit<UserChoiceEntry, 'id' | 'userId' | 'chosenAt'>) => {
      const uid = firebaseUser?.uid ?? 'guest';
      const id = `${uid}_${entry.storyId}_${entry.episodeId}`;
      const optimistic: UserChoiceEntry = {
        id,
        userId: uid,
        ...entry,
        chosenAt: Date.now(),
      };

      setUserChoices((prev) => {
        const next = [
          ...prev.filter((c) => !(c.storyId === entry.storyId && c.episodeId === entry.episodeId)),
          optimistic,
        ];
        syncGuest({ userChoices: next });
        return next;
      });

      if (firebaseUser && isAccountVerified(firebaseUser)) {
        return saveUserChoiceToFirestore(firebaseUser.uid, entry);
      }
      return optimistic;
    },
    [firebaseUser, syncGuest]
  );

  const pruneStoryChoicesFromEpisode = useCallback(
    async (storyId: string, fromEpisodeId: string) => {
      const storyEpisodes = episodes.filter((e) => e.storyId === storyId);
      const storyChoices = userChoices.filter((c) => c.storyId === storyId);
      const idsToDelete = getDownstreamChoiceIds(fromEpisodeId, storyEpisodes, storyChoices);

      if (idsToDelete.length === 0) return;
      const removeSet = new Set(idsToDelete);

      setUserChoices((prev) => {
        const next = prev.filter((c) => !removeSet.has(c.id));
        syncGuest({ userChoices: next });
        return next;
      });

      if (firebaseUser && isAccountVerified(firebaseUser)) {
        await deleteUserChoicesFromFirestore(idsToDelete);
      }
    },
    [episodes, userChoices, firebaseUser, syncGuest]
  );

  const submitCreatorRequest = useCallback(
    async (form: {
      studioName: string;
      handle: string;
      language: ContentLanguage;
      pitch: string;
      sampleLink?: string;
    }): Promise<CreatorRequest> => {
      if (!firebaseUser || !isAccountVerified(firebaseUser) || !profile) {
        throw new Error('Sign in with a verified account to submit a Creator application.');
      }
      const created = await submitCreatorRequestToFirestore(profile, form);
      setCreatorRequest(created);
      return created;
    },
    [firebaseUser, profile]
  );

  const refreshProfileAndRequest = useCallback(async () => {
    if (!firebaseUser) return;
    const [synced, req] = await Promise.all([
      syncUserProfile(firebaseUser, lang),
      fetchMyCreatorRequest(firebaseUser.uid),
    ]);
    setProfile(synced);
    setCreatorRequest(req);
  }, [firebaseUser, lang]);

  return (
    <AppDataContext.Provider
      value={{
        firebaseUser,
        profile,
        authReady,
        isVerifiedUser,
        preferredFormat,
        currentDeviceId,
        deviceWarning,
        accountBanned,
        dismissDeviceWarning,
        dismissAccountBanned,
        loginWithGoogle,
        loginWithEmail,
        registerWithEmail,
        sendPhoneOtp,
        verifyPhoneOtp,
        logout,
        refreshVerificationStatus,
        sendVerification,
        updateProfile,
        setPreferredFormat,
        deleteAccount,
        categories,
        creators,
        stories,
        episodes,
        catalogSource,
        catalogLoading,
        catalogError,
        refreshCatalog,
        seedCatalog,
        siteSettings,
        refreshSiteSettings,
        applyLocalSiteSettings,
        wallet,
        coinTransactions,
        episodeUnlocks,
        coinPackages,
        economySettings,
        walletMode,
        walletLoading,
        refreshWallet,
        buyCoinPackage,
        unlockEpisodeWithCoins,
        history,
        bookmarks,
        dailyUnlocks,
        userChoices,
        creatorRequest,
        saveProgress,
        toggleBookmark,
        isBookmarked,
        claimDailyUnlock,
        recordUserChoice,
        pruneStoryChoicesFromEpisode,
        submitCreatorRequest,
        refreshProfileAndRequest,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return ctx;
}
