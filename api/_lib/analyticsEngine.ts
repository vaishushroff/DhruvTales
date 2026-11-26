import type {
  AdminAnalyticsReport,
  AnalyticsBreakdownItem,
  AnalyticsConversionRow,
  AnalyticsDateRangePreset,
  AnalyticsEpisodeBreakdownItem,
  AnalyticsSpenderItem,
  AnalyticsTimeGranularity,
  AnalyticsTimeSeriesBucket,
  Category,
  CoinTransaction,
  CoinWallet,
  Creator,
  Episode,
  ListeningHistoryEntry,
  PerUserAnalyticsDetail,
  PerUserSpendStoryGroup,
  SessionLogEntry,
  Story,
  UserMyCoinsAnalytics,
  UserProfile,
} from '../../src/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveDateRangeBounds(
  preset: AnalyticsDateRangePreset,
  nowMs = Date.now(),
  customStartMs?: number | null,
  customEndMs?: number | null
): { startMs: number | null; endMs: number | null } {
  switch (preset) {
    case '7d':
      return { startMs: nowMs - 7 * DAY_MS, endMs: nowMs };
    case '30d':
      return { startMs: nowMs - 30 * DAY_MS, endMs: nowMs };
    case '90d':
      return { startMs: nowMs - 90 * DAY_MS, endMs: nowMs };
    case 'custom': {
      const start =
        typeof customStartMs === 'number' && Number.isFinite(customStartMs)
          ? customStartMs
          : null;
      const end =
        typeof customEndMs === 'number' && Number.isFinite(customEndMs)
          ? customEndMs
          : null;
      if (start !== null && end !== null && start > end) {
        return { startMs: end, endMs: start };
      }
      return { startMs: start, endMs: end };
    }
    case 'all':
    default:
      return { startMs: null, endMs: null };
  }
}

export function getTimeBucketKeyAndLabel(
  timestampMs: number,
  granularity: AnalyticsTimeGranularity
): { key: string; label: string } {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  if (granularity === 'monthly') {
    const key = `${year}-${month}`;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { key, label: `${monthNames[date.getUTCMonth()]} ${year}` };
  }

  if (granularity === 'weekly') {
    // ISO week Monday start (UTC)
    const utcDay = date.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
    const monday = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate() + diffToMonday));
    const mYear = monday.getUTCFullYear();
    const mMonth = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const mDay = String(monday.getUTCDate()).padStart(2, '0');
    const key = `${mYear}-${mMonth}-${mDay}`;
    return { key, label: `Wk ${mMonth}/${mDay}` };
  }

  // daily
  const key = `${year}-${month}-${day}`;
  return { key, label: `${month}/${day}` };
}

function isWithinRange(ts: number, startMs: number | null, endMs: number | null): boolean {
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (startMs !== null && ts < startMs) return false;
  if (endMs !== null && ts > endMs) return false;
  return true;
}

