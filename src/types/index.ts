export type LanguageCode = string;
export type ContentLanguage = 'en' | 'hi' | 'bilingual';
export type UserRole = 'user' | 'creator' | 'admin';
export type PaymentProviderType = 'mock' | 'razorpay_stub';
export type StoryVisibility = 'published' | 'draft' | 'archived';
export type StoryFormat = 'audio' | 'video' | 'hybrid';
export type PlaybackFormat = 'audio' | 'video';
export type MediaProviderType = 'demo' | 'drive' | 'youtube' | 'gcs';
export type MediaAssetType = 'audio' | 'video';
export type BookmarkTargetType = 'story_bookmark' | 'story_favorite' | 'creator_follow';
export type CreatorRequestStatus = 'pending' | 'approved' | 'rejected';

export type CoinTransactionType =
  | 'purchase'
  | 'spend'
  | 'admin_adjust'
  | 'bonus'
  | 'refund';

export interface MediaRef {
  provider: MediaProviderType;
  id: string;
  type: MediaAssetType;
}

export interface DeviceInfo {
  label: string;
  platform?: string;
  userAgent?: string;
}

export interface ActiveDeviceSession {
  deviceId: string;
  deviceInfo: DeviceInfo;
  registeredAt: number;
  lastSeen: number;
}

export type SessionEventType =
  | 'login_registered'
  | 'logout'
  | 'violation_warning'
  | 'violation_ban'
  | 'admin_ban'
  | 'admin_unban'
  | 'admin_reset_warnings'
  | 'admin_force_logout';

export interface SessionLogEntry {
  id: string;
  uid: string;
  deviceId: string | null;
  deviceInfo?: DeviceInfo | null;
  eventType: SessionEventType;
  warningCountAfter: number;
  bannedAfter: boolean;
  note: string;
  createdAt: number;
}

export type AdminSessionActionType = 'ban' | 'unban' | 'reset_warnings' | 'force_logout';

