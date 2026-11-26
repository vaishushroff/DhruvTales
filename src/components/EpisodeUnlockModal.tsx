import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Coins, Gift, Lock, X } from 'lucide-react';
import type { Episode, Story } from '../types';
import { useLanguage } from '../hooks/useLanguage';
import { resolveEffectiveEpisodePrice } from '../services/access/episodeAccess';

interface EpisodeUnlockModalProps {
  story: Story;
  episode: Episode;
  walletBalance: number;
  dailyFreeEnabled: boolean;
  remainingDailyFree: number;
  dailyFreeLimit: number;
  onUnlockWithCoins: () => Promise<{ ok: boolean; error?: string; insufficientBalance?: boolean }>;
  onUseDailyFree: () => Promise<void>;
  onClose: () => void;
}

export const EpisodeUnlockModal: React.FC<EpisodeUnlockModalProps> = ({
  story,
  episode,
  walletBalance,
  dailyFreeEnabled,
  remainingDailyFree,
  dailyFreeLimit,
  onUnlockWithCoins,
  onUseDailyFree,
  onClose,
}) => {
  const { lang, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState<'coins' | 'daily' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectivePrice = resolveEffectiveEpisodePrice(episode, story);
  const hasStoryOverride =
    typeof story.priceOverrideCoins === 'number' && Number.isFinite(story.priceOverrideCoins);
  const hasEnoughCoins = walletBalance >= effectivePrice;
  const balanceAfter = Math.max(0, walletBalance - effectivePrice);
  const shortfall = Math.max(0, effectivePrice - walletBalance);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const handleConfirmCoinUnlock = async () => {
    setBusy('coins');
    setErrorMsg(null);
    try {
      const res = await onUnlockWithCoins();
      if (!res.ok) {
        setErrorMsg(res.error ?? t('unlockModal.errorGeneric'));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('unlockModal.errorGeneric'));
    } finally {
      setBusy(null);
    }
  };

  const handleDailyFree = async () => {
    setBusy('daily');
    setErrorMsg(null);
    try {
      await onUseDailyFree();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : t('unlockModal.errorGeneric'));
    } finally {
      setBusy(null);
    }
  };

  const handleGoToWallet = () => {
    const returnTo = encodeURIComponent(location.pathname);
    onClose();
    navigate(`/wallet?returnTo=${returnTo}`);
  };

  const episodeTitle = lang === 'hi' ? episode.titleHi || episode.title : episode.title;
  const storyTitle = lang === 'hi' ? story.titleHi || story.title : story.title;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-modal-title"
      data-testid="episode-unlock-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/12 p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-medium text-[#E5A93C] uppercase tracking-wider flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              {t('unlockModal.kicker')}
            </p>
            <h2
              id="unlock-modal-title"
              className="font-display text-xl font-semibold text-[#F5F3EE] leading-snug"
            >
              {t('story.epShort')} {episode.episodeNumber}: {episodeTitle}
            </h2>
            <p className="text-xs text-[#A39E93] truncate">{storyTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            aria-label={t('common.close')}
            className="min-w-[44px] min-h-[44px] rounded-xl border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] hover:border-white/25 inline-flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Price & Balance Breakdown */}
        <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[#A39E93]">{t('unlockModal.episodePrice')}</span>
            <span
              data-testid="unlock-modal-price"
              className="font-semibold text-[#F3C669] tabular-nums inline-flex items-center gap-1.5"
            >
              <Coins className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              {effectivePrice} {t('coins.unit')}
            </span>
          </div>

          {hasStoryOverride && (
            <p className="text-[11px] text-[#A39E93]">
              {t('unlockModal.storyOverrideNote')}
            </p>
          )}

          <div className="h-px bg-white/8" />

          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[#A39E93]">{t('unlockModal.yourBalance')}</span>
            <span
              data-testid="unlock-modal-balance"
              className="font-semibold text-[#F5F3EE] tabular-nums"
            >
              {walletBalance.toLocaleString()} {t('coins.unit')}
            </span>
          </div>

          {hasEnoughCoins ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-[#A39E93]">{t('unlockModal.balanceAfter')}</span>
              <span className="font-semibold text-[#6BAE8E] tabular-nums">
                {balanceAfter.toLocaleString()} {t('coins.unit')}
              </span>
            </div>
          ) : (
            <div
              data-testid="unlock-insufficient-banner"
              className="rounded-lg bg-[#B85D43]/15 border border-[#B85D43]/35 px-3 py-2.5 flex items-start gap-2 text-xs text-[#F5C2B4]"
            >
              <AlertCircle className="w-4 h-4 text-[#E07A5F] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {t('unlockModal.insufficientCoins', {
                  shortfall: String(shortfall),
                })}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-[#A39E93] flex items-start gap-2 leading-relaxed">
          <CheckCircle2 className="w-4 h-4 text-[#6BAE8E] shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t('unlockModal.permanentNote')}</span>
        </p>

        {errorMsg && (
          <p
            role="alert"
            className="text-xs text-[#F5C2B4] bg-[#B85D43]/15 border border-[#B85D43]/30 rounded-lg px-3 py-2"
          >
            {errorMsg}
          </p>
        )}

        {/* Primary & Secondary Actions */}
        <div className="space-y-2.5">
          {hasEnoughCoins ? (
            <button
              type="button"
              data-testid="confirm-coin-unlock-btn"
              disabled={busy !== null}
              onClick={() => void handleConfirmCoinUnlock()}
              className="w-full min-h-[46px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
            >
              <Coins className="w-4 h-4" aria-hidden="true" />
              {busy === 'coins'
                ? t('unlockModal.unlocking')
                : t('unlockModal.unlockCta', { price: String(effectivePrice) })}
            </button>
          ) : (
            <button
              type="button"
              data-testid="insufficient-buy-coins-btn"
              disabled={busy !== null}
              onClick={handleGoToWallet}
              className="w-full min-h-[46px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
            >
              <Coins className="w-4 h-4" aria-hidden="true" />
              {t('unlockModal.buyCoinsCta')}
            </button>
          )}

          {dailyFreeEnabled && remainingDailyFree > 0 && (
            <button
              type="button"
              data-testid="modal-daily-free-btn"
              disabled={busy !== null}
              onClick={() => void handleDailyFree()}
              className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#1C1C22] text-[#F5F3EE] text-sm font-medium hover:border-[#E5A93C]/50 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
            >
              <Gift className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              {busy === 'daily'
                ? t('unlockModal.unlocking')
                : t('unlockModal.dailyFreeCta', {
                    remaining: String(remainingDailyFree),
                    limit: String(dailyFreeLimit),
                  })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
