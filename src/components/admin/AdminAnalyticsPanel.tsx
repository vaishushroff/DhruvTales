import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Ban,
  BarChart3,
  Coins,
  Download,
  History,
  Laptop,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  User as UserIcon,
  Users,
} from 'lucide-react';
import {
  buildAdminAnalyticsCsv,
  buildPerUserAnalyticsCsv,
  type AnalyticsCsvSection,
} from '../../../api/_lib/analyticsEngine';
import type {
  AdminAnalyticsReport,
  AnalyticsBreakdownItem,
  AnalyticsDateRangePreset,
  AnalyticsTimeGranularity,
  Category,
  CoinWallet,
  Creator,
  Episode,
  PerUserAnalyticsDetail,
  Story,
  UserProfile,
} from '../../types';
import {
  fetchAdminAnalyticsReport,
  fetchPerUserAnalyticsDetail,
} from '../../services/firebase/adminCmsService';
import { useLanguage } from '../../hooks/useLanguage';

interface AdminAnalyticsPanelProps {
  firebaseUser: User | null;
  users: UserProfile[];
  wallets: CoinWallet[];
  stories: Story[];
  episodes: Episode[];
  creators: Creator[];
  categories: Category[];
  initialInspectUserId?: string | null;
  onClearInitialInspect?: () => void;
}

type SpendTab = 'story' | 'episode' | 'genre' | 'creator' | 'language';

function triggerCsvDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export const AdminAnalyticsPanel: React.FC<AdminAnalyticsPanelProps> = ({
  firebaseUser,
  users,
  wallets,
  stories,
  episodes,
  creators,
  categories,
  initialInspectUserId,
  onClearInitialInspect,
}) => {
  const { t } = useLanguage();
  const [preset, setPreset] = useState<AnalyticsDateRangePreset>('30d');
  const [granularity, setGranularity] = useState<AnalyticsTimeGranularity>('daily');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [spendTab, setSpendTab] = useState<SpendTab>('story');
  const [csvSection, setCsvSection] = useState<AnalyticsCsvSection>('spend_by_story');

  const [report, setReport] = useState<AdminAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-user search & detail inspector
  const [userSearch, setUserSearch] = useState('');
  const [selectedUid, setSelectedUid] = useState<string>(initialInspectUserId ?? '');
  const [userDetail, setUserDetail] = useState<PerUserAnalyticsDetail | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const fallbackCtx = useMemo(
    () => ({ users, wallets, stories, episodes, creators, categories }),
    [users, wallets, stories, episodes, creators, categories]
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAdminAnalyticsReport(
        firebaseUser,
        { preset, granularity, from: fromDate || undefined, to: toDate || undefined },
        fallbackCtx
      );
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analytics report.');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, preset, granularity, fromDate, toDate, fallbackCtx]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const loadUserDetail = useCallback(
    async (uid: string) => {
      if (!uid) {
        setUserDetail(null);
        return;
      }
      setSelectedUid(uid);
      setUserLoading(true);
      setUserError(null);
      try {
        const detail = await fetchPerUserAnalyticsDetail(
          firebaseUser,
          uid,
          { preset, granularity, from: fromDate || undefined, to: toDate || undefined },
          fallbackCtx
        );
        setUserDetail(detail);
      } catch (err) {
        setUserError(err instanceof Error ? err.message : 'Unable to load user analytics.');
      } finally {
        setUserLoading(false);
      }
    },
    [firebaseUser, preset, granularity, fromDate, toDate, fallbackCtx]
  );

  useEffect(() => {
    if (initialInspectUserId) {
      void loadUserDetail(initialInspectUserId);
      onClearInitialInspect?.();
    }
  }, [initialInspectUserId, loadUserDetail, onClearInitialInspect]);

  const matchingUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    return users
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.phoneNumber ?? '').toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [users, userSearch]);

  const activeBreakdown: AnalyticsBreakdownItem[] = useMemo(() => {
    if (!report) return [];
    switch (spendTab) {
      case 'story':
        return report.spendByStory;
      case 'episode':
        return report.spendByEpisode;
      case 'genre':
        return report.spendByGenre;
      case 'creator':
        return report.spendByCreator;
      case 'language':
        return report.spendByLanguage;
      default:
        return [];
    }
  }, [report, spendTab]);

  const maxSeriesCoins = useMemo(() => {
    if (!report) return 1;
    let m = 1;
    for (const b of report.timeSeries) {
      m = Math.max(m, b.purchasedCoins, b.spentCoins, b.bonusCoins);
    }
    return m;
  }, [report]);

  const maxBreakdownCoins = useMemo(
    () => Math.max(1, ...activeBreakdown.map((item) => item.coinsSpent)),
    [activeBreakdown]
  );

  const handleExportCsv = () => {
    if (!report) return;
    const { filename, csv } = buildAdminAnalyticsCsv(csvSection, report);
    triggerCsvDownload(filename, csv);
  };

  return (
    <div data-testid="admin-analytics-panel" className="space-y-6">
      {/* Top Filter & Export Bar */}
      <div className="rounded-2xl bg-[#141418] border border-white/10 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['7d', '30d', '90d', 'all', 'custom'] as AnalyticsDateRangePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-medium transition-colors ${
                preset === p
                  ? 'bg-[#E5A93C] text-[#0B0B0E]'
                  : 'bg-[#0B0B0E] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
              }`}
            >
              {t(`analytics.range_${p}`)}
            </button>
          ))}

          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 ml-1">
              <input
                type="date"
                aria-label="Start date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE]"
              />
              <span className="text-xs text-[#9B968B]">to</span>
              <input
                type="date"
                aria-label="End date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE]"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-[#0B0B0E] border border-white/10 p-0.5">
            {(['daily', 'weekly', 'monthly'] as AnalyticsTimeGranularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`min-h-[34px] px-2.5 rounded-md text-xs font-medium ${
                  granularity === g ? 'bg-[#E5A93C] text-[#0B0B0E]' : 'text-[#A39E93] hover:text-[#F5F3EE]'
                }`}
              >
                {t(`analytics.granularity_${g}`)}
              </button>
            ))}
          </div>

          <select
            aria-label="CSV report section"
            value={csvSection}
            onChange={(e) => setCsvSection(e.target.value as AnalyticsCsvSection)}
            className="min-h-[38px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/15 text-xs text-[#F5F3EE]"
          >
            <option value="time_series">Time Series CSV</option>
            <option value="spend_by_story">Spend by Story CSV</option>
            <option value="spend_by_episode">Spend by Episode CSV</option>
            <option value="spend_by_genre">Spend by Genre CSV</option>
            <option value="spend_by_creator">Spend by Creator CSV</option>
            <option value="spend_by_language">Spend by Language CSV</option>
            <option value="top_spenders">Top Spenders CSV</option>
            <option value="conversion">Conversion CSV</option>
          </select>

          <button
            type="button"
            data-testid="admin-export-csv-btn"
            disabled={!report}
            onClick={handleExportCsv}
            className="min-h-[38px] px-3.5 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            {t('analytics.exportCsv')}
          </button>

          <button
            type="button"
            onClick={() => void loadReport()}
            className="min-h-[38px] px-3 rounded-lg border border-white/15 text-xs text-[#D6D2C9] hover:text-[#F5F3EE] inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Source transparency & pagination notice */}
      {report && (
        <div className="rounded-xl bg-[#141418] border border-white/8 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#A39E93]">
          <span>
            Source:{' '}
            <strong className="text-[#F5F3EE]">
              {report.source === 'server'
                ? 'Server Aggregation (/api/admin/analytics)'
                : 'Client Admin Fallback (Firestore read-only preview)'}
            </strong>
          </span>
          <span className="tabular-nums">
            Scanned {report.pagination.transactionsScanned.toLocaleString()} coin transactions &amp;{' '}
            {report.pagination.historyScanned.toLocaleString()} play records
            {report.pagination.truncated ? ' (capped for performance — narrow date range for full scan)' : ''}
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl bg-[#B85D43]/15 border border-[#B85D43]/35 p-4 text-xs text-[#F5C2B4]">
          {error}
        </div>
      )}

      {loading && !report ? (
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-10 text-center text-sm text-[#A39E93]">
          Loading analytics report...
        </div>
      ) : report ? (
        <>
          {/* Coins Overview KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiPurchased')}</p>
              <p className="text-2xl font-semibold text-[#6BAE8E] tabular-nums">
                {report.kpis.totalPurchasedCoins.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#7E796F]">
                +{report.kpis.totalBonusCoins.toLocaleString()} bonus
              </p>
            </div>
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiSpent')}</p>
              <p className="text-2xl font-semibold text-[#F3C669] tabular-nums">
                {report.kpis.totalSpentCoins.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#7E796F]">
                {report.kpis.totalUnlocks.toLocaleString()} unlocks
              </p>
            </div>
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiOutstanding')}</p>
              <p className="text-2xl font-semibold text-[#F5F3EE] tabular-nums">
                {report.kpis.balanceOutstandingCoins.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#7E796F]">across all wallets</p>
            </div>
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiConversion')}</p>
              <p className="text-2xl font-semibold text-[#F5F3EE] tabular-nums">
                {report.kpis.overallConversionPct}%
              </p>
              <p className="text-[11px] text-[#7E796F]">
                {report.kpis.totalUnlocks} / {report.kpis.totalTrackedPlays} plays
              </p>
            </div>
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiSpenders')}</p>
              <p className="text-2xl font-semibold text-[#F5F3EE] tabular-nums">
                {report.kpis.activeSpenders.toLocaleString()}
              </p>
              <p className="text-[11px] text-[#7E796F]">
                of {report.kpis.totalUsers.toLocaleString()} users
              </p>
            </div>
            <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
              <p className="text-[11px] text-[#A39E93]">{t('analytics.kpiBanned')}</p>
              <p className="text-2xl font-semibold text-[#F5C2B4] tabular-nums">
                {report.kpis.bannedUsers}
              </p>
              <p className="text-[11px] text-[#7E796F]">
                {report.kpis.totalRefundCoins} refunded coins
              </p>
            </div>
          </div>

          {/* Daily / Weekly / Monthly Time-Series Chart */}
          <section className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                {t('analytics.coinVolumeChartTitle')} ({granularity})
              </h3>
              <div className="flex items-center gap-4 text-xs text-[#A39E93]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#6BAE8E]" />
                  Purchased
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#E5A93C]" />
                  Spent
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#8B8EF7]" />
                  Bonus
                </span>
              </div>
            </div>

            {report.timeSeries.length === 0 ? (
              <p className="text-xs text-[#A39E93] py-10 text-center">
                No coin transactions or listening records in this date range yet.
              </p>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div className="min-w-[460px] h-52 flex items-end gap-2 pt-4">
                  {report.timeSeries.slice(-24).map((b) => {
                    const pH = Math.round((b.purchasedCoins / maxSeriesCoins) * 100);
                    const sH = Math.round((b.spentCoins / maxSeriesCoins) * 100);
                    const bnH = Math.round((b.bonusCoins / maxSeriesCoins) * 100);
                    return (
                      <div
                        key={b.bucketKey}
                        className="flex-1 min-w-[36px] h-full flex flex-col items-center justify-end gap-1.5"
                        title={`${b.label}: Purchased ${b.purchasedCoins}, Spent ${b.spentCoins}, Bonus ${b.bonusCoins}, Plays ${b.playCount}`}
                      >
                        <div className="w-full flex-1 flex items-end justify-center gap-0.5">
                          <div
                            className="w-2.5 rounded-t bg-[#6BAE8E]"
                            style={{ height: `${b.purchasedCoins > 0 ? Math.max(6, pH) : 0}%` }}
                          />
                          <div
                            className="w-2.5 rounded-t bg-[#E5A93C]"
                            style={{ height: `${b.spentCoins > 0 ? Math.max(6, sH) : 0}%` }}
                          />
                          <div
                            className="w-2 rounded-t bg-[#8B8EF7]"
                            style={{ height: `${b.bonusCoins > 0 ? Math.max(6, bnH) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-[#9B968B] tabular-nums truncate max-w-full">
                          {b.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Where Users Spend Breakdown + Top Spenders */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                  {t('analytics.whereUsersSpend')}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {(['story', 'episode', 'genre', 'creator', 'language'] as SpendTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSpendTab(tab)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium capitalize ${
                        spendTab === tab
                          ? 'bg-[#E5A93C] text-[#0B0B0E]'
                          : 'bg-[#0B0B0E] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {activeBreakdown.length === 0 ? (
                <p className="text-xs text-[#A39E93] py-8 text-center">
                  No coin spend recorded in this period.
                </p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {activeBreakdown.slice(0, 15).map((item) => {
                    const barW = Math.max(6, Math.round((item.coinsSpent / maxBreakdownCoins) * 100));
                    return (
                      <div key={item.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[#F5F3EE] font-medium truncate">
                            {item.label}
                            {item.secondaryLabel ? (
                              <span className="text-[#9B968B] font-normal"> · {item.secondaryLabel}</span>
                            ) : null}
                          </span>
                          <span className="text-[#F3C669] font-semibold tabular-nums shrink-0">
                            {item.coinsSpent.toLocaleString()} coins ({item.unlockCount} unlocks · {item.sharePct}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#E5A93C]"
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Top Spenders */}
            <section className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
              <h3 className="text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                {t('analytics.topSpenders')}
              </h3>
              {report.topSpenders.length === 0 ? (
                <p className="text-xs text-[#A39E93] py-8 text-center">
                  No spender data in this date range yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[11px] text-[#9B968B] border-b border-white/10">
                      <tr>
                        <th className="py-2 pr-2">User</th>
                        <th className="py-2 px-2 text-right">Spent</th>
                        <th className="py-2 px-2 text-right">Bought</th>
                        <th className="py-2 px-2 text-right">Balance</th>
                        <th className="py-2 pl-2 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {report.topSpenders.slice(0, 10).map((sp) => (
                        <tr key={sp.uid} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-2">
                            <p className="font-medium text-[#F5F3EE] truncate max-w-[160px]">
                              {sp.displayName}
                            </p>
                            <p className="text-[11px] text-[#9B968B] truncate max-w-[160px]">
                              {sp.email || sp.uid}
                            </p>
                          </td>
                          <td className="py-2.5 px-2 text-right font-semibold text-[#F3C669] tabular-nums">
                            {sp.totalSpent.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-2 text-right text-[#6BAE8E] tabular-nums">
                            {sp.totalPurchased.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-2 text-right text-[#F5F3EE] tabular-nums">
                            {sp.currentBalance.toLocaleString()}
                          </td>
                          <td className="py-2.5 pl-2 text-right">
                            <button
                              type="button"
                              onClick={() => void loadUserDetail(sp.uid)}
                              className="px-2.5 py-1 rounded-lg bg-[#0B0B0E] border border-white/15 text-[#F3C669] hover:border-[#E5A93C]"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Conversion Table: Unlocks vs Plays per Story */}
          <section className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <h3 className="text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              {t('analytics.conversionTitle')}
            </h3>
            {report.conversionByStory.length === 0 ? (
              <p className="text-xs text-[#A39E93] py-6 text-center">
                No play or unlock events recorded in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-[#9B968B] border-b border-white/10">
                    <tr>
                      <th className="py-2 pr-3">Story</th>
                      <th className="py-2 px-2">Creator</th>
                      <th className="py-2 px-2 text-right">Tracked Plays</th>
                      <th className="py-2 px-2 text-right">Listeners</th>
                      <th className="py-2 px-2 text-right">Unlocks</th>
                      <th className="py-2 px-2 text-right">Coins Earned</th>
                      <th className="py-2 pl-2 text-right">Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {report.conversionByStory.slice(0, 15).map((row) => (
                      <tr key={row.storyId}>
                        <td className="py-2.5 pr-3 font-medium text-[#F5F3EE]">{row.storyTitle}</td>
                        <td className="py-2.5 px-2 text-[#A39E93]">{row.creatorName}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums">{row.trackedPlays}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums">{row.uniqueListeners}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-[#F3C669]">{row.unlockCount}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-[#6BAE8E]">
                          {row.coinsEarned.toLocaleString()}
                        </td>
                        <td className="py-2.5 pl-2 text-right tabular-nums font-semibold text-[#F5F3EE]">
                          {row.conversionRatePct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {/* Per-User Analytics Deep Dive */}
      <section
        data-testid="admin-per-user-inspector"
        className="rounded-2xl bg-[#141418] border border-[#E5A93C]/25 p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-display font-semibold text-[#F5F3EE] flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
              {t('analytics.perUserTitle')}
            </h3>
            <p className="text-xs text-[#A39E93]">
              {t('analytics.perUserSubtitle')}
            </p>
          </div>

          {userDetail && (
            <button
              type="button"
              onClick={() => {
                const { filename, csv } = buildPerUserAnalyticsCsv(userDetail);
                triggerCsvDownload(filename, csv);
              }}
              className="min-h-[38px] px-3.5 rounded-lg border border-white/15 text-xs font-medium text-[#F3C669] hover:border-[#E5A93C] inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export User Ledger CSV
            </button>
          )}
        </div>

        {/* User Search Bar */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-[#9B968B] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search user by name, email, phone, or UID..."
                className="w-full min-h-[42px] pl-9 pr-3 rounded-xl bg-[#0B0B0E] border border-white/12 text-xs text-[#F5F3EE] placeholder:text-[#7E796F]"
              />
            </div>
            <div className="rounded-xl bg-[#0B0B0E] border border-white/10 divide-y divide-white/[0.06] max-h-72 overflow-y-auto">
              {matchingUsers.map((u) => {
                const active = selectedUid === u.uid;
                return (
                  <button
                    key={u.uid}
                    type="button"
                    onClick={() => void loadUserDetail(u.uid)}
                    className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center justify-between gap-2 ${
                      active ? 'bg-[#E5A93C]/15 text-[#F3C669]' : 'hover:bg-white/[0.03] text-[#D6D2C9]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{u.displayName}</p>
                      <p className="text-[11px] text-[#9B968B] truncate">{u.email || u.phoneNumber || u.uid}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {u.banned && <Ban className="w-3.5 h-3.5 text-[#E57373]" aria-label="Banned" />}
                      {(u.warningCount ?? 0) > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5A93C]/20 text-[#F3C669] tabular-nums">
                          W:{u.warningCount}/3
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected User Detail */}
          <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-4">
            {userLoading ? (
              <p className="text-xs text-[#A39E93] py-10 text-center">Loading user profile &amp; ledger...</p>
            ) : userError ? (
              <p className="text-xs text-[#F5C2B4] py-6 text-center">{userError}</p>
            ) : !userDetail ? (
              <p className="text-xs text-[#A39E93] py-10 text-center">
                Select any user on the left (or click View in Top Spenders / Users tab) to inspect balance, spend by story &amp; episode, listening activity, warnings, device/session log, and ban state.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Identity & Status Strip */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-3">
                  <div>
                    <p className="text-sm font-semibold text-[#F5F3EE]">{userDetail.displayName}</p>
                    <p className="text-xs text-[#9B968B]">
                      {userDetail.email || userDetail.phoneNumber} · {userDetail.role} · UID: {userDetail.uid}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1 ${
                        userDetail.banned
                          ? 'bg-[#B85D43]/25 text-[#F5C2B4]'
                          : 'bg-[#6BAE8E]/15 text-[#6BAE8E]'
                      }`}
                    >
                      {userDetail.banned ? <Ban className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      {userDetail.banned ? 'BANNED' : 'Active'}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-[#E5A93C]/15 text-[#F3C669] tabular-nums inline-flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Warnings: {userDetail.warningCount} / 3
                    </span>
                  </div>
                </div>

                {/* Balance / Bought / Spent / Device */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="rounded-lg bg-[#141418] border border-white/8 p-3">
                    <p className="text-[11px] text-[#9B968B]">Current Balance</p>
                    <p className="text-lg font-semibold text-[#F3C669] tabular-nums">
                      {userDetail.balance.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#141418] border border-white/8 p-3">
                    <p className="text-[11px] text-[#9B968B]">Total Bought</p>
                    <p className="text-lg font-semibold text-[#6BAE8E] tabular-nums">
                      {userDetail.lifetimePurchased.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#141418] border border-white/8 p-3">
                    <p className="text-[11px] text-[#9B968B]">Total Spent</p>
                    <p className="text-lg font-semibold text-[#F5F3EE] tabular-nums">
                      {userDetail.lifetimeSpent.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#141418] border border-white/8 p-3">
                    <p className="text-[11px] text-[#9B968B] flex items-center gap-1">
                      <Laptop className="w-3 h-3" /> Active Device
                    </p>
                    <p className="text-xs font-medium text-[#F5F3EE] truncate mt-1">
                      {userDetail.activeDevice?.deviceInfo?.label ?? 'None active'}
                    </p>
                    <p className="text-[10px] text-[#7E796F] truncate">
                      {userDetail.activeDevice?.lastSeen
                        ? formatDateTime(userDetail.activeDevice.lastSeen)
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Spend by Story & Episode */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[#A39E93]">
                    Spend History by Story &amp; Episode ({userDetail.spendByStory.length})
                  </h4>
                  {userDetail.spendByStory.length === 0 ? (
                    <p className="text-xs text-[#7E796F]">No paid episode unlocks in this range.</p>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {userDetail.spendByStory.map((grp) => (
                        <div key={grp.storyId} className="rounded-lg bg-[#141418] border border-white/8 p-3 space-y-1.5 text-xs">
                          <div className="flex justify-between font-semibold text-[#F5F3EE]">
                            <span>{grp.storyTitle}</span>
                            <span className="text-[#F3C669] tabular-nums">{grp.totalCoins} coins</span>
                          </div>
                          <div className="space-y-1 pl-2 border-l border-white/10">
                            {grp.episodes.map((ep, i) => (
                              <div key={`${ep.episodeId}-${i}`} className="flex justify-between text-[11px] text-[#A39E93]">
                                <span className="truncate">
                                  {ep.episodeNumber ? `Ep ${ep.episodeNumber}: ` : ''}
                                  {ep.episodeTitle}
                                </span>
                                <span className="tabular-nums shrink-0">
                                  {ep.coins}c · {formatDateTime(ep.createdAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Listening Activity + Sessions Log */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#A39E93] flex items-center gap-1">
                      <History className="w-3.5 h-3.5" /> Listening Activity ({userDetail.listeningHistory.length})
                    </h4>
                    <div className="rounded-lg bg-[#141418] border border-white/8 divide-y divide-white/[0.06] max-h-44 overflow-y-auto">
                      {userDetail.listeningHistory.length === 0 ? (
                        <p className="p-3 text-xs text-[#7E796F]">No playback history recorded.</p>
                      ) : (
                        userDetail.listeningHistory.slice(0, 15).map((h) => (
                          <div key={h.id} className="p-2.5 text-[11px]">
                            <p className="font-medium text-[#F5F3EE] truncate">{h.storyTitle}</p>
                            <p className="text-[#9B968B] flex justify-between">
                              <span className="truncate">Ep {h.episodeNumber}: {h.episodeTitle}</span>
                              <span className="tabular-nums shrink-0">
                                {Math.round((h.positionSec / Math.max(1, h.durationSec)) * 100)}%
                              </span>
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#A39E93] flex items-center gap-1">
                      <Laptop className="w-3.5 h-3.5" /> Device &amp; Session Log ({userDetail.sessions.length})
                    </h4>
                    <div className="rounded-lg bg-[#141418] border border-white/8 divide-y divide-white/[0.06] max-h-44 overflow-y-auto">
                      {userDetail.sessions.length === 0 ? (
                        <p className="p-3 text-xs text-[#7E796F]">No session events recorded.</p>
                      ) : (
                        userDetail.sessions.slice(0, 15).map((s) => (
                          <div key={s.id} className="p-2.5 text-[11px] space-y-0.5">
                            <div className="flex justify-between">
                              <span className="font-semibold text-[#F3C669]">{s.eventType}</span>
                              <span className="text-[#7E796F] tabular-nums">{formatDateTime(s.createdAt)}</span>
                            </div>
                            <p className="text-[#A39E93]">{s.note}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
