import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Coins,
  FolderKanban,
  Gift,
  Globe,
  Layers,
  LogOut,
  MonitorSmartphone,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AdminAnalyticsPanel } from '../components/admin/AdminAnalyticsPanel';
import {
  AdminCreatorEditorModal,
  AdminEpisodeEditorModal,
  AdminStoryEditorModal,
  AdminUserEditModal,
} from '../components/admin/AdminContentManagers';
import { AdminSiteSettingsPanel } from '../components/admin/AdminSiteSettingsPanel';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { adminAdjustWalletViaApi, updatePricingViaApi } from '../services/coins/coinService';
import {
  adminDeleteCreatorCms,
  adminRestoreEpisode,
  adminRestoreStory,
  adminSoftDeleteEpisode,
  adminSoftDeleteStory,
} from '../services/firebase/adminCmsService';
import {
  adminChangeUserRole,
  adminDeleteCategory,
  adminDeleteCoinPackage,
  adminDeleteEpisode,
  adminDeleteStory,
  adminReviewCreatorRequest,
  adminSaveCategory,
  adminSaveCoinPackage,
  adminToggleCreatorVerified,
  adminUpdateEconomySettings,
  adminUpdateEpisodePrice,
  adminUpdateStoryModeration,
  adminUpdateStoryPriceOverride,
  fetchAdminDashboardBundle,
  type AdminDashboardBundle,
} from '../services/firebase/adminService';
import { formatInr } from '../services/payments/PaymentProvider';
import { runAdminSessionActionApi } from '../services/session/sessionService';
import { getSafeErrorMessage } from '../utils/validation';
import type {
  AdminSessionActionType,
  Category,
  CoinPackage,
  CoinTransactionType,
  Creator,
  CreatorRequest,
  Episode,
  Story,
  StoryVisibility,
  UserProfile,
  UserRole,
} from '../types';

type AdminTab =
  | 'analytics'
  | 'users'
  | 'requests'
  | 'stories'
  | 'economy'
  | 'creators'
  | 'categories'
  | 'site'
  | 'audit';