function roundPct(numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function formatLanguageLabel(lang: string | undefined): string {
  switch (lang) {
    case 'hi':
      return 'Hindi';
    case 'en':
      return 'English';
    case 'bilingual':
      return 'Bilingual (EN + HI)';
    default:
      return lang ? lang.toUpperCase() : 'Unknown';
  }
}

export interface ComputeAdminAnalyticsInput {
  source: 'server' | 'client-fallback';
  transactions: CoinTransaction[];
  history: ListeningHistoryEntry[];
  wallets: CoinWallet[];
  users: UserProfile[];
  stories: Story[];
  episodes: Episode[];
  creators: Creator[];
  categories: Category[];
  preset: AnalyticsDateRangePreset;
  granularity: AnalyticsTimeGranularity;
  customStartMs?: number | null;
  customEndMs?: number | null;
  nowMs?: number;
  pagination?: {
    transactionsScanned: number;
    historyScanned: number;
    truncated: boolean;
  };
}

export function computeAdminAnalyticsReport(
  input: ComputeAdminAnalyticsInput
): AdminAnalyticsReport {
  const nowMs = input.nowMs ?? Date.now();
  const { startMs, endMs } = resolveDateRangeBounds(
    input.preset,
    nowMs,
    input.customStartMs,
    input.customEndMs
  );

  const storyMap = new Map(input.stories.map((s) => [s.id, s]));
  const episodeMap = new Map(input.episodes.map((e) => [e.id, e]));
  const creatorMap = new Map(input.creators.map((c) => [c.id, c]));
  const categoryMap = new Map(input.categories.map((c) => [c.id, c]));
  const userMap = new Map(input.users.map((u) => [u.uid, u]));
  const walletMap = new Map(input.wallets.map((w) => [w.uid, w]));

  const filteredTx = input.transactions.filter((tx) =>
    isWithinRange(tx.createdAt, startMs, endMs)
  );
  const filteredHistory = input.history.filter((h) =>
    isWithinRange(h.updatedAt, startMs, endMs)
  );

  let totalPurchasedCoins = 0;
  let totalSpentCoins = 0;
  let totalBonusCoins = 0;
  let totalRefundCoins = 0;
  let totalAdminAdjustCoins = 0;
  let totalUnlocks = 0;

  const activeSpenderSet = new Set<string>();
  const timeBuckets = new Map<string, AnalyticsTimeSeriesBucket>();

  const ensureBucket = (ts: number): AnalyticsTimeSeriesBucket => {
    const { key, label } = getTimeBucketKeyAndLabel(ts, input.granularity);
    const existing = timeBuckets.get(key);
    if (existing) return existing;
    const created: AnalyticsTimeSeriesBucket = {
      bucketKey: key,
      label,
      purchasedCoins: 0,
      spentCoins: 0,
      bonusCoins: 0,
      refundCoins: 0,
      adminAdjustCoins: 0,
      unlockCount: 0,
      playCount: 0,
    };
    timeBuckets.set(key, created);
    return created;
  };

  // Breakdown accumulators
  interface BreakdownAcc {
    id: string;
    label: string;
    secondaryLabel?: string;
    coinsSpent: number;
    unlockCount: number;
    spenders: Set<string>;
  }
  const byStory = new Map<string, BreakdownAcc>();
  const byEpisode = new Map<
    string,
    BreakdownAcc & { storyId: string; storyTitle: string; episodeNumber: number }
  >();
  const byGenre = new Map<string, BreakdownAcc>();
  const byCreator = new Map<string, BreakdownAcc>();
  const byLanguage = new Map<string, BreakdownAcc>();

  const spenderAcc = new Map<
    string,
    { spent: number; purchased: number; unlocks: number }
  >();

  const addBreakdown = (
    map: Map<string, BreakdownAcc>,
    id: string,
    label: string,
    coins: number,
    uid: string,
    secondaryLabel?: string
  ) => {
    const prev = map.get(id);
    if (prev) {
      prev.coinsSpent += coins;
      prev.unlockCount += 1;
      prev.spenders.add(uid);
    } else {
      map.set(id, {
        id,
        label,
        secondaryLabel,
        coinsSpent: coins,
        unlockCount: 1,
        spenders: new Set([uid]),
      });
    }
  };

  for (const tx of filteredTx) {
    const bucket = ensureBucket(tx.createdAt);
    const absAmount = Math.abs(tx.amount);

    const sp = spenderAcc.get(tx.uid) ?? { spent: 0, purchased: 0, unlocks: 0 };

    if (tx.type === 'purchase' && tx.amount > 0) {
      totalPurchasedCoins += tx.amount;
      bucket.purchasedCoins += tx.amount;
      sp.purchased += tx.amount;
    } else if (tx.type === 'bonus' && tx.amount > 0) {
      totalBonusCoins += tx.amount;
      bucket.bonusCoins += tx.amount;
    } else if (tx.type === 'refund' && tx.amount > 0) {
      totalRefundCoins += tx.amount;
      bucket.refundCoins += tx.amount;
    } else if (tx.type === 'admin_adjust') {
      totalAdminAdjustCoins += tx.amount;
      bucket.adminAdjustCoins += tx.amount;
    } else if (tx.type === 'spend' && absAmount > 0) {
      totalSpentCoins += absAmount;
      totalUnlocks += 1;
      bucket.spentCoins += absAmount;
      bucket.unlockCount += 1;
      activeSpenderSet.add(tx.uid);
      sp.spent += absAmount;
      sp.unlocks += 1;

      const ep = tx.episodeId ? episodeMap.get(tx.episodeId) : undefined;
      const storyId = tx.storyId ?? ep?.storyId ?? 'unknown-story';
      const story = storyMap.get(storyId);
      const storyTitle = story?.title ?? storyId;

      // By Story
      addBreakdown(byStory, storyId, storyTitle, absAmount, tx.uid, story?.creatorName);

      // By Episode
      const epId = tx.episodeId ?? `${storyId}-unknown-ep`;
      const epLabel = ep ? `Ep ${ep.episodeNumber}: ${ep.title}` : epId;
      const prevEp = byEpisode.get(epId);
      if (prevEp) {
        prevEp.coinsSpent += absAmount;
        prevEp.unlockCount += 1;
        prevEp.spenders.add(tx.uid);
      } else {
        byEpisode.set(epId, {
          id: epId,
          label: epLabel,
          storyId,
          storyTitle,
          episodeNumber: ep?.episodeNumber ?? 0,
          coinsSpent: absAmount,
          unlockCount: 1,
          spenders: new Set([tx.uid]),
        });
      }

      // By Genre
      const genreId = story?.genreId ?? 'uncategorized';
      const cat = categoryMap.get(genreId);
      addBreakdown(byGenre, genreId, cat?.nameEn ?? genreId, absAmount, tx.uid);

      // By Creator
      const creatorId = story?.creatorId ?? tx.creatorId ?? 'unknown-creator';
      const creator = creatorMap.get(creatorId);
      const creatorName = creator?.name ?? story?.creatorName ?? creatorId;
      addBreakdown(byCreator, creatorId, creatorName, absAmount, tx.uid, creator?.handle);

      // By Language
      const langKey = story?.language ?? 'unknown';
      addBreakdown(byLanguage, langKey, formatLanguageLabel(langKey), absAmount, tx.uid);
    }

    spenderAcc.set(tx.uid, sp);
  }

  // Tracked plays & per-story conversion
  const playsByStory = new Map<string, { plays: number; listeners: Set<string> }>();
  for (const h of filteredHistory) {
    const bucket = ensureBucket(h.updatedAt);
    bucket.playCount += 1;
    const entry = playsByStory.get(h.storyId);
    if (entry) {
      entry.plays += 1;
      entry.listeners.add(h.userId);
    } else {
      playsByStory.set(h.storyId, { plays: 1, listeners: new Set([h.userId]) });
    }
  }

  const finalizeBreakdown = (map: Map<string, BreakdownAcc>): AnalyticsBreakdownItem[] =>
    Array.from(map.values())
      .map((item) => ({
        id: item.id,
        label: item.label,
        secondaryLabel: item.secondaryLabel,
        coinsSpent: item.coinsSpent,
        unlockCount: item.unlockCount,
        uniqueSpenders: item.spenders.size,
        sharePct: roundPct(item.coinsSpent, totalSpentCoins),
      }))
      .sort((a, b) => b.coinsSpent - a.coinsSpent || b.unlockCount - a.unlockCount);

  const spendByStory = finalizeBreakdown(byStory);
  const spendByGenre = finalizeBreakdown(byGenre);
  const spendByCreator = finalizeBreakdown(byCreator);
  const spendByLanguage = finalizeBreakdown(byLanguage);

  const spendByEpisode: AnalyticsEpisodeBreakdownItem[] = Array.from(byEpisode.values())
    .map((item) => ({
      id: item.id,
      label: item.label,
      storyId: item.storyId,
      storyTitle: item.storyTitle,
      episodeNumber: item.episodeNumber,
      coinsSpent: item.coinsSpent,
      unlockCount: item.unlockCount,
      uniqueSpenders: item.spenders.size,
      sharePct: roundPct(item.coinsSpent, totalSpentCoins),
    }))
    .sort((a, b) => b.coinsSpent - a.coinsSpent || b.unlockCount - a.unlockCount);

  const topSpenders: AnalyticsSpenderItem[] = Array.from(spenderAcc.entries())
    .filter(([, stats]) => stats.spent > 0 || stats.purchased > 0)
    .map(([uid, stats]) => {
      const user = userMap.get(uid);
      const wallet = walletMap.get(uid);
      return {
        uid,
        displayName: user?.displayName ?? uid,
        email: user?.email ?? '',
        totalSpent: stats.spent,
        totalPurchased: stats.purchased,
        currentBalance: wallet?.balance ?? 0,
        unlockCount: stats.unlocks,
        banned: Boolean(user?.banned),
        warningCount: user?.warningCount ?? 0,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent || b.totalPurchased - a.totalPurchased);

  // Conversion by story (unlocks vs tracked plays)
  const conversionStoryIds = new Set<string>([
    ...Array.from(playsByStory.keys()),
    ...Array.from(byStory.keys()),
  ]);
  const conversionByStory: AnalyticsConversionRow[] = Array.from(conversionStoryIds)
    .map((storyId) => {
      const story = storyMap.get(storyId);
      const playStats = playsByStory.get(storyId);
      const spendStats = byStory.get(storyId);
      const trackedPlays = playStats?.plays ?? 0;
      const unlockCount = spendStats?.unlockCount ?? 0;
      return {
        storyId,
        storyTitle: story?.title ?? storyId,
        creatorName: story?.creatorName ?? '—',
        trackedPlays,
        uniqueListeners: playStats?.listeners.size ?? 0,
        unlockCount,
        coinsEarned: spendStats?.coinsSpent ?? 0,
        conversionRatePct: roundPct(unlockCount, Math.max(trackedPlays, unlockCount)),
      };
    })
    .sort((a, b) => b.coinsEarned - a.coinsEarned || b.trackedPlays - a.trackedPlays);

  const balanceOutstandingCoins = input.wallets.reduce(
    (sum, w) => sum + Math.max(0, Number(w.balance) || 0),
    0
  );
  const totalTrackedPlays = filteredHistory.length;
  const bannedUsers = input.users.filter((u) => u.banned).length;

  const timeSeries = Array.from(timeBuckets.values()).sort((a, b) =>
    a.bucketKey.localeCompare(b.bucketKey)
  );

  return {
    source: input.source,
    generatedAt: nowMs,
    range: {
      preset: input.preset,
      startMs,
      endMs,
      granularity: input.granularity,
    },
    pagination: input.pagination ?? {
      transactionsScanned: input.transactions.length,
      historyScanned: input.history.length,
      truncated: false,
    },
    kpis: {
      totalPurchasedCoins,
      totalSpentCoins,
      totalBonusCoins,
      totalRefundCoins,
      totalAdminAdjustCoins,
      balanceOutstandingCoins,
      totalUnlocks,
      totalTrackedPlays,
      overallConversionPct: roundPct(totalUnlocks, Math.max(totalTrackedPlays, totalUnlocks)),
      activeSpenders: activeSpenderSet.size,
      totalUsers: input.users.length,
      bannedUsers,
    },
    timeSeries,
    spendByStory,
    spendByEpisode,
    spendByGenre,
    spendByCreator,
    spendByLanguage,
    topSpenders,
    topStoriesByCoins: spendByStory.slice(0, 15),
    topCreatorsByCoins: spendByCreator.slice(0, 15),
    conversionByStory,
  };
}

export function computePerUserAnalytics(input: {
  user: UserProfile;
  wallet: CoinWallet | null;
  transactions: CoinTransaction[];
  history: ListeningHistoryEntry[];
  sessions: SessionLogEntry[];
  stories: Story[];
  episodes: Episode[];
  startMs?: number | null;
  endMs?: number | null;
}): PerUserAnalyticsDetail {
  const storyMap = new Map(input.stories.map((s) => [s.id, s]));
  const episodeMap = new Map(input.episodes.map((e) => [e.id, e]));

  const userTx = input.transactions
    .filter((tx) => tx.uid === input.user.uid)
    .filter((tx) => isWithinRange(tx.createdAt, input.startMs ?? null, input.endMs ?? null))
    .sort((a, b) => b.createdAt - a.createdAt);

  let rangePurchased = 0;
  let rangeSpent = 0;
  const storyGroups = new Map<string, PerUserSpendStoryGroup>();

  for (const tx of userTx) {
    if (tx.type === 'purchase' && tx.amount > 0) {
      rangePurchased += tx.amount;
    } else if (tx.type === 'spend' && tx.amount !== 0) {
      const coins = Math.abs(tx.amount);
      rangeSpent += coins;
      const ep = tx.episodeId ? episodeMap.get(tx.episodeId) : undefined;
      const storyId = tx.storyId ?? ep?.storyId ?? 'unknown-story';
      const story = storyMap.get(storyId);
      const storyTitle = story?.title ?? storyId;
      const group = storyGroups.get(storyId) ?? {
        storyId,
        storyTitle,
        totalCoins: 0,
        episodes: [],
      };
      group.totalCoins += coins;
      group.episodes.push({
        episodeId: tx.episodeId ?? 'unknown',
        episodeTitle: ep?.title ?? tx.note,
        episodeNumber: ep?.episodeNumber ?? null,
        coins,
        createdAt: tx.createdAt,
      });
      storyGroups.set(storyId, group);
    }
  }

  const userHistory = input.history
    .filter((h) => h.userId === input.user.uid)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((h) => {
      const story = storyMap.get(h.storyId);
      const ep = episodeMap.get(h.episodeId);
      return {
        ...h,
        storyTitle: story?.title ?? h.storyId,
        episodeTitle: ep?.title ?? `Episode ${h.episodeNumber}`,
      };
    });

  const userSessions = input.sessions
    .filter((s) => s.uid === input.user.uid)
    .sort((a, b) => b.createdAt - a.createdAt);

  return {
    uid: input.user.uid,
    displayName: input.user.displayName,
    email: input.user.email,
    phoneNumber: input.user.phoneNumber,
    role: input.user.role,
    balance: input.wallet?.balance ?? 0,
    lifetimePurchased: input.wallet?.lifetimePurchased ?? rangePurchased,
    lifetimeSpent: input.wallet?.lifetimeSpent ?? rangeSpent,
    rangePurchased,
    rangeSpent,
    warningCount: input.user.warningCount ?? 0,
    banned: Boolean(input.user.banned),
    banReason: input.user.banReason ?? null,
    activeDevice: input.user.activeDevice ?? null,
    lastSeen: typeof input.user.lastSeen === 'number' ? input.user.lastSeen : null,
    spendByStory: Array.from(storyGroups.values()).sort((a, b) => b.totalCoins - a.totalCoins),
    transactions: userTx,
    listeningHistory: userHistory,
    sessions: userSessions,
  };
}

export function computeUserMyCoinsAnalytics(input: {
  transactions: CoinTransaction[];
  stories: Story[];
  episodes: Episode[];
  granularity: AnalyticsTimeGranularity;
}): UserMyCoinsAnalytics {
  const storyMap = new Map(input.stories.map((s) => [s.id, s]));
  const episodeMap = new Map(input.episodes.map((e) => [e.id, e]));

  let totalPurchased = 0;
  let totalSpent = 0;
  let totalBonus = 0;
  let episodesUnlockedCount = 0;

  const byStory = new Map<
    string,
    { storyId: string; storyTitle: string; coinsSpent: number; unlockCount: number }
  >();
  const buckets = new Map<
    string,
    { bucketKey: string; label: string; spentCoins: number; creditedCoins: number }
  >();

  for (const tx of input.transactions) {
    const { key, label } = getTimeBucketKeyAndLabel(tx.createdAt, input.granularity);
    const bucket = buckets.get(key) ?? {
      bucketKey: key,
      label,
      spentCoins: 0,
      creditedCoins: 0,
    };

    if (tx.type === 'purchase' && tx.amount > 0) {
      totalPurchased += tx.amount;
      bucket.creditedCoins += tx.amount;
    } else if (tx.type === 'bonus' && tx.amount > 0) {
      totalBonus += tx.amount;
      bucket.creditedCoins += tx.amount;
    } else if (tx.amount > 0) {
      bucket.creditedCoins += tx.amount;
    } else if (tx.type === 'spend' && tx.amount < 0) {
      const coins = Math.abs(tx.amount);
      totalSpent += coins;
      episodesUnlockedCount += 1;
      bucket.spentCoins += coins;

      const ep = tx.episodeId ? episodeMap.get(tx.episodeId) : undefined;
      const storyId = tx.storyId ?? ep?.storyId ?? 'other';
      const storyTitle = storyMap.get(storyId)?.title ?? tx.note ?? storyId;
      const prev = byStory.get(storyId);
      if (prev) {
        prev.coinsSpent += coins;
        prev.unlockCount += 1;
      } else {
        byStory.set(storyId, {
          storyId,
          storyTitle,
          coinsSpent: coins,
          unlockCount: 1,
        });
      }
    }

    buckets.set(key, bucket);
  }

  const spendByStory = Array.from(byStory.values())
    .map((item) => ({
      ...item,
      sharePct: roundPct(item.coinsSpent, totalSpent),
    }))
    .sort((a, b) => b.coinsSpent - a.coinsSpent || b.unlockCount - a.unlockCount);

  return {
    totalPurchased,
    totalSpent,
    totalBonus,
    storiesSupportedCount: spendByStory.length,
    episodesUnlockedCount,
    spendByStory,
    timeSeries: Array.from(buckets.values()).sort((a, b) =>
      a.bucketKey.localeCompare(b.bucketKey)
    ),
  };
}

/**
 * RFC-4180 CSV cell escaping with spreadsheet formula-injection neutralization
 * (prefixes cells starting with =, +, -, @, tab, or CR with a leading single quote).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvDocument(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

export type AnalyticsCsvSection =
  | 'time_series'
  | 'spend_by_story'
  | 'spend_by_episode'
  | 'spend_by_genre'
  | 'spend_by_creator'
  | 'spend_by_language'
  | 'top_spenders'
  | 'conversion';

export function buildAdminAnalyticsCsv(
  section: AnalyticsCsvSection,
  report: AdminAnalyticsReport
): { filename: string; csv: string } {
  const dateStamp = new Date(report.generatedAt).toISOString().slice(0, 10);

  switch (section) {
    case 'time_series':
      return {
        filename: `dhruv-tales-coins-timeseries-${report.range.granularity}-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Period', 'Purchased Coins', 'Spent Coins', 'Bonus Coins', 'Refund Coins', 'Admin Adjust', 'Unlocks', 'Tracked Plays'],
          report.timeSeries.map((b) => [
            b.label,
            b.purchasedCoins,
            b.spentCoins,
            b.bonusCoins,
            b.refundCoins,
            b.adminAdjustCoins,
            b.unlockCount,
            b.playCount,
          ])
        ),
      };
    case 'spend_by_story':
      return {
        filename: `dhruv-tales-spend-by-story-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Story ID', 'Story Title', 'Creator', 'Coins Spent', 'Unlocks', 'Unique Spenders', 'Share %'],
          report.spendByStory.map((r) => [
            r.id,
            r.label,
            r.secondaryLabel ?? '',
            r.coinsSpent,
            r.unlockCount,
            r.uniqueSpenders,
            r.sharePct,
          ])
        ),
      };
    case 'spend_by_episode':
      return {
        filename: `dhruv-tales-spend-by-episode-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Episode ID', 'Story Title', 'Episode #', 'Episode', 'Coins Spent', 'Unlocks', 'Unique Spenders', 'Share %'],
          report.spendByEpisode.map((r) => [
            r.id,
            r.storyTitle,
            r.episodeNumber,
            r.label,
            r.coinsSpent,
            r.unlockCount,
            r.uniqueSpenders,
            r.sharePct,
          ])
        ),
      };
    case 'spend_by_genre':
      return {
        filename: `dhruv-tales-spend-by-genre-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Genre ID', 'Genre', 'Coins Spent', 'Unlocks', 'Unique Spenders', 'Share %'],
          report.spendByGenre.map((r) => [
            r.id,
            r.label,
            r.coinsSpent,
            r.unlockCount,
            r.uniqueSpenders,
            r.sharePct,
          ])
        ),
      };
    case 'spend_by_creator':
      return {
        filename: `dhruv-tales-spend-by-creator-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Creator ID', 'Creator', 'Handle', 'Coins Earned', 'Unlocks', 'Unique Spenders', 'Share %'],
          report.spendByCreator.map((r) => [
            r.id,
            r.label,
            r.secondaryLabel ?? '',
            r.coinsSpent,
            r.unlockCount,
            r.uniqueSpenders,
            r.sharePct,
          ])
        ),
      };
    case 'spend_by_language':
      return {
        filename: `dhruv-tales-spend-by-language-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Language', 'Coins Spent', 'Unlocks', 'Unique Spenders', 'Share %'],
          report.spendByLanguage.map((r) => [
            r.label,
            r.coinsSpent,
            r.unlockCount,
            r.uniqueSpenders,
            r.sharePct,
          ])
        ),
      };
    case 'top_spenders':
      return {
        filename: `dhruv-tales-top-spenders-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['User ID', 'Display Name', 'Email', 'Coins Spent', 'Coins Purchased', 'Current Balance', 'Unlocks', 'Warnings', 'Banned'],
          report.topSpenders.map((u) => [
            u.uid,
            u.displayName,
            u.email,
            u.totalSpent,
            u.totalPurchased,
            u.currentBalance,
            u.unlockCount,
            u.warningCount,
            u.banned ? 'Yes' : 'No',
          ])
        ),
      };
    case 'conversion':
    default:
      return {
        filename: `dhruv-tales-conversion-${dateStamp}.csv`,
        csv: buildCsvDocument(
          ['Story ID', 'Story Title', 'Creator', 'Tracked Plays', 'Unique Listeners', 'Unlocks', 'Coins Earned', 'Conversion %'],
          report.conversionByStory.map((c) => [
            c.storyId,
            c.storyTitle,
            c.creatorName,
            c.trackedPlays,
            c.uniqueListeners,
            c.unlockCount,
            c.coinsEarned,
            c.conversionRatePct,
          ])
        ),
      };
  }
}

export function buildPerUserAnalyticsCsv(detail: PerUserAnalyticsDetail): {
  filename: string;
  csv: string;
} {
  const safeId = detail.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
  return {
    filename: `dhruv-tales-user-${safeId}-transactions.csv`,
    csv: buildCsvDocument(
      ['Transaction ID', 'Date (ISO)', 'Type', 'Amount', 'Balance After', 'Story ID', 'Episode ID', 'Note'],
      detail.transactions.map((tx) => [
        tx.id,
        new Date(tx.createdAt).toISOString(),
        tx.type,
        tx.amount,
        tx.balanceAfter,
        tx.storyId ?? '',
        tx.episodeId ?? '',
        tx.note,
      ])
    ),
  };
}
