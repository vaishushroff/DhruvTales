import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Gift,
  History,
  Info,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { CoinPackage, CoinTransaction, CoinTransactionType } from '../types';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { formatInr, type CoinCheckoutReceipt } from '../services/payments/PaymentProvider';
import { MyCoinsAnalytics } from '../components/MyCoinsAnalytics';

type LedgerFilter = 'all' | 'purchase' | 'spend' | 'bonus' | 'other';

function formatTxDate(ms: number): string {
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

export const WalletPage: React.FC = () => {
  const { lang, t } = useLanguage();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;

  const {
    stories,
    episodes,
    wallet,
    coinTransactions,
    episodeUnlocks,
    coinPackages,
    economySettings,
    walletMode,
    buyCoinPackage,
  } = useAppData();

  const [selectedPkg, setSelectedPkg] = useState<CoinPackage | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<CoinCheckoutReceipt | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>('all');

  const activePackages = useMemo(
    () =>
      coinPackages
        .filter((p) => p.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [coinPackages]
  );

  const filteredTransactions = useMemo(() => {
    return coinTransactions.filter((tx: CoinTransaction) => {
      if (filter === 'all') return true;
      if (filter === 'other') return tx.type === 'admin_adjust' || tx.type === 'refund';
      return tx.type === filter;
    });
  }, [coinTransactions, filter]);

  const handleConfirmPurchase = async () => {
    if (!selectedPkg) return;
    setPurchasing(true);
    setPurchaseError(null);
    try {
      const result = await buyCoinPackage(selectedPkg);
      setLatestReceipt(result.receipt);
      setSelectedPkg(null);
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : t('wallet.purchaseError'));
    } finally {
      setPurchasing(false);
    }
  };

  const getTypeLabel = (type: CoinTransactionType): string => {
    switch (type) {
      case 'purchase':
        return t('wallet.txTypePurchase');
      case 'spend':
        return t('wallet.txTypeSpend');
      case 'bonus':
        return t('wallet.txTypeBonus');
      case 'refund':
        return t('wallet.txTypeRefund');
      case 'admin_adjust':
      default:
        return t('wallet.txTypeAdmin');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
      {/* Return link when arriving from a locked episode */}
      {safeReturnTo && (
        <Link
          to={safeReturnTo}
          data-testid="wallet-return-link"
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-[#F3C669] hover:text-[#F5F3EE] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('wallet.returnToStory')}
        </Link>
      )}

      {/* Header + Demo Payment Transparency Notice */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE] tracking-tight">
            {t('wallet.title')}
          </h1>
          <p className="text-sm text-[#A39E93] max-w-2xl">{t('wallet.subtitle')}</p>
        </div>

        <div
          data-testid="demo-payments-notice"
          className="rounded-xl bg-[#141418] border border-[#E5A93C]/30 px-4 py-3 flex flex-wrap items-start gap-3 text-xs text-[#D6D2C9]"
        >
          <Info className="w-4 h-4 text-[#E5A93C] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5 flex-1 min-w-[200px]">
            <p className="font-semibold text-[#F3C669]">{t('wallet.demoNoticeTitle')}</p>
            <p className="text-[#A39E93] leading-relaxed">
              {walletMode === 'server'
                ? t('wallet.demoNoticeServer')
                : t('wallet.demoNoticeLocal')}
            </p>
          </div>
        </div>
      </div>

      {/* Purchase Receipt Banner */}
      {latestReceipt && (
        <div
          role="status"
          data-testid="wallet-purchase-receipt"
          className="rounded-xl bg-[#6BAE8E]/12 border border-[#6BAE8E]/40 px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-5 h-5 text-[#6BAE8E] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-[#F5F3EE]">
                {t('wallet.receiptSuccess', {
                  coins: String(latestReceipt.coinsCredited),
                  name: latestReceipt.packageName,
                })}
              </p>
              <p className="text-xs text-[#A39E93] tabular-nums">
                {latestReceipt.receiptId} · {formatInr(latestReceipt.priceInr)} ·{' '}
                {t('wallet.demoOnlyTag')}
              </p>
            </div>
          </div>
          {safeReturnTo && (
            <Link
              to={safeReturnTo}
              className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold inline-flex items-center hover:bg-[#F3C669] transition-colors"
            >
              {t('wallet.returnToStory')}
            </Link>
          )}
        </div>
      )}

      {/* Hero Wallet Balance Card */}
      <section
        aria-label={t('wallet.balanceLabel')}
        data-testid="wallet-balance-card"
        className="rounded-2xl bg-gradient-to-br from-[#191713] via-[#141418] to-[#111116] border border-[#E5A93C]/25 p-6 sm:p-8"
      >
        <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-6 items-center">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[#A39E93] flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              {t('wallet.balanceLabel')}
            </p>
            <div className="flex items-baseline gap-2.5">
              <span
                data-testid="wallet-balance-value"
                className="font-display text-4xl sm:text-5xl font-semibold text-[#F5F3EE] tabular-nums"
              >
                {wallet.balance.toLocaleString()}
              </span>
              <span className="text-base font-medium text-[#F3C669]">{t('coins.unit')}</span>
            </div>
            <p className="text-xs text-[#A39E93] flex items-center gap-1.5 pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#6BAE8E]" aria-hidden="true" />
              {t('wallet.serverAuthNote')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-[#0B0B0E]/75 border border-white/8 p-3.5 flex flex-col justify-between gap-2">
              <p className="text-[11px] text-[#A39E93]">{t('wallet.statPurchased')}</p>
              <p className="text-lg font-semibold text-[#F5F3EE] tabular-nums">
                {wallet.lifetimePurchased.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[#0B0B0E]/75 border border-white/8 p-3.5 flex flex-col justify-between gap-2">
              <p className="text-[11px] text-[#A39E93]">{t('wallet.statSpent')}</p>
              <p className="text-lg font-semibold text-[#F5F3EE] tabular-nums">
                {wallet.lifetimeSpent.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-[#0B0B0E]/75 border border-white/8 p-3.5 flex flex-col justify-between gap-2">
              <p className="text-[11px] text-[#A39E93]">{t('wallet.statUnlocked')}</p>
              <p className="text-lg font-semibold text-[#F5F3EE] tabular-nums">
                {episodeUnlocks.length}
              </p>
            </div>
          </div>
        </div>

        {economySettings.dailyFreeEnabled && economySettings.dailyFreeLimit > 0 && (
          <div className="mt-5 pt-4 border-t border-white/8 flex items-center gap-2 text-xs text-[#D6D2C9]">
            <Gift className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
            <span>
              {t('wallet.dailyFreeInfo', {
                limit: String(economySettings.dailyFreeLimit),
              })}
            </span>
          </div>
        )}
      </section>

      {/* Buy Coins — Admin-Defined Packages */}
      <section aria-labelledby="buy-coins-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="buy-coins-heading"
              className="font-display text-2xl font-semibold text-[#F5F3EE]"
            >
              {t('wallet.buyCoinsTitle')}
            </h2>
            <p className="text-xs text-[#A39E93] mt-0.5">{t('wallet.buyCoinsSubtitle')}</p>
          </div>
          <span className="text-xs text-[#A39E93]">{t('wallet.demoOnlyTag')}</span>
        </div>

        {activePackages.length === 0 ? (
          <div className="rounded-2xl bg-[#141418] border border-white/10 p-6 text-sm text-[#A39E93]">
            {t('wallet.noPackages')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {activePackages.map((pkg) => {
              const totalCoins = pkg.coins + pkg.bonusCoins;
              const pkgTitle = lang === 'hi' && pkg.nameHi ? pkg.nameHi : pkg.name;
              return (
                <div
                  key={pkg.id}
                  data-testid={`coin-package-${pkg.id}`}
                  className="rounded-2xl bg-[#141418] border border-white/10 hover:border-[#E5A93C]/50 p-5 flex flex-col justify-between gap-5 transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-lg font-semibold text-[#F5F3EE] leading-snug">
                        {pkgTitle}
                      </h3>
                      {pkg.bonusCoins > 0 && (
                        <span className="text-[11px] font-semibold text-[#6BAE8E] bg-[#6BAE8E]/15 border border-[#6BAE8E]/30 px-2 py-0.5 rounded-md tabular-nums shrink-0">
                          +{pkg.bonusCoins} {t('wallet.bonusLabel')}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="text-2xl font-semibold text-[#F3C669] tabular-nums flex items-center gap-1.5">
                        <Coins className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                        {totalCoins.toLocaleString()}
                      </p>
                      <p className="text-xs text-[#A39E93] tabular-nums">
                        {pkg.bonusCoins > 0
                          ? t('wallet.packageBreakdown', {
                              base: String(pkg.coins),
                              bonus: String(pkg.bonusCoins),
                            })
                          : `${pkg.coins.toLocaleString()} ${t('coins.unit')}`}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    data-testid={`buy-package-btn-${pkg.id}`}
                    onClick={() => {
                      setPurchaseError(null);
                      setSelectedPkg(pkg);
                    }}
                    className="w-full min-h-[44px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors tabular-nums"
                  >
                    {t('wallet.buyForPrice', { price: formatInr(pkg.priceInr) })}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* User-Facing "My Coins" Spending by Story & Over-Time Analytics */}
      <MyCoinsAnalytics
        transactions={coinTransactions}
        stories={stories}
        episodes={episodes}
      />

      {/* Immutable Transaction History */}
      <section aria-labelledby="tx-history-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
            <h2
              id="tx-history-heading"
              className="font-display text-2xl font-semibold text-[#F5F3EE]"
            >
              {t('wallet.historyTitle')}
            </h2>
          </div>

          <div
            role="tablist"
            aria-label={t('wallet.historyFilterLabel')}
            className="flex flex-wrap items-center gap-1.5"
          >
            {(
              [
                ['all', t('wallet.filterAll')],
                ['purchase', t('wallet.filterPurchases')],
                ['spend', t('wallet.filterSpends')],
                ['bonus', t('wallet.filterBonuses')],
                ['other', t('wallet.filterOther')],
              ] as [LedgerFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`min-h-[40px] px-3 rounded-lg text-xs font-medium transition-colors ${
                  filter === key
                    ? 'bg-[#E5A93C] text-[#0B0B0E]'
                    : 'bg-[#141418] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div
          data-testid="wallet-transaction-list"
          className="rounded-2xl bg-[#141418] border border-white/10 overflow-hidden divide-y divide-white/[0.06]"
        >
          {filteredTransactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#A39E93]">
              {t('wallet.emptyHistory')}
            </div>
          ) : (
            filteredTransactions.map((tx) => {
              const isCredit = tx.amount >= 0;
              return (
                <div
                  key={tx.id}
                  data-testid="wallet-tx-row"
                  className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isCredit
                          ? 'bg-[#6BAE8E]/15 text-[#6BAE8E]'
                          : 'bg-[#E5A93C]/15 text-[#F3C669]'
                      }`}
                    >
                      {tx.type === 'bonus' ? (
                        <Sparkles className="w-4 h-4" aria-hidden="true" />
                      ) : isCredit ? (
                        <ArrowDownLeft className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#D6D2C9]">
                          {getTypeLabel(tx.type)}
                        </span>
                        <span className="text-[11px] text-[#7E796F]">
                          {formatTxDate(tx.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-[#F5F3EE] truncate mt-0.5">{tx.note}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <p
                      className={`text-sm font-semibold ${
                        isCredit ? 'text-[#6BAE8E]' : 'text-[#F3C669]'
                      }`}
                    >
                      {isCredit ? `+${tx.amount}` : tx.amount} {t('coins.unit')}
                    </p>
                    <p className="text-[11px] text-[#A39E93]">
                      {t('wallet.balanceAfterShort', {
                        balance: tx.balanceAfter.toLocaleString(),
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Mock Checkout Confirmation Modal */}
      {selectedPkg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mock-checkout-title"
          data-testid="mock-checkout-modal"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !purchasing) setSelectedPkg(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/12 p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#E5A93C]">
                  {t('wallet.demoOnlyTag')}
                </p>
                <h3
                  id="mock-checkout-title"
                  className="font-display text-xl font-semibold text-[#F5F3EE] mt-1"
                >
                  {t('wallet.checkoutTitle')}
                </h3>
              </div>
              <button
                type="button"
                disabled={purchasing}
                onClick={() => setSelectedPkg(null)}
                aria-label={t('common.close')}
                className="min-w-[44px] min-h-[44px] rounded-xl border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#A39E93]">{t('wallet.packageLabel')}</span>
                <span className="font-semibold text-[#F5F3EE]">
                  {lang === 'hi' && selectedPkg.nameHi ? selectedPkg.nameHi : selectedPkg.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#A39E93]">{t('wallet.coinsCreditedLabel')}</span>
                <span className="font-semibold text-[#F3C669] tabular-nums">
                  {(selectedPkg.coins + selectedPkg.bonusCoins).toLocaleString()} {t('coins.unit')}
                  {selectedPkg.bonusCoins > 0 ? ` (+${selectedPkg.bonusCoins})` : ''}
                </span>
              </div>
              <div className="h-px bg-white/8" />
              <div className="flex items-center justify-between">
                <span className="text-[#A39E93]">{t('wallet.simulatedAmount')}</span>
                <span className="font-semibold text-[#F5F3EE] tabular-nums">
                  {formatInr(selectedPkg.priceInr)}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#A39E93] leading-relaxed">
              {t('wallet.checkoutDisclaimer')}
            </p>

            {purchaseError && (
              <p
                role="alert"
                className="text-xs text-[#F5C2B4] bg-[#B85D43]/15 border border-[#B85D43]/30 rounded-lg px-3 py-2"
              >
                {purchaseError}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={purchasing}
                onClick={() => setSelectedPkg(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-white/15 text-sm font-medium text-[#D6D2C9] hover:text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-mock-purchase-btn"
                disabled={purchasing}
                onClick={() => void handleConfirmPurchase()}
                className="flex-1 min-h-[44px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] disabled:opacity-60 transition-colors"
              >
                {purchasing ? t('wallet.processing') : t('wallet.confirmDemoBuy')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