export const AdminDashboardPage: React.FC = () => {
  const { lang, t } = useLanguage();
  const {
    firebaseUser,
    profile,
    siteSettings,
    applyLocalSiteSettings,
    refreshCatalog,
    refreshWallet,
  } = useAppData();
  const { playEpisode } = useAudioPlayer();

  const [activeTab, setActiveTab] = useState<AdminTab>('analytics');
  const [inspectUserId, setInspectUserId] = useState<string | null>(null);
  const [storyViewMode, setStoryViewMode] = useState<'active' | 'trash'>('active');
  const [storyModal, setStoryModal] = useState<{ open: boolean; story: Story | null }>({
    open: false,
    story: null,
  });
  const [episodeModal, setEpisodeModal] = useState<{
    open: boolean;
    episode: Episode | null;
    defaultStoryId?: string;
  }>({ open: false, episode: null });
  const [creatorModal, setCreatorModal] = useState<{ open: boolean; creator: Creator | null }>({
    open: false,
    creator: null,
  });
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [bundle, setBundle] = useState<AdminDashboardBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters
  const [userSearch, setUserSearch] = useState('');
  const [storySearch, setStorySearch] = useState('');
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  // Coin pricing drafts
  const [episodePriceDrafts, setEpisodePriceDrafts] = useState<Record<string, string>>({});
  const [storyOverrideDrafts, setStoryOverrideDrafts] = useState<Record<string, string>>({});

  // Daily free settings form
  const [dailyFreeEnabled, setDailyFreeEnabled] = useState(true);
  const [dailyFreeLimit, setDailyFreeLimit] = useState(2);

  // Coin package modal state
  const [pkgModalOpen, setPkgModalOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState(false);
  const [pkgForm, setPkgForm] = useState<CoinPackage>({
    id: '',
    name: '',
    nameHi: '',
    coins: 100,
    bonusCoins: 10,
    priceInr: 99,
    active: true,
    sortOrder: 1,
  });

  // Admin wallet adjustment form
  const [adjTargetUid, setAdjTargetUid] = useState('');
  const [adjType, setAdjType] = useState<Extract<CoinTransactionType, 'admin_adjust' | 'bonus' | 'refund'>>('bonus');
  const [adjAmount, setAdjAmount] = useState('50');
  const [adjNote, setAdjNote] = useState('');

  // Category modal state
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  const [catForm, setCatForm] = useState<Category>({
    id: '',
    slug: '',
    nameEn: '',
    nameHi: '',
    descriptionEn: '',
    descriptionHi: '',
    accentHex: '#E5A93C',
    sortOrder: 9,
    isActive: true,
  });

  // Ban / Unban modal state
  const [sessionModal, setSessionModal] = useState<{
    mode: 'ban' | 'unban';
    user: UserProfile;
  } | null>(null);
  const [sessionModalReason, setSessionModalReason] = useState('');
  const [unbanWarningCount, setUnbanWarningCount] = useState<number>(0);

  const loadBundle = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminDashboardBundle();
      setBundle(data);
      setDailyFreeEnabled(data.economySettings.dailyFreeEnabled);
      setDailyFreeLimit(data.economySettings.dailyFreeLimit);
      setAdjTargetUid((prev) => prev || data.users[0]?.uid || '');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: getSafeErrorMessage(err, 'Unable to load Admin Dashboard data.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  useEffect(() => {
    if (!categoryModalOpen && !pkgModalOpen && !sessionModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCategoryModalOpen(false);
        setPkgModalOpen(false);
        setSessionModal(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [categoryModalOpen, pkgModalOpen, sessionModal]);

  const pendingRequestsCount = useMemo(
    () => (bundle?.creatorRequests ?? []).filter((r) => r.status === 'pending').length,
    [bundle]
  );

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const list = bundle?.users ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phoneNumber ?? '').toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [bundle, userSearch]);

  const activeStoriesCount = useMemo(
    () => (bundle?.stories ?? []).filter((s) => !s.isDeleted).length,
    [bundle]
  );

  const trashedStoriesCount = useMemo(
    () => (bundle?.stories ?? []).filter((s) => Boolean(s.isDeleted)).length,
    [bundle]
  );

  const activeEpisodesCount = useMemo(
    () => (bundle?.episodes ?? []).filter((e) => !e.isDeleted).length,
    [bundle]
  );

  const standaloneTrashedEpisodes = useMemo(() => {
    const deletedStoryIds = new Set(
      (bundle?.stories ?? []).filter((s) => Boolean(s.isDeleted)).map((s) => s.id)
    );
    return (bundle?.episodes ?? []).filter(
      (e) => Boolean(e.isDeleted) && !deletedStoryIds.has(e.storyId)
    );
  }, [bundle]);

  const filteredStories = useMemo(() => {
    const q = storySearch.trim().toLowerCase();
    const list = (bundle?.stories ?? []).filter((s) =>
      storyViewMode === 'trash' ? Boolean(s.isDeleted) : !s.isDeleted
    );
    if (!q) return list;
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.titleHi.toLowerCase().includes(q) ||
        s.creatorName.toLowerCase().includes(q) ||
        s.visibility.toLowerCase().includes(q)
    );
  }, [bundle, storySearch, storyViewMode]);

  const runAdminMutation = async (
    key: string,
    fn: () => Promise<{ summary: string }>,
    syncPublicCatalog = false
  ) => {
    setBusyId(key);
    setFeedback(null);
    try {
      const logEntry = await fn();
      await loadBundle();
      if (syncPublicCatalog) {
        await refreshCatalog();
      }
      setFeedback({ type: 'success', text: `${logEntry.summary} (Audit log recorded)` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: getSafeErrorMessage(err, 'Admin action failed.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = (target: UserProfile, nextRole: UserRole) => {
    if (!profile || target.role === nextRole) return;
    void runAdminMutation(`role-${target.uid}`, () =>
      adminChangeUserRole(profile, target, nextRole)
    );
  };

  const executeAdminSessionAction = async (
    target: UserProfile,
    action: AdminSessionActionType,
    options?: { warningCount?: number; reason?: string }
  ) => {
    if (!firebaseUser) return;
    setBusyId(`session-${action}-${target.uid}`);
    setFeedback(null);
    try {
      const res = await runAdminSessionActionApi(firebaseUser, {
        targetUid: target.uid,
        action,
        warningCount: options?.warningCount,
        reason: options?.reason,
      });
      if (!res.usedServerApi) {
        setFeedback({
          type: 'error',
          text: res.error || t('admin.sessionApiUnavailable'),
        });
        return;
      }
      await loadBundle();
      setFeedback({
        type: 'success',
        text: `${res.summary ?? 'Session action applied'} (Audit log recorded)`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: getSafeErrorMessage(err, 'Session enforcement action failed.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  const openSessionModal = (mode: 'ban' | 'unban', target: UserProfile) => {
    setSessionModal({ mode, user: target });
    setSessionModalReason('');
    setUnbanWarningCount(0);
  };

  const handleConfirmSessionModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionModal) return;
    const { mode, user } = sessionModal;
    await executeAdminSessionAction(user, mode, {
      warningCount: mode === 'unban' ? unbanWarningCount : undefined,
      reason: sessionModalReason.trim() || undefined,
    });
    setSessionModal(null);
  };

  const handleReviewRequest = (req: CreatorRequest, decision: 'approved' | 'rejected') => {
    if (!profile) return;
    const note = reviewNotes[req.id] ?? '';
    void runAdminMutation(
      `req-${req.id}`,
      () => adminReviewCreatorRequest(profile, req, decision, note),
      true
    );
  };

  const handleStoryVisibility = (story: Story, visibility: StoryVisibility) => {
    if (!profile || story.visibility === visibility) return;
    void runAdminMutation(
      `vis-${story.id}`,
      () =>
        adminUpdateStoryModeration(
          profile,
          story,
          { visibility },
          `Set "${story.title}" visibility to ${visibility}`
        ),
      true
    );
  };

  const handleStoryCuration = (
    story: Story,
    field: 'isFeatured' | 'isEditorsPick' | 'isTrending'
  ) => {
    if (!profile) return;
    const nextValue = !story[field];
    void runAdminMutation(
      `${field}-${story.id}`,
      () =>
        adminUpdateStoryModeration(
          profile,
          story,
          { [field]: nextValue },
          `Set ${field}=${String(nextValue)} on "${story.title}"`
        ),
      true
    );
  };

  const handleSoftDeleteStory = (story: Story) => {
    if (!profile || !bundle) return;
    const epIds = bundle.episodes.filter((e) => e.storyId === story.id).map((e) => e.id);
    void runAdminMutation(
      `soft-del-story-${story.id}`,
      async () => {
        await adminSoftDeleteStory(firebaseUser, profile, story, epIds);
        return { summary: `Moved "${story.title}" and ${epIds.length} episode(s) to Trash` };
      },
      true
    );
  };

  const handleRestoreStory = (story: Story) => {
    if (!profile || !bundle) return;
    const epIds = bundle.episodes.filter((e) => e.storyId === story.id).map((e) => e.id);
    void runAdminMutation(
      `restore-story-${story.id}`,
      async () => {
        await adminRestoreStory(firebaseUser, profile, story, epIds);
        return { summary: `Restored "${story.title}" from Trash as draft` };
      },
      true
    );
  };

  const handleDeleteStory = (story: Story) => {
    if (!profile || !bundle) return;
    const epIds = bundle.episodes.filter((e) => e.storyId === story.id).map((e) => e.id);
    void runAdminMutation(
      `del-story-${story.id}`,
      () => adminDeleteStory(profile, story, epIds),
      true
    );
  };

  const handleEpisodePriceSave = (ep: Episode) => {
    if (!profile) return;
    const raw = episodePriceDrafts[ep.id] ?? String(ep.priceCoins ?? 0);
    const parsed = Math.max(0, Math.min(100_000, Math.floor(Number(raw))));
    if (!Number.isFinite(parsed) || parsed < 0) return;

    void runAdminMutation(
      `ep-price-${ep.id}`,
      async () => {
        if (firebaseUser) {
          const apiRes = await updatePricingViaApi(firebaseUser, {
            target: 'episode_price',
            episodeId: ep.id,
            priceCoins: parsed,
          });
          if (apiRes.usedServerApi) {
            return {
              summary: `Updated Episode ${ep.episodeNumber} price to ${parsed} coins via /api/coins/pricing`,
            };
          }
        }
        return adminUpdateEpisodePrice(profile, ep, parsed);
      },
      true
    );
  };

  const handleStoryPriceOverride = (story: Story, nextOverride: number | null) => {
    if (!profile) return;
    void runAdminMutation(
      `story-override-${story.id}`,
      async () => {
        if (firebaseUser) {
          const apiRes = await updatePricingViaApi(firebaseUser, {
            target: 'story_override',
            storyId: story.id,
            priceCoins: nextOverride,
          });
          if (apiRes.usedServerApi) {
            return {
              summary:
                nextOverride === null
                  ? `Cleared story coin override for "${story.title}" via /api/coins/pricing`
                  : `Set story coin override for "${story.title}" to ${nextOverride} coins via /api/coins/pricing`,
            };
          }
        }
        return adminUpdateStoryPriceOverride(profile, story, nextOverride);
      },
      true
    );
  };

  const handleSaveEconomySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    await runAdminMutation(
      'economy-settings',
      async () => {
        const res = await adminUpdateEconomySettings(profile, {
          dailyFreeEnabled,
          dailyFreeLimit,
        });
        await refreshWallet();
        return res.log;
      },
      false
    );
  };

  const openAddPackage = () => {
    setEditingPkg(false);
    setPkgForm({
      id: '',
      name: '',
      nameHi: '',
      coins: 100,
      bonusCoins: 15,
      priceInr: 99,
      active: true,
      sortOrder: (bundle?.coinPackages.length ?? 0) + 1,
    });
    setPkgModalOpen(true);
  };

  const openEditPackage = (pkg: CoinPackage) => {
    setEditingPkg(true);
    setPkgForm({ ...pkg });
    setPkgModalOpen(true);
  };

  const handleSaveCoinPackage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !pkgForm.name.trim()) return;
    await runAdminMutation(
      'pkg-save',
      async () => {
        const res = await adminSaveCoinPackage(profile, pkgForm, editingPkg);
        await refreshWallet();
        return res.log;
      },
      false
    );
    setPkgModalOpen(false);
  };

  const handleTogglePackageActive = (pkg: CoinPackage) => {
    if (!profile) return;
    void runAdminMutation(
      `pkg-active-${pkg.id}`,
      async () => {
        const res = await adminSaveCoinPackage(profile, { ...pkg, active: !pkg.active }, true);
        await refreshWallet();
        return res.log;
      },
      false
    );
  };

  const handleDeleteCoinPackage = (pkg: CoinPackage) => {
    if (!profile) return;
    void runAdminMutation(
      `pkg-del-${pkg.id}`,
      async () => {
        const log = await adminDeleteCoinPackage(profile, pkg);
        await refreshWallet();
        return log;
      },
      false
    );
  };

  const handleAdminWalletAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !adjTargetUid) return;
    const parsedAmount = Math.trunc(Number(adjAmount));
    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      setFeedback({ type: 'error', text: t('admin.adjustAmountInvalid') });
      return;
    }
    if (adjNote.trim().length < 2) {
      setFeedback({ type: 'error', text: t('admin.adjustNoteRequired') });
      return;
    }

    setBusyId('wallet-adjust');
    setFeedback(null);
    try {
      const res = await adminAdjustWalletViaApi(firebaseUser, {
        targetUid: adjTargetUid,
        type: adjType,
        amount: parsedAmount,
        note: adjNote.trim(),
      });
      await Promise.all([loadBundle(), refreshWallet()]);
      setAdjNote('');
      setFeedback({
        type: 'success',
        text: `Adjusted wallet (${parsedAmount > 0 ? `+${parsedAmount}` : parsedAmount} coins). New balance: ${res.wallet.balance} coins.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: getSafeErrorMessage(err, 'Wallet adjustment failed.'),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSoftDeleteEpisode = (ep: Episode) => {
    if (!profile) return;
    void runAdminMutation(
      `ep-soft-del-${ep.id}`,
      async () => {
        await adminSoftDeleteEpisode(firebaseUser, profile, ep);
        return { summary: `Moved Episode ${ep.episodeNumber} "${ep.title}" to Trash` };
      },
      true
    );
  };

  const handleRestoreEpisode = (ep: Episode) => {
    if (!profile) return;
    void runAdminMutation(
      `ep-restore-${ep.id}`,
      async () => {
        await adminRestoreEpisode(firebaseUser, profile, ep);
        return { summary: `Restored Episode ${ep.episodeNumber} "${ep.title}" from Trash` };
      },
      true
    );
  };

  const handleDeleteEpisode = (ep: Episode) => {
    if (!profile) return;
    void runAdminMutation(`ep-del-${ep.id}`, () => adminDeleteEpisode(profile, ep), true);
  };

  const handleToggleCreatorVerified = (creator: Creator) => {
    if (!profile) return;
    void runAdminMutation(
      `creator-${creator.id}`,
      () => adminToggleCreatorVerified(profile, creator, !creator.verified),
      true
    );
  };

  const handleDeleteCreator = (creator: Creator) => {
    if (!profile) return;
    void runAdminMutation(
      `creator-del-${creator.id}`,
      async () => {
        await adminDeleteCreatorCms(firebaseUser, profile, creator);
        return { summary: `Deleted creator "${creator.name}"` };
      },
      true
    );
  };

  const handleInspectUserAnalytics = (uid: string) => {
    setInspectUserId(uid);
    setActiveTab('analytics');
  };

  const openAddCategory = () => {
    setEditingCategory(false);
    setCatForm({
      id: '',
      slug: '',
      nameEn: '',
      nameHi: '',
      descriptionEn: '',
      descriptionHi: '',
      accentHex: '#E5A93C',
      sortOrder: (bundle?.categories.length ?? 0) + 1,
      isActive: true,
    });
    setCategoryModalOpen(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(true);
    setCatForm({ ...cat });
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !catForm.nameEn.trim()) return;
    await runAdminMutation(
      `cat-save`,
      () => adminSaveCategory(profile, catForm, editingCategory),
      true
    );
    setCategoryModalOpen(false);
  };

  const handleToggleCategoryActive = (cat: Category) => {
    if (!profile) return;
    void runAdminMutation(
      `cat-vis-${cat.id}`,
      () => adminSaveCategory(profile, { ...cat, isActive: !cat.isActive }, true),
      true
    );
  };

  const handleDeleteCategory = (cat: Category) => {
    if (!profile) return;
    void runAdminMutation(`cat-del-${cat.id}`, () => adminDeleteCategory(profile, cat), true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {/* Admin Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#E5A93C] tracking-wide">
            {t('common.realBadge')} · Firestore Governance &amp; Audit Logs
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
            {t('admin.title')}
          </h1>
          <p className="text-sm text-[#A39E93] max-w-2xl leading-relaxed">{t('admin.subtitle')}</p>
        </div>

        <button
          type="button"
          onClick={() => void loadBundle()}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-[#141418] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-white/30 inline-flex items-center gap-2 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('common.refresh')}
        </button>
      </header>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl px-4 py-3 text-xs border flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-[#141418] border-[#E5A93C]/45 text-[#F3C669]'
              : 'bg-rose-950/40 border-rose-500/35 text-rose-200'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            {feedback.text}
          </span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Platform KPI Stat Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('admin.statUsers')}</span>
            <Users className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
            {bundle?.users.length ?? '—'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('admin.statStories')}</span>
            <BookOpen className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
            {bundle ? activeStoriesCount : '—'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('admin.statEpisodes')}</span>
            <Layers className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F5F3EE]">
            {bundle ? activeEpisodesCount : '—'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#A39E93]">
            <span>{t('admin.statPendingReqs')}</span>
            <ClipboardList className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
          </div>
          <p className="font-display text-3xl font-semibold text-[#F3C669]">
            {pendingRequestsCount}
          </p>
        </div>
      </section>

      {/* Admin Workspace Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.08] overflow-x-auto">
        {(
          [
            { id: 'analytics', label: t('admin.tabAnalytics'), icon: BarChart3 },
            { id: 'stories', label: t('admin.tabStories'), icon: BookOpen },
            { id: 'site', label: t('admin.tabSiteSettings'), icon: Globe },
            { id: 'economy', label: t('admin.tabEconomy'), icon: Coins },
            { id: 'users', label: t('admin.tabUsers'), icon: Users },
            {
              id: 'requests',
              label: `${t('admin.tabRequests')} (${pendingRequestsCount})`,
              icon: UserCheck,
            },
            { id: 'creators', label: t('admin.tabCreators'), icon: BadgeCheck },
            { id: 'categories', label: t('admin.tabCategories'), icon: FolderKanban },
            { id: 'audit', label: t('admin.tabAudit'), icon: ScrollText },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                active
                  ? 'border-[#E5A93C] text-[#F5F3EE]'
                  : 'border-transparent text-[#A39E93] hover:text-[#F5F3EE]'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 0: ADMIN ANALYTICS DASHBOARD */}
      {activeTab === 'analytics' && bundle && (
        <AdminAnalyticsPanel
          firebaseUser={firebaseUser}
          users={bundle.users}
          wallets={bundle.wallets}
          stories={bundle.stories}
          episodes={bundle.episodes}
          creators={bundle.creators}
          categories={bundle.categories}
          initialInspectUserId={inspectUserId}
          onClearInitialInspect={() => setInspectUserId(null)}
        />
      )}

      {/* TAB 0B: LIVE SITE SETTINGS, BANNERS, HOMEPAGE SECTIONS, LANGUAGES & LEGAL */}
      {activeTab === 'site' && profile && (
        <AdminSiteSettingsPanel
          firebaseUser={firebaseUser}
          actor={profile}
          siteSettings={siteSettings}
          stories={bundle?.stories ?? []}
          onSavedSiteSettings={applyLocalSiteSettings}
          onRefreshDashboard={async () => {
            await loadBundle();
            await refreshCatalog();
          }}
        />
      )}

      {/* TAB 1: USERS */}
      {activeTab === 'users' && (
        <section className="space-y-4">
          <div className="relative max-w-md">
            <Search
              className="w-4 h-4 text-[#8A857B] absolute left-3.5 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={t('admin.searchUsersPlaceholder')}
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141418] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#78736A] focus:outline-none focus:border-[#E5A93C]"
            />
          </div>

          <div className="rounded-2xl bg-[#141418] border border-white/[0.08] overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] bg-[#0B0B0E]/60 text-[#A39E93]">
                  <th className="py-3.5 px-5 font-medium">User</th>
                  <th className="py-3.5 px-4 font-medium">{t('admin.roleCol')}</th>
                  <th className="py-3.5 px-4 font-medium">{t('admin.deviceCol')}</th>
                  <th className="py-3.5 px-4 font-medium">{t('admin.statusCol')}</th>
                  <th className="py-3.5 px-5 font-medium text-right">{t('admin.actionsCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filteredUsers.map((u) => {
                  const isSelf = u.uid === profile?.uid;
                  const isBannedOrDisabled = Boolean(u.banned || u.isDisabled);
                  const warningCount = u.warningCount ?? 0;
                  const rowBusy = busyId?.endsWith(`-${u.uid}`) ?? false;
                  return (
                    <tr key={u.uid} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-5">
                        <p className="font-medium text-[#F5F3EE]">{u.displayName}</p>
                        <p className="text-xs text-[#8A857B]">
                          {u.email || u.phoneNumber || u.uid}
                        </p>
                        {u.email && u.phoneNumber && (
                          <p className="text-[11px] text-[#78736A]">{u.phoneNumber}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          aria-label={`Change role for ${u.email || u.phoneNumber || u.uid}`}
                          disabled={busyId === `role-${u.uid}`}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                          className="h-9 px-2.5 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE]"
                        >
                          <option value="user">user</option>
                          <option value="creator">creator</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="space-y-1 text-xs">
                          <p className="text-[#D6D2C9] inline-flex items-center gap-1.5">
                            <MonitorSmartphone
                              className="w-3.5 h-3.5 text-[#E5A93C] shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate max-w-[180px]">
                              {u.activeDevice?.deviceInfo.label ?? t('admin.noActiveDevice')}
                            </span>
                          </p>
                          <p
                            className={`tabular-nums ${
                              warningCount >= 3
                                ? 'text-rose-400 font-semibold'
                                : warningCount > 0
                                  ? 'text-[#F3C669] font-medium'
                                  : 'text-[#8A857B]'
                            }`}
                          >
                            {t('admin.warningsShort', { count: String(warningCount) })}
                          </p>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            u.banned
                              ? 'text-rose-400'
                              : u.isDisabled
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                          }`}
                        >
                          {u.banned
                            ? t('admin.bannedLabel')
                            : u.isDisabled
                              ? t('admin.disabledLabel')
                              : t('admin.activeLabel')}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleInspectUserAnalytics(u.uid)}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium border border-[#E5A93C]/35 text-[#F3C669] hover:bg-[#E5A93C]/10 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.inspectUserBtn')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingUser(u)}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium border border-white/15 text-[#D6D2C9] hover:border-white/30 hover:text-[#F5F3EE] inline-flex items-center gap-1.5 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy || isSelf}
                            onClick={() => void executeAdminSessionAction(u, 'force_logout')}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium border border-white/15 text-[#D6D2C9] hover:border-[#E5A93C]/50 hover:text-[#F5F3EE] inline-flex items-center gap-1.5 transition-colors disabled:opacity-35"
                          >
                            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.forceLogoutBtn')}
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy || warningCount === 0}
                            onClick={() => void executeAdminSessionAction(u, 'reset_warnings')}
                            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium border border-[#E5A93C]/35 text-[#F3C669] hover:bg-[#E5A93C]/10 inline-flex items-center gap-1.5 transition-colors disabled:opacity-35"
                          >
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.resetWarningsBtn')}
                          </button>
                          {isBannedOrDisabled ? (
                            <button
                              type="button"
                              disabled={rowBusy || isSelf}
                              onClick={() => openSessionModal('unban', u)}
                              className="min-h-[36px] px-3 rounded-lg text-xs font-medium border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-35"
                            >
                              {t('admin.unbanBtn')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={rowBusy || isSelf}
                              onClick={() => openSessionModal('ban', u)}
                              className="min-h-[36px] px-3 rounded-lg text-xs font-medium border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1.5 transition-colors disabled:opacity-35"
                            >
                              <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                              {t('admin.banBtn')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 2: CREATOR REQUESTS */}
      {activeTab === 'requests' && (
        <section className="space-y-4">
          {(bundle?.creatorRequests ?? []).length === 0 ? (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center text-sm text-[#A39E93]">
              {t('admin.noRequests')}
            </div>
          ) : (
            <div className="space-y-3">
              {(bundle?.creatorRequests ?? []).map((req) => (
                <div
                  key={req.id}
                  className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 text-xs">
                        <span
                          className={`font-semibold capitalize ${
                            req.status === 'pending'
                              ? 'text-[#E5A93C]'
                              : req.status === 'approved'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                          }`}
                        >
                          {req.status}
                        </span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93]">{req.handle}</span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93] uppercase">{req.language}</span>
                      </div>
                      <h3 className="font-display text-lg font-semibold text-[#F5F3EE]">
                        {req.studioName}
                      </h3>
                      <p className="text-xs text-[#8A857B]">
                        {req.userName} ({req.userEmail})
                      </p>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm text-[#D6D2C9] leading-relaxed">{req.pitch}</p>
                  {req.sampleLink && (
                    <p className="text-xs text-[#E5A93C] break-all">Sample: {req.sampleLink}</p>
                  )}

                  {req.status === 'pending' && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-2 border-t border-white/[0.06]">
                      <input
                        type="text"
                        placeholder={t('admin.reviewNotePlaceholder')}
                        value={reviewNotes[req.id] ?? ''}
                        onChange={(e) =>
                          setReviewNotes({ ...reviewNotes, [req.id]: e.target.value })
                        }
                        className="flex-1 h-10 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-xs text-[#F5F3EE]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === `req-${req.id}`}
                          onClick={() => handleReviewRequest(req, 'approved')}
                          className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669]"
                        >
                          {t('admin.approveBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === `req-${req.id}`}
                          onClick={() => handleReviewRequest(req, 'rejected')}
                          className="min-h-[40px] px-4 rounded-xl border border-rose-500/40 text-rose-300 text-xs font-semibold hover:bg-rose-500/10"
                        >
                          {t('admin.rejectBtn')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: STORIES & EPISODES CMS + SOFT-DELETE TRASH */}
      {activeTab === 'stories' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search
                className="w-4 h-4 text-[#8A857B] absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={storySearch}
                onChange={(e) => setStorySearch(e.target.value)}
                placeholder={t('admin.searchStoriesPlaceholder')}
                className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141418] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#78736A] focus:outline-none focus:border-[#E5A93C]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-[#141418] border border-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setStoryViewMode('active')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors ${
                    storyViewMode === 'active'
                      ? 'bg-[#E5A93C] text-[#0B0B0E]'
                      : 'text-[#A39E93] hover:text-[#F5F3EE]'
                  }`}
                >
                  {t('admin.activeLabel')} ({activeStoriesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStoryViewMode('trash')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors ${
                    storyViewMode === 'trash'
                      ? 'bg-rose-500/85 text-white'
                      : 'text-[#A39E93] hover:text-[#F5F3EE]'
                  }`}
                >
                  {t('admin.trashTabLabel')} ({trashedStoriesCount + standaloneTrashedEpisodes.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setStoryModal({ open: true, story: null })}
                className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('admin.newStoryBtn')}
              </button>
            </div>
          </div>

          {storyViewMode === 'trash' && filteredStories.length === 0 && standaloneTrashedEpisodes.length === 0 && (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center text-sm text-[#A39E93]">
              {t('admin.trashEmpty')}
            </div>
          )}

          <div className="space-y-3">
            {filteredStories.map((story) => {
              const allStoryEps = (bundle?.episodes ?? []).filter((e) => e.storyId === story.id);
              const activeStoryEps = allStoryEps.filter((e) => !e.isDeleted);
              const trashedStoryEps = allStoryEps.filter((e) => Boolean(e.isDeleted));
              const displayEps = storyViewMode === 'trash' ? allStoryEps : activeStoryEps;
              const expanded = expandedStoryId === story.id;
              return (
                <div
                  key={story.id}
                  className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 space-y-4"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs">
                        {story.isDeleted ? (
                          <span className="text-rose-400 font-semibold">
                            {t('admin.inTrashBadge')}
                          </span>
                        ) : (
                          <span
                            className={
                              story.visibility === 'published'
                                ? 'text-emerald-400 font-medium'
                                : story.visibility === 'draft'
                                  ? 'text-[#E5A93C] font-medium'
                                  : 'text-rose-400 font-medium'
                            }
                          >
                            {story.visibility}
                          </span>
                        )}
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93]">{story.creatorName}</span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93] uppercase">{story.language}</span>
                        <span className="text-[#55524B]">·</span>
                        <span className="text-[#A39E93] tabular-nums">
                          {displayEps.length} {t('common.episodes')}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-semibold text-[#F5F3EE] truncate">
                        {lang === 'hi' ? story.titleHi : story.title}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!story.isDeleted ? (
                        <>
                          <select
                            aria-label={`Visibility for ${story.title}`}
                            value={story.visibility}
                            onChange={(e) =>
                              handleStoryVisibility(story, e.target.value as StoryVisibility)
                            }
                            className="h-9 px-2.5 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE]"
                          >
                            <option value="published">{t('admin.publishAction')}</option>
                            <option value="draft">{t('admin.draftAction')}</option>
                            <option value="archived">{t('admin.hideAction')}</option>
                          </select>

                          <button
                            type="button"
                            onClick={() => handleStoryCuration(story, 'isFeatured')}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                              story.isFeatured
                                ? 'bg-[#E5A93C]/20 border-[#E5A93C]/60 text-[#F3C669]'
                                : 'bg-[#0B0B0E] border-white/10 text-[#A39E93]'
                            }`}
                          >
                            {t('admin.featuredLabel')}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleStoryCuration(story, 'isEditorsPick')}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                              story.isEditorsPick
                                ? 'bg-[#E5A93C]/20 border-[#E5A93C]/60 text-[#F3C669]'
                                : 'bg-[#0B0B0E] border-white/10 text-[#A39E93]'
                            }`}
                          >
                            {t('admin.editorsPickLabel')}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleStoryCuration(story, 'isTrending')}
                            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium border transition-colors ${
                              story.isTrending
                                ? 'bg-[#E5A93C]/20 border-[#E5A93C]/60 text-[#F3C669]'
                                : 'bg-[#0B0B0E] border-white/10 text-[#A39E93]'
                            }`}
                          >
                            {t('admin.trendingLabel')}
                          </button>

                          <button
                            type="button"
                            onClick={() => setStoryModal({ open: true, story })}
                            className="min-h-[36px] px-3 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE] hover:border-[#E5A93C]/50 inline-flex items-center gap-1.5"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('common.edit')}
                          </button>

                          <button
                            type="button"
                            onClick={() => setExpandedStoryId(expanded ? null : story.id)}
                            className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/10 text-xs text-[#F5F3EE]"
                          >
                            {t('admin.manageEpisodesBtn')} ({activeStoryEps.length})
                          </button>

                          <button
                            type="button"
                            disabled={busyId === `soft-del-story-${story.id}`}
                            onClick={() => handleSoftDeleteStory(story)}
                            aria-label={`${t('admin.moveToTrashBtn')} ${story.title}`}
                            title={t('admin.moveToTrashBtn')}
                            className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1 text-xs"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="hidden xl:inline">{t('admin.moveToTrashBtn')}</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busyId === `restore-story-${story.id}`}
                            onClick={() => handleRestoreStory(story)}
                            className="min-h-[36px] px-3 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.restoreBtn')}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `del-story-${story.id}`}
                            onClick={() => handleDeleteStory(story)}
                            className="min-h-[36px] px-3 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.deletePermanentlyBtn')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expandable Story Override & Episode CMS */}
                  {expanded && !story.isDeleted && (
                    <div className="pt-3 border-t border-white/[0.06] space-y-3">
                      {/* Story-Level Coin Price Override + Add Episode */}
                      <div className="rounded-xl bg-[#0B0B0E] border border-[#E5A93C]/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                          <p className="font-semibold text-[#F3C669] flex items-center gap-1.5">
                            <Coins className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                            {t('admin.storyPriceOverrideLabel')}
                          </p>
                          <p className="text-[#A39E93]">
                            {typeof story.priceOverrideCoins === 'number'
                              ? t('admin.storyOverrideActive', {
                                  price: String(story.priceOverrideCoins),
                                })
                              : t('admin.storyOverrideNone')}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={100000}
                            aria-label={`Story price override for ${story.title}`}
                            placeholder="Coins"
                            value={
                              storyOverrideDrafts[story.id] ??
                              (typeof story.priceOverrideCoins === 'number'
                                ? String(story.priceOverrideCoins)
                                : '')
                            }
                            onChange={(e) =>
                              setStoryOverrideDrafts({
                                ...storyOverrideDrafts,
                                [story.id]: e.target.value,
                              })
                            }
                            className="w-24 h-9 px-2.5 rounded-lg bg-[#141418] border border-white/15 text-xs text-[#F5F3EE] tabular-nums"
                          />
                          <button
                            type="button"
                            disabled={busyId === `story-override-${story.id}`}
                            onClick={() => {
                              const raw =
                                storyOverrideDrafts[story.id] ??
                                (typeof story.priceOverrideCoins === 'number'
                                  ? String(story.priceOverrideCoins)
                                  : '');
                              if (raw.trim() === '') return;
                              const parsed = Math.max(
                                0,
                                Math.min(100_000, Math.floor(Number(raw) || 0))
                              );
                              handleStoryPriceOverride(story, parsed);
                            }}
                            className="h-9 px-3 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50"
                          >
                            {t('admin.applyOverrideBtn')}
                          </button>
                          {typeof story.priceOverrideCoins === 'number' && (
                            <button
                              type="button"
                              disabled={busyId === `story-override-${story.id}`}
                              onClick={() => {
                                setStoryOverrideDrafts((prev) => ({ ...prev, [story.id]: '' }));
                                handleStoryPriceOverride(story, null);
                              }}
                              className="h-9 px-3 rounded-lg border border-white/15 text-xs text-[#D6D2C9] hover:text-[#F5F3EE]"
                            >
                              {t('admin.clearOverrideBtn')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setEpisodeModal({ open: true, episode: null, defaultStoryId: story.id })
                            }
                            className="h-9 px-3 rounded-lg bg-[#1C1C22] border border-[#E5A93C]/40 text-xs font-medium text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] inline-flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            {t('admin.newEpisodeBtn')}
                          </button>
                        </div>
                      </div>

                      {activeStoryEps.map((ep) => {
                        const draftVal = episodePriceDrafts[ep.id] ?? String(ep.priceCoins ?? 0);
                        return (
                          <div
                            key={ep.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0B0B0E] border border-white/[0.06] px-4 py-2.5 text-xs"
                          >
                            <span className="text-[#F5F3EE] truncate">
                              Ep {ep.episodeNumber}: {lang === 'hi' ? ep.titleHi : ep.title}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              {ep.videoMediaRef && (
                                <button
                                  type="button"
                                  onClick={() => void playEpisode(story, ep, 0, undefined, 'video')}
                                  className="h-8 px-2.5 rounded-lg bg-[#E5A93C]/15 border border-[#E5A93C]/40 text-xs font-medium text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] inline-flex items-center gap-1 transition-colors"
                                >
                                  <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                                  {t('studio.videoPreviewBtn')}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setEpisodeModal({
                                    open: true,
                                    episode: ep,
                                    defaultStoryId: story.id,
                                  })
                                }
                                className="h-8 px-2.5 rounded-lg bg-[#141418] border border-white/15 text-xs text-[#D6D2C9] hover:text-[#F5F3EE] inline-flex items-center gap-1"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                                {t('common.edit')}
                              </button>
                              <label className="inline-flex items-center gap-1.5 text-[#A39E93]">
                                <Coins className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                                <input
                                  type="number"
                                  min={0}
                                  max={100000}
                                  aria-label={`Price in coins for Episode ${ep.episodeNumber}`}
                                  value={draftVal}
                                  onChange={(e) =>
                                    setEpisodePriceDrafts({
                                      ...episodePriceDrafts,
                                      [ep.id]: e.target.value,
                                    })
                                  }
                                  className="w-20 h-8 px-2 rounded-lg bg-[#141418] border border-white/15 text-xs text-[#F5F3EE] tabular-nums"
                                />
                              </label>
                              <button
                                type="button"
                                data-testid={`admin-save-ep-price-${ep.id}`}
                                disabled={busyId === `ep-price-${ep.id}`}
                                onClick={() => handleEpisodePriceSave(ep)}
                                className="h-8 px-2.5 rounded-lg bg-[#1C1C22] border border-[#E5A93C]/40 text-xs font-medium text-[#F3C669] hover:bg-[#E5A93C] hover:text-[#0B0B0E] transition-colors"
                              >
                                {t('common.save')}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === `ep-soft-del-${ep.id}`}
                                onClick={() => handleSoftDeleteEpisode(ep)}
                                aria-label={`${t('admin.moveToTrashBtn')} Episode ${ep.episodeNumber}`}
                                title={t('admin.moveToTrashBtn')}
                                className="h-8 px-2.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {trashedStoryEps.length > 0 && (
                        <div className="pt-2 space-y-2">
                          <p className="text-[11px] uppercase tracking-wider text-rose-300/80 font-semibold">
                            {t('admin.trashedEpisodesHeading')} ({trashedStoryEps.length})
                          </p>
                          {trashedStoryEps.map((ep) => (
                            <div
                              key={ep.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-950/20 border border-rose-500/25 px-4 py-2 text-xs"
                            >
                              <span className="text-[#D6D2C9] truncate">
                                Ep {ep.episodeNumber}: {lang === 'hi' ? ep.titleHi : ep.title}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={busyId === `ep-restore-${ep.id}`}
                                  onClick={() => handleRestoreEpisode(ep)}
                                  className="h-8 px-2.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 inline-flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                  {t('admin.restoreBtn')}
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === `ep-del-${ep.id}`}
                                  onClick={() => handleDeleteEpisode(ep)}
                                  className="h-8 px-2.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 inline-flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                                  {t('admin.deletePermanentlyBtn')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Standalone soft-deleted episodes from active stories */}
          {storyViewMode === 'trash' && standaloneTrashedEpisodes.length > 0 && (
            <div className="rounded-2xl bg-[#141418] border border-rose-500/25 p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                {t('admin.trashedEpisodesHeading')} ({standaloneTrashedEpisodes.length})
              </h3>
              <div className="space-y-2">
                {standaloneTrashedEpisodes.map((ep) => {
                  const parent = (bundle?.stories ?? []).find((s) => s.id === ep.storyId);
                  return (
                    <div
                      key={ep.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0B0B0E] border border-white/[0.06] px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="text-[#F5F3EE] font-medium truncate">
                          Ep {ep.episodeNumber}: {lang === 'hi' ? ep.titleHi : ep.title}
                        </p>
                        {parent && (
                          <p className="text-[11px] text-[#8A857B] truncate">{parent.title}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === `ep-restore-${ep.id}`}
                          onClick={() => handleRestoreEpisode(ep)}
                          className="h-8 px-2.5 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          {t('admin.restoreBtn')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === `ep-del-${ep.id}`}
                          onClick={() => handleDeleteEpisode(ep)}
                          className="h-8 px-2.5 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                          {t('admin.deletePermanentlyBtn')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 3B: COINS & ECONOMY */}
      {activeTab === 'economy' && (
        <section className="space-y-8">
          {/* Daily Free Episode Settings */}
          <form
            onSubmit={handleSaveEconomySettings}
            className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Gift className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                  {t('admin.dailyFreeHeading')}
                </h2>
                <p className="text-xs text-[#A39E93]">{t('admin.dailyFreeDesc')}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-5">
              <label className="min-h-[44px] inline-flex items-center gap-2.5 text-sm text-[#F5F3EE] cursor-pointer">
                <input
                  type="checkbox"
                  checked={dailyFreeEnabled}
                  onChange={(e) => setDailyFreeEnabled(e.target.checked)}
                  className="w-4 h-4 accent-[#E5A93C]"
                />
                {t('admin.dailyFreeEnabledLabel')}
              </label>

              <div className="space-y-1">
                <label htmlFor="admin-daily-limit" className="text-xs text-[#A39E93] block">
                  {t('admin.dailyFreeLimitLabel')}
                </label>
                <input
                  id="admin-daily-limit"
                  type="number"
                  min={0}
                  max={20}
                  disabled={!dailyFreeEnabled}
                  value={dailyFreeLimit}
                  onChange={(e) =>
                    setDailyFreeLimit(Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0))))
                  }
                  className="w-28 h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={busyId === 'economy-settings'}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50"
              >
                {t('admin.saveEconomyBtn')}
              </button>
            </div>
          </form>

          {/* Coin Packages CRUD */}
          <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Coins className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                  {t('admin.coinPackagesHeading')}
                </h2>
                <p className="text-xs text-[#A39E93]">{t('admin.coinPackagesDesc')}</p>
              </div>
              <button
                type="button"
                onClick={openAddPackage}
                className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                {t('admin.newPackageBtn')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(bundle?.coinPackages ?? []).map((pkg) => (
                <div
                  key={pkg.id}
                  className="rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[#E5A93C] tabular-nums">#{pkg.sortOrder}</span>
                      <span className={pkg.active ? 'text-emerald-400' : 'text-[#8A857B]'}>
                        {pkg.active ? t('admin.activeLabel') : t('common.archived')}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#F5F3EE] truncate">
                      {pkg.name} {pkg.nameHi ? `· ${pkg.nameHi}` : ''}
                    </p>
                    <p className="text-xs text-[#A39E93] tabular-nums">
                      {pkg.coins} + {pkg.bonusCoins} bonus ={' '}
                      <strong className="text-[#F3C669]">{pkg.coins + pkg.bonusCoins}</strong>{' '}
                      {t('coins.unit')} · {formatInr(pkg.priceInr)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePackageActive(pkg)}
                      className="min-h-[36px] px-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#D6D2C9]"
                    >
                      {pkg.active ? t('admin.hideAction') : t('admin.enableBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditPackage(pkg)}
                      className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/10 text-xs text-[#F5F3EE]"
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCoinPackage(pkg)}
                      aria-label={`${t('common.delete')} ${pkg.name}`}
                      className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Admin Wallet Adjustment / Bonus / Refund (Server-side /api/coins/admin-adjust) */}
          <form
            onSubmit={handleAdminWalletAdjust}
            className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                <Wallet className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                {t('admin.walletAdjustHeading')}
              </h2>
              <p className="text-xs text-[#A39E93]">{t('admin.walletAdjustDesc')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="adj-user" className="text-xs text-[#A39E93] block">
                  {t('admin.selectUserLabel')}
                </label>
                <select
                  id="adj-user"
                  value={adjTargetUid}
                  onChange={(e) => setAdjTargetUid(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  {(bundle?.users ?? []).map((u) => {
                    const userWallet = (bundle?.wallets ?? []).find((w) => w.uid === u.uid);
                    return (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.email}) — {userWallet?.balance ?? 0} coins
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="adj-type" className="text-xs text-[#A39E93] block">
                  {t('admin.adjustTypeLabel')}
                </label>
                <select
                  id="adj-type"
                  value={adjType}
                  onChange={(e) =>
                    setAdjType(
                      e.target.value as Extract<
                        CoinTransactionType,
                        'admin_adjust' | 'bonus' | 'refund'
                      >
                    )
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  <option value="bonus">{t('wallet.txTypeBonus')}</option>
                  <option value="refund">{t('wallet.txTypeRefund')}</option>
                  <option value="admin_adjust">{t('wallet.txTypeAdmin')}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="adj-amount" className="text-xs text-[#A39E93] block">
                  {t('admin.adjustAmountLabel')}
                </label>
                <input
                  id="adj-amount"
                  type="number"
                  step={1}
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                maxLength={240}
                placeholder={t('admin.adjustNotePlaceholder')}
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                className="flex-1 h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
              />
              <button
                type="submit"
                disabled={busyId === 'wallet-adjust'}
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 whitespace-nowrap"
              >
                {t('admin.applyAdjustBtn')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TAB 4: CREATORS CRUD */}
      {activeTab === 'creators' && (
        <section className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCreatorModal({ open: true, creator: null })}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t('admin.newCreatorBtn')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(bundle?.creators ?? []).map((creator) => (
              <div
                key={creator.id}
                className="rounded-2xl bg-[#141418] border border-white/[0.08] p-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-lg font-semibold text-[#F5F3EE] truncate">
                      {creator.name}
                    </h3>
                    <span
                      className={`text-[11px] font-medium ${
                        creator.verified ? 'text-emerald-400' : 'text-[#8A857B]'
                      }`}
                    >
                      {creator.verified ? t('admin.verifiedLabel') : t('admin.unverifiedLabel')}
                    </span>
                  </div>
                  <p className="text-xs text-[#A39E93] tabular-nums">
                    {creator.handle} · {creator.storiesCount} stories · {creator.followersCount}{' '}
                    followers
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === `creator-${creator.id}`}
                    onClick={() => handleToggleCreatorVerified(creator)}
                    className="min-h-[36px] px-3 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-[#E5A93C]/50 whitespace-nowrap"
                  >
                    {creator.verified ? t('admin.unverifyBtn') : t('admin.verifyBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatorModal({ open: true, creator })}
                    className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/10 text-xs text-[#F5F3EE] inline-flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" aria-hidden="true" />
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === `creator-del-${creator.id}`}
                    onClick={() => handleDeleteCreator(creator)}
                    aria-label={`${t('common.delete')} ${creator.name}`}
                    className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 5: CATEGORIES CRUD */}
      {activeTab === 'categories' && (
        <section className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openAddCategory}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              {t('admin.newCategoryBtn')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(bundle?.categories ?? []).map((cat) => (
              <div
                key={cat.id}
                className="rounded-2xl bg-[#141418] border border-white/[0.08] p-4 flex items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#E5A93C] tabular-nums">#{cat.sortOrder}</span>
                    <span className={cat.isActive ? 'text-emerald-400' : 'text-[#8A857B]'}>
                      {cat.isActive ? t('admin.activeLabel') : t('common.archived')}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[#F5F3EE] truncate">
                    {cat.nameEn} · {cat.nameHi}
                  </p>
                  <p className="text-[11px] text-[#8A857B]">{cat.id}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleCategoryActive(cat)}
                    className="min-h-[36px] px-3 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#D6D2C9]"
                  >
                    {cat.isActive ? t('admin.hideAction') : t('admin.enableBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditCategory(cat)}
                    className="min-h-[36px] px-3 rounded-lg bg-[#1C1C22] border border-white/10 text-xs text-[#F5F3EE]"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat)}
                    aria-label={`${t('common.delete')} ${cat.nameEn}`}
                    className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/30 text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 6: IMMUTABLE AUDIT LOGS */}
      {activeTab === 'audit' && (
        <section className="space-y-4">
          <div className="rounded-xl bg-[#141418] border border-white/[0.08] px-4 py-3 text-xs text-[#A39E93] flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
            <span>{t('admin.auditNotice')}</span>
          </div>

          {(bundle?.auditLogs ?? []).length === 0 ? (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-10 text-center text-sm text-[#A39E93]">
              {t('admin.noAuditLogs')}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#141418] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse tabular-nums">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-[#0B0B0E]/60 text-[#A39E93]">
                    <th className="py-3 px-4 font-medium">Timestamp</th>
                    <th className="py-3 px-4 font-medium">Admin</th>
                    <th className="py-3 px-4 font-medium">Action</th>
                    <th className="py-3 px-4 font-medium">Target</th>
                    <th className="py-3 px-4 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(bundle?.auditLogs ?? []).map((entry) => (
                    <tr key={entry.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4 text-[#8A857B] whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-[#D6D2C9] whitespace-nowrap">
                        {entry.actorEmail}
                      </td>
                      <td className="py-3 px-4 text-[#E5A93C] font-medium whitespace-nowrap">
                        {entry.action}
                      </td>
                      <td className="py-3 px-4 text-[#A39E93] whitespace-nowrap">
                        {entry.targetCollection}/{entry.targetId}
                      </td>
                      <td className="py-3 px-4 text-[#F5F3EE]">{entry.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* CATEGORY MODAL */}
      {categoryModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.newCategoryBtn')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveCategory}
            className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
                {editingCategory ? t('common.edit') : t('admin.newCategoryBtn')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setCategoryModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!editingCategory && (
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.categoryIdLabel')}</label>
                <input
                  type="text"
                  placeholder="e.g. sci-fi-myth"
                  value={catForm.id}
                  onChange={(e) => setCatForm({ ...catForm, id: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-[#A39E93] block">{t('admin.categoryNameEn')}</label>
              <input
                type="text"
                required
                value={catForm.nameEn}
                onChange={(e) => setCatForm({ ...catForm, nameEn: e.target.value })}
                className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-[#A39E93] block">{t('admin.categoryNameHi')}</label>
              <input
                type="text"
                value={catForm.nameHi}
                onChange={(e) => setCatForm({ ...catForm, nameHi: e.target.value })}
                className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">
                  {t('admin.categorySortOrder')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={catForm.sortOrder}
                  onChange={(e) =>
                    setCatForm({ ...catForm, sortOrder: Number(e.target.value) || 0 })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs text-[#D6D2C9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={catForm.isActive}
                    onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })}
                    className="w-4 h-4 accent-[#E5A93C]"
                  />
                  {t('admin.categoryActive')}
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669]"
              >
                {t('admin.saveCategoryBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* COIN PACKAGE MODAL */}
      {pkgModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('admin.newPackageBtn')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveCoinPackage}
            className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
                {editingPkg ? t('common.edit') : t('admin.newPackageBtn')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setPkgModalOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.packageNameEn')}</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={pkgForm.name}
                  onChange={(e) => setPkgForm({ ...pkgForm, name: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.packageNameHi')}</label>
                <input
                  type="text"
                  maxLength={80}
                  value={pkgForm.nameHi ?? ''}
                  onChange={(e) => setPkgForm({ ...pkgForm, nameHi: e.target.value })}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.packageCoins')}</label>
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  required
                  value={pkgForm.coins}
                  onChange={(e) =>
                    setPkgForm({ ...pkgForm, coins: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.packageBonus')}</label>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  value={pkgForm.bonusCoins}
                  onChange={(e) =>
                    setPkgForm({
                      ...pkgForm,
                      bonusCoins: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">{t('admin.packagePriceInr')}</label>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  required
                  value={pkgForm.priceInr}
                  onChange={(e) =>
                    setPkgForm({
                      ...pkgForm,
                      priceInr: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[#A39E93] block">
                  {t('admin.categorySortOrder')}
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={pkgForm.sortOrder}
                  onChange={(e) =>
                    setPkgForm({ ...pkgForm, sortOrder: Number(e.target.value) || 0 })
                  }
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] tabular-nums"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs text-[#D6D2C9] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pkgForm.active}
                    onChange={(e) => setPkgForm({ ...pkgForm, active: e.target.checked })}
                    className="w-4 h-4 accent-[#E5A93C]"
                  />
                  {t('admin.packageActiveLabel')}
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPkgModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669]"
              >
                {t('admin.savePackageBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BAN / UNBAN USER MODAL */}
      {sessionModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            sessionModal.mode === 'ban' ? t('admin.banModalTitle') : t('admin.unbanModalTitle')
          }
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleConfirmSessionModal}
            className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
                {sessionModal.mode === 'ban'
                  ? t('admin.banModalTitle')
                  : t('admin.unbanModalTitle')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setSessionModal(null)}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-[#0B0B0E] border border-white/10 px-4 py-3 text-xs space-y-0.5">
              <p className="font-medium text-[#F5F3EE]">{sessionModal.user.displayName}</p>
              <p className="text-[#8A857B]">
                {sessionModal.user.email || sessionModal.user.phoneNumber || sessionModal.user.uid}
              </p>
            </div>

            <p className="text-xs text-[#A39E93] leading-relaxed">
              {sessionModal.mode === 'ban' ? t('admin.banModalDesc') : t('admin.unbanModalDesc')}
            </p>

            {sessionModal.mode === 'unban' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="admin-unban-warnings"
                  className="text-xs font-medium text-[#A39E93] block"
                >
                  {t('admin.unbanWarningCountLabel')}
                </label>
                <select
                  id="admin-unban-warnings"
                  value={unbanWarningCount}
                  onChange={(e) => setUnbanWarningCount(Number(e.target.value) || 0)}
                  className="w-full h-11 px-3 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                >
                  <option value={0}>0 / 3 (Reset to clean slate)</option>
                  <option value={1}>1 / 3</option>
                  <option value={2}>2 / 3 (Final warning)</option>
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="admin-session-reason"
                className="text-xs font-medium text-[#A39E93] block"
              >
                {sessionModal.mode === 'ban'
                  ? t('admin.banReasonInputLabel')
                  : t('admin.unbanReasonInputLabel')}
              </label>
              <input
                id="admin-session-reason"
                type="text"
                maxLength={240}
                placeholder={
                  sessionModal.mode === 'ban'
                    ? t('admin.banReasonPlaceholder')
                    : t('admin.unbanReasonPlaceholder')
                }
                value={sessionModalReason}
                onChange={(e) => setSessionModalReason(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#78736A]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSessionModal(null)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className={`min-h-[44px] px-5 rounded-xl text-xs font-semibold transition-colors ${
                  sessionModal.mode === 'ban'
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'bg-emerald-500 text-[#0B0B0E] hover:bg-emerald-400'
                }`}
              >
                {sessionModal.mode === 'ban'
                  ? t('admin.confirmBanBtn')
                  : t('admin.confirmUnbanBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CMS MODALS: STORY, EPISODE, CREATOR, USER */}
      {storyModal.open && profile && (
        <AdminStoryEditorModal
          firebaseUser={firebaseUser}
          actor={profile}
          story={storyModal.story}
          categories={bundle?.categories ?? []}
          creators={bundle?.creators ?? []}
          onClose={() => setStoryModal({ open: false, story: null })}
          onSaved={async () => {
            await loadBundle();
            await refreshCatalog();
            setFeedback({
              type: 'success',
              text: `${storyModal.story ? 'Updated' : 'Created'} story (Audit log recorded)`,
            });
          }}
        />
      )}

      {episodeModal.open && profile && (
        <AdminEpisodeEditorModal
          firebaseUser={firebaseUser}
          actor={profile}
          episode={episodeModal.episode}
          stories={(bundle?.stories ?? []).filter((s) => !s.isDeleted)}
          defaultStoryId={episodeModal.defaultStoryId}
          onClose={() => setEpisodeModal({ open: false, episode: null })}
          onSaved={async () => {
            await loadBundle();
            await refreshCatalog();
            setFeedback({
              type: 'success',
              text: `${episodeModal.episode ? 'Updated' : 'Created'} episode (Audit log recorded)`,
            });
          }}
        />
      )}

      {creatorModal.open && profile && (
        <AdminCreatorEditorModal
          firebaseUser={firebaseUser}
          actor={profile}
          creator={creatorModal.creator}
          onClose={() => setCreatorModal({ open: false, creator: null })}
          onSaved={async () => {
            await loadBundle();
            await refreshCatalog();
            setFeedback({
              type: 'success',
              text: `${creatorModal.creator ? 'Updated' : 'Created'} creator profile (Audit log recorded)`,
            });
          }}
        />
      )}

      {editingUser && profile && (
        <AdminUserEditModal
          firebaseUser={firebaseUser}
          actor={profile}
          target={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={async () => {
            await loadBundle();
            setFeedback({
              type: 'success',
              text: `Updated user "${editingUser.email || editingUser.uid}" (Audit log recorded)`,
            });
          }}
        />
      )}
    </div>
  );
};