export interface UserProfile {
  uid: string;
  email: string;
  phoneNumber?: string;
  displayName: string;
  bio?: string;
  preferredLanguage: LanguageCode;
  preferredFormat?: PlaybackFormat;
  role: UserRole;
  isDisabled?: boolean;
  /** Server-only single-device enforcement fields (never client-editable). */
  warningCount?: number;
  banned?: boolean;
  bannedAt?: string | number | null;
  banReason?: string | null;
  activeDevice?: ActiveDeviceSession | null;
  lastSeen?: string | number | null;
  avatarInitials: string;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface Category {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
  descriptionEn?: string;
  descriptionHi?: string;
  accentHex?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Creator {
  id: string;
  ownerUid: string;
  name: string;
  handle: string;
  bioEn?: string;
  bioHi?: string;
  language: ContentLanguage;
  followersCount: number;
  storiesCount: number;
  verified: boolean;
  accentPalette?: string;
}

export type CoverTheme =
  | 'mythology-gold'
  | 'romance-mist'
  | 'thriller-noir'
  | 'horror-amber'
  | 'crime-deco'
  | 'kids-lantern'
  | 'motivation-dawn'
  | 'comedy-bazaar'
  | 'mystery-emerald'
  | 'folklore-crimson'
  | 'scifi-indigo'
  | 'drama-sepia';

export interface Story {
  id: string;
  slug: string;
  title: string;
  titleHi: string;
  synopsis: string;
  synopsisHi: string;
  genreId: string;
  language: ContentLanguage;
  creatorId: string;
  creatorOwnerUid: string;
  creatorName: string;
  coverUrl?: string;
  backdropUrl?: string;
  coverTheme: CoverTheme;
  rating: number;
  totalPlays: number;
  episodeCount: number;
  isTrending: boolean;
  isEditorsPick: boolean;
  isPopular: boolean;
  isFeatured: boolean;
  visibility: StoryVisibility;
  format: StoryFormat;
  isInteractive: boolean;
  /** Optional admin-only story-level coin price override (null/undefined = use per-episode priceCoins). */
  priceOverrideCoins?: number | null;
  /** Safe soft-delete flag (hidden from listeners, restorable by Admin). */
  isDeleted?: boolean;
  deletedAt?: string | number | null;
  deletedByUid?: string | null;
  publishedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InteractiveChoiceOption {
  id: string;
  labelEn: string;
  labelHi: string;
  taglineEn?: string;
  taglineHi?: string;
  nextEpisodeId: string;
}

export interface EpisodeChoicePoint {
  id: string;
  /** Timestamp in seconds to pause and show choices. If omitted or triggerAtEnd is true, triggers near episode end. */
  triggerAtSec?: number;
  triggerAtEnd?: boolean;
  promptEn: string;
  promptHi: string;
  options: InteractiveChoiceOption[];
}

export interface Episode {
  id: string;
  storyId: string;
  creatorOwnerUid: string;
  episodeNumber: number;
  title: string;
  titleHi: string;
  description?: string;
  descriptionHi?: string;
  durationSec: number;
  /** Coin unlock price (0 = free). Set once by creator on upload; editable anytime by Admin. */
  priceCoins: number;
  mediaRef: MediaRef;
  audioRef?: MediaRef;
  videoMediaRef?: MediaRef;
  choicePoint?: EpisodeChoicePoint;
  isEnding?: boolean;
  /** Safe soft-delete flag (hidden from listeners, restorable by Admin). */
  isDeleted?: boolean;
  deletedAt?: string | number | null;
  deletedByUid?: string | null;
  publishedAt: string;
  createdAt?: string;
}

export interface CoinWallet {
  uid: string;
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
  updatedAt: number;
}

export interface CoinTransaction {
  id: string;
  uid: string;
  type: CoinTransactionType;
  /** Positive for credit (purchase, bonus, refund, positive admin_adjust); negative for spend/debit. */
  amount: number;
  balanceAfter: number;
  episodeId: string | null;
  storyId: string | null;
  creatorId: string | null;
  createdAt: number;
  note: string;
}

export interface EpisodeUnlockRecord {
  id: string;
  uid: string;
  episodeId: string;
  storyId: string;
  creatorId: string;
  pricePaidCoins: number;
  transactionId: string;
  unlockedAt: number;
}

export interface CoinPackage {
  id: string;
  name: string;
  nameHi?: string;
  coins: number;
  priceInr: number;
  bonusCoins: number;
  active: boolean;
  sortOrder: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface EconomySettings {
  id: 'economy';
  dailyFreeEnabled: boolean;
  dailyFreeLimit: number;
  updatedAt?: number;
  updatedByUid?: string;
}

export interface ListeningHistoryEntry {
  id: string;
  userId: string;
  storyId: string;
  storyOwnerUid?: string;
  episodeId: string;
  episodeNumber: number;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  updatedAt: number;
}

export interface BookmarkEntry {
  id: string;
  userId: string;
  targetType: BookmarkTargetType;
  targetId: string;
  createdAt: number;
}

export interface DailyUnlockEntry {
  id: string;
  userId: string;
  storyId: string;
  episodeId: string;
  unlockDate: string; // YYYY-MM-DD
  createdAt: number;
}

export interface CreatorRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  studioName: string;
  handle: string;
  language: ContentLanguage;
  pitch: string;
  sampleLink?: string;
  status: CreatorRequestStatus;
  reviewNote?: string;
  reviewedByUid?: string;
  createdAt: number;
  updatedAt: number;
}

export type AuditActionType =
  | 'user_role_change'
  | 'user_profile_admin_update'
  | 'user_disable_toggle'
  | 'user_ban'
  | 'user_unban'
  | 'user_warnings_reset'
  | 'user_force_logout'
  | 'creator_request_approve'
  | 'creator_request_reject'
  | 'creator_verify_toggle'
  | 'creator_create'
  | 'creator_update'
  | 'creator_delete'
  | 'story_create'
  | 'story_update'
  | 'story_visibility_change'
  | 'story_curation_toggle'
  | 'story_price_override'
  | 'story_soft_delete'
  | 'story_restore'
  | 'story_delete'
  | 'episode_create'
  | 'episode_update'
  | 'episode_price_change'
  | 'episode_soft_delete'
  | 'episode_restore'
  | 'episode_delete'
  | 'category_create'
  | 'category_update'
  | 'category_delete'
  | 'coin_package_create'
  | 'coin_package_update'
  | 'coin_package_delete'
  | 'economy_settings_update'
  | 'site_settings_update'
  | 'wallet_admin_adjust'
  | 'catalog_seed';

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: AuditActionType;
  targetCollection: string;
  targetId: string;
  summary: string;
  createdAt: number;
}

export interface InteractiveChoice {
  id: string;
  storyId: string;
  episodeId: string;
  promptEn: string;
  promptHi: string;
  options: InteractiveChoiceOption[];
  createdAt: string;
}

export interface UserChoiceEntry {
  id: string;
  userId: string;
  storyId: string;
  episodeId: string;
  choicePointId: string;
  optionId: string;
  optionLabelEn: string;
  optionLabelHi: string;
  nextEpisodeId: string;
  chosenAt: number;
}

export interface EpisodeAccessResult {
  allowed: boolean;
  effectivePriceCoins: number;
  reason:
    | 'free_episode'
    | 'admin_or_creator_owner'
    | 'coin_unlocked'
    | 'daily_unlock_claimed'
    | 'requires_coin_unlock'
    | 'requires_sign_in';
  canUseDailyFree: boolean;
}

// =============================================================================
// SITE SETTINGS & CMS CONFIGURATION (stored in Firestore siteSettings/main)
// =============================================================================

export interface HeroBannerItem {
  id: string;
  titleEn: string;
  titleHi: string;
  subtitleEn: string;
  subtitleHi: string;
  badgeEn?: string;
  badgeHi?: string;
  ctaLabelEn: string;
  ctaLabelHi: string;
  /** Target story ID to open or play; optional if linking to another internal path */
  storyId?: string;
  imageUrl?: string;
  active: boolean;
  sortOrder: number;
}

export type HomepageSectionSource =
  | 'auto_continue'
  | 'auto_trending'
  | 'auto_editors_pick'
  | 'auto_popular'
  | 'auto_recent'
  | 'manual_stories';

export interface HomepageSectionConfig {
  id: string;
  titleEn: string;
  titleHi: string;
  subtitleEn?: string;
  subtitleHi?: string;
  source: HomepageSectionSource;
  /** Used when source === 'manual_stories' or to pin specific stories first */
  storyIds: string[];
  visible: boolean;
  sortOrder: number;
  maxItems?: number;
}

export interface LanguageOptionSetting {
  code: string;
  labelEn: string;
  labelNative: string;
  enabled: boolean;
}

export type LegalPageSlug = 'terms' | 'privacy' | 'refund';

export interface LegalPageDocument {
  slug: LegalPageSlug;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  updatedAt?: string;
}

export interface SiteBrandingSettings {
  appNameEn: string;
  appNameHi: string;
  taglineEn: string;
  taglineHi: string;
  logoUrl: string;
  accentHex: string;
  accentHoverHex: string;
  bgCanvasHex: string;
  bgSurfaceHex: string;
  supportEmail: string;
}

export interface SiteFooterSettings {
  aboutEn: string;
  aboutHi: string;
  copyrightEn: string;
  copyrightHi: string;
}

export interface SiteSettings {
  id: 'main';
  branding: SiteBrandingSettings;
  footer: SiteFooterSettings;
  heroBanners: HeroBannerItem[];
  homepageSections: HomepageSectionConfig[];
  languages: LanguageOptionSetting[];
  defaultLanguage: string;
  legalPages: Record<LegalPageSlug, LegalPageDocument>;
  updatedAt?: number;
  updatedByUid?: string;
}

// =============================================================================
// ADMIN & USER ANALYTICS TYPES
// =============================================================================

export type AnalyticsTimeGranularity = 'daily' | 'weekly' | 'monthly';
export type AnalyticsDateRangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

export interface AnalyticsTimeSeriesBucket {
  bucketKey: string;
  label: string;
  purchasedCoins: number;
  spentCoins: number;
  bonusCoins: number;
  refundCoins: number;
  adminAdjustCoins: number;
  unlockCount: number;
  playCount: number;
}

export interface AnalyticsBreakdownItem {
  id: string;
  label: string;
  secondaryLabel?: string;
  coinsSpent: number;
  unlockCount: number;
  uniqueSpenders: number;
  sharePct: number;
}

export interface AnalyticsEpisodeBreakdownItem extends AnalyticsBreakdownItem {
  storyId: string;
  storyTitle: string;
  episodeNumber: number;
}

export interface AnalyticsSpenderItem {
  uid: string;
  displayName: string;
  email: string;
  totalSpent: number;
  totalPurchased: number;
  currentBalance: number;
  unlockCount: number;
  banned: boolean;
  warningCount: number;
}

export interface AnalyticsConversionRow {
  storyId: string;
  storyTitle: string;
  creatorName: string;
  trackedPlays: number;
  uniqueListeners: number;
  unlockCount: number;
  coinsEarned: number;
  conversionRatePct: number;
}

export interface AdminAnalyticsReport {
  source: 'server' | 'client-fallback';
  generatedAt: number;
  range: {
    preset: AnalyticsDateRangePreset;
    startMs: number | null;
    endMs: number | null;
    granularity: AnalyticsTimeGranularity;
  };
  pagination: {
    transactionsScanned: number;
    historyScanned: number;
    truncated: boolean;
  };
  kpis: {
    totalPurchasedCoins: number;
    totalSpentCoins: number;
    totalBonusCoins: number;
    totalRefundCoins: number;
    totalAdminAdjustCoins: number;
    balanceOutstandingCoins: number;
    totalUnlocks: number;
    totalTrackedPlays: number;
    overallConversionPct: number;
    activeSpenders: number;
    totalUsers: number;
    bannedUsers: number;
  };
  timeSeries: AnalyticsTimeSeriesBucket[];
  spendByStory: AnalyticsBreakdownItem[];
  spendByEpisode: AnalyticsEpisodeBreakdownItem[];
  spendByGenre: AnalyticsBreakdownItem[];
  spendByCreator: AnalyticsBreakdownItem[];
  spendByLanguage: AnalyticsBreakdownItem[];
  topSpenders: AnalyticsSpenderItem[];
  topStoriesByCoins: AnalyticsBreakdownItem[];
  topCreatorsByCoins: AnalyticsBreakdownItem[];
  conversionByStory: AnalyticsConversionRow[];
}

export interface PerUserSpendStoryGroup {
  storyId: string;
  storyTitle: string;
  totalCoins: number;
  episodes: Array<{
    episodeId: string;
    episodeTitle: string;
    episodeNumber: number | null;
    coins: number;
    createdAt: number;
  }>;
}

export interface PerUserAnalyticsDetail {
  uid: string;
  displayName: string;
  email: string;
  phoneNumber?: string;
  role: UserRole;
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
  rangePurchased: number;
  rangeSpent: number;
  warningCount: number;
  banned: boolean;
  banReason: string | null;
  activeDevice: ActiveDeviceSession | null;
  lastSeen: number | null;
  spendByStory: PerUserSpendStoryGroup[];
  transactions: CoinTransaction[];
  listeningHistory: Array<
    ListeningHistoryEntry & {
      storyTitle: string;
      episodeTitle: string;
    }
  >;
  sessions: SessionLogEntry[];
}

export interface UserMyCoinsAnalytics {
  totalPurchased: number;
  totalSpent: number;
  totalBonus: number;
  storiesSupportedCount: number;
  episodesUnlockedCount: number;
  spendByStory: Array<{
    storyId: string;
    storyTitle: string;
    coinsSpent: number;
    unlockCount: number;
    sharePct: number;
  }>;
  timeSeries: Array<{
    bucketKey: string;
    label: string;
    spentCoins: number;
    creditedCoins: number;
  }>;
}

