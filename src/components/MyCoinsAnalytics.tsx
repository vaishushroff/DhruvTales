import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, BookOpen, Coins, TrendingUp } from 'lucide-react';
import { computeUserMyCoinsAnalytics } from '../../api/_lib/analyticsEngine';
import type {
  AnalyticsTimeGranularity,
  CoinTransaction,
  Episode,
  Story,
} from '../types';
import { useLanguage } from '../hooks/useLanguage';

interface MyCoinsAnalyticsProps {
  transactions: CoinTransaction[];
  stories: Story[];
  episodes: Episode[];
}

export const MyCoinsAnalytics: React.FC<MyCoinsAnalyticsProps> = ({
  transactions,
  stories,
  episodes,
}) => {
  const { lang, t } = useLanguage();
  const [granularity, setGranularity] = useState<AnalyticsTimeGranularity>('daily');

  const summary = useMemo(
    () =>
      computeUserMyCoinsAnalytics({
        transactions,
        stories,
        episodes,
        granularity,
      }),
    [transactions, stories, episodes, granularity]
  );

  const maxBucketVal = useMemo(() => {
    let max = 1;
    for (const b of summary.timeSeries) {
      max = Math.max(max, b.spentCoins, b.creditedCoins);
    }
    return max;
  }, [summary.timeSeries]);

  const maxStorySpend = useMemo(
    () => Math.max(1, ...summary.spendByStory.map((s) => s.coinsSpent)),
    [summary.spendByStory]
  );

  const visibleSeries = summary.timeSeries.slice(-14);

  return (
    <section
      aria-labelledby="my-coins-insights-heading"
      data-testid="my-coins-analytics"
      className="space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="my-coins-insights-heading"
            className="font-display text-2xl font-semibold text-[#F5F3EE] flex items-center gap-2"
          >
            <BarChart3 className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
            {t('wallet.myCoinsInsightsTitle')}
          </h2>
          <p className="text-xs text-[#A39E93] mt-0.5">
            {t('wallet.myCoinsInsightsSubtitle')}
          </p>
        </div>

        <div
          role="group"
          aria-label={t('analytics.granularityLabel')}
          className="inline-flex rounded-xl bg-[#141418] border border-white/10 p-1 gap-1"
        >
          {(['daily', 'weekly', 'monthly'] as AnalyticsTimeGranularity[]).map((g) => (
            <button
              key={g}
              type="button"
              data-testid={`my-coins-granularity-${g}`}
              onClick={() => setGranularity(g)}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-medium transition-colors ${
                granularity === g
                  ? 'bg-[#E5A93C] text-[#0B0B0E]'
                  : 'text-[#A39E93] hover:text-[#F5F3EE]'
              }`}
            >
              {t(`analytics.granularity_${g}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-[#A39E93]">
            {t('wallet.storiesSupported')}
          </p>
          <p className="text-2xl font-semibold text-[#F5F3EE] tabular-nums">
            {summary.storiesSupportedCount}
          </p>
        </div>
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-[#A39E93]">
            {t('wallet.episodesUnlocked')}
          </p>
          <p className="text-2xl font-semibold text-[#F3C669] tabular-nums">
            {summary.episodesUnlockedCount}
          </p>
        </div>
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-[#A39E93]">
            {t('wallet.statSpent')}
          </p>
          <p className="text-2xl font-semibold text-[#F5F3EE] tabular-nums">
            {summary.totalSpent.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-[#141418] border border-white/10 p-4 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-[#A39E93]">
            {t('wallet.totalCreditsReceived')}
          </p>
          <p className="text-2xl font-semibold text-[#6BAE8E] tabular-nums">
            {(summary.totalPurchased + summary.totalBonus).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Spending by Story */}
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              {t('wallet.spendByStoryTitle')}
            </h3>
            <span className="text-[11px] text-[#9B968B] tabular-nums">
              {summary.spendByStory.length}{' '}
              {lang === 'hi' ? 'कहानियाँ' : 'stories'}
            </span>
          </div>

          {summary.spendByStory.length === 0 ? (
            <p className="text-xs text-[#A39E93] py-6 text-center">
              {t('wallet.noSpendByStoryYet')}
            </p>
          ) : (
            <div className="space-y-3">
              {summary.spendByStory.map((row) => {
                const widthPct = Math.max(6, Math.round((row.coinsSpent / maxStorySpend) * 100));
                return (
                  <div key={row.storyId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <Link
                        to={`/story/${row.storyId}`}
                        className="font-medium text-[#F5F3EE] hover:text-[#F3C669] truncate"
                      >
                        {row.storyTitle}
                      </Link>
                      <span className="text-[#F3C669] font-semibold tabular-nums shrink-0">
                        {row.coinsSpent.toLocaleString()} {t('coins.unit')}{' '}
                        <span className="text-[#9B968B] font-normal">
                          ({row.unlockCount} ep · {row.sharePct}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#E5A93C] to-[#F3C669]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coins Over Time Chart */}
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#6BAE8E]" aria-hidden="true" />
              {t('wallet.spendOverTimeTitle')}
            </h3>
            <div className="flex items-center gap-3 text-[11px] text-[#A39E93]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#6BAE8E]" />
                {t('wallet.creditsSeries')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-[#E5A93C]" />
                {t('wallet.spentSeries')}
              </span>
            </div>
          </div>

          {visibleSeries.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Coins className="w-6 h-6 text-[#7E796F] mx-auto" aria-hidden="true" />
              <p className="text-xs text-[#A39E93]">{t('wallet.noActivityChartYet')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[260px] h-44 flex items-end gap-2 pt-4">
                {visibleSeries.map((bucket) => {
                  const creditH = Math.round((bucket.creditedCoins / maxBucketVal) * 100);
                  const spentH = Math.round((bucket.spentCoins / maxBucketVal) * 100);
                  return (
                    <div
                      key={bucket.bucketKey}
                      className="flex-1 min-w-[34px] flex flex-col items-center gap-1.5 h-full justify-end"
                      title={`${bucket.label}: +${bucket.creditedCoins} credited, -${bucket.spentCoins} spent`}
                    >
                      <div className="w-full flex items-end justify-center gap-1 flex-1">
                        <div
                          className="w-3 rounded-t bg-[#6BAE8E]/85 transition-all"
                          style={{ height: `${bucket.creditedCoins > 0 ? Math.max(8, creditH) : 0}%` }}
                        />
                        <div
                          className="w-3 rounded-t bg-[#E5A93C]/90 transition-all"
                          style={{ height: `${bucket.spentCoins > 0 ? Math.max(8, spentH) : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-[#9B968B] tabular-nums truncate max-w-full">
                        {bucket.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
