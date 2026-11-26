import React, { useEffect } from 'react';
import { AlertTriangle, Ban, Mail, MonitorSmartphone, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';

/**
 * Global overlays for server-side single-device enforcement:
 * 1. DeviceWarningModal: shown when a concurrent login triggers Warning 1 or 2 of 3
 *    and the new device is signed out immediately.
 * 2. AccountBannedScreen: full-screen lockout shown when 3 warnings are reached or
 *    an Admin bans/disables the account.
 */
export const SessionEnforcementOverlays: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const {
    deviceWarning,
    accountBanned,
    dismissDeviceWarning,
    dismissAccountBanned,
  } = useAppData();

  useEffect(() => {
    if (!deviceWarning || accountBanned) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissDeviceWarning();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deviceWarning, accountBanned, dismissDeviceWarning]);

  if (accountBanned) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="account-banned-heading"
        data-testid="account-banned-screen"
        className="fixed inset-0 z-[90] bg-[#0B0B0E]/96 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      >
        <div className="w-full max-w-lg rounded-2xl bg-[#141418] border border-rose-500/35 p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-300 flex items-center justify-center shrink-0">
              <Ban className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                {t('session.bannedKicker')}
              </p>
              <h2
                id="account-banned-heading"
                className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F3EE]"
              >
                {t('session.bannedTitle')}
              </h2>
            </div>
          </div>

          <p className="text-sm text-[#D6D2C9] leading-relaxed">
            {t('session.bannedBody')}
          </p>

          <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#A39E93]">{t('session.warningsRecordedLabel')}</span>
              <span className="font-semibold text-rose-300 tabular-nums">
                {accountBanned.warningCount} / 3
              </span>
            </div>
            <div className="pt-2 border-t border-white/[0.06] space-y-1">
              <p className="text-[#A39E93]">{t('session.banReasonLabel')}</p>
              <p className="text-[#F5F3EE] leading-relaxed">{accountBanned.banReason}</p>
            </div>
          </div>

          <div className="rounded-xl bg-[#1C1C22] border border-[#E5A93C]/25 p-4 flex items-start gap-3">
            <Mail className="w-4 h-4 text-[#E5A93C] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 text-xs min-w-0">
              <p className="font-medium text-[#F5F3EE]">{t('session.supportHeading')}</p>
              <p className="text-[#A39E93] leading-relaxed">
                {t('session.supportBody')}{' '}
                <a
                  href={`mailto:${accountBanned.supportContact}`}
                  className="text-[#F3C669] underline underline-offset-2 break-all"
                >
                  {accountBanned.supportContact}
                </a>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            <button
              type="button"
              data-testid="account-banned-dismiss-btn"
              onClick={() => {
                dismissAccountBanned();
                navigate('/');
              }}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors"
            >
              {t('session.returnHomeBtn')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (deviceWarning) {
    const remaining = Math.max(0, deviceWarning.maxWarnings - deviceWarning.warningCount);
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="device-warning-heading"
        data-testid="device-warning-modal"
        className="fixed inset-0 z-[85] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-[#E5A93C]/45 p-6 space-y-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#E5A93C]/15 border border-[#E5A93C]/40 text-[#F3C669] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#E5A93C] tabular-nums">
                  {t('session.warningBadge', {
                    count: String(deviceWarning.warningCount),
                    max: String(deviceWarning.maxWarnings),
                  })}
                </p>
                <h2
                  id="device-warning-heading"
                  className="font-display text-xl font-semibold text-[#F5F3EE]"
                >
                  {t('session.warningTitle')}
                </h2>
              </div>
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={dismissDeviceWarning}
              className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 rounded-lg text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm font-medium text-[#F3C669] bg-[#0B0B0E] border border-[#E5A93C]/25 rounded-xl px-4 py-3 leading-relaxed">
            {t('session.warningExactMessage', {
              count: String(deviceWarning.warningCount),
              max: String(deviceWarning.maxWarnings),
            })}
          </p>

          <div className="space-y-2 text-xs text-[#D6D2C9] leading-relaxed">
            {deviceWarning.activeDeviceLabel && (
              <p className="inline-flex items-center gap-2 text-[#A39E93]">
                <MonitorSmartphone className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
                <span>
                  {t('session.activeDeviceLabel')}:{' '}
                  <strong className="text-[#F5F3EE] font-medium">
                    {deviceWarning.activeDeviceLabel}
                  </strong>
                </span>
              </p>
            )}
            <p>{t('session.warningSignedOutBody')}</p>
            <p className="text-rose-300">
              {t('session.warningRemainingBody', { remaining: String(remaining) })}
            </p>
          </div>

          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              data-testid="device-warning-dismiss-btn"
              onClick={dismissDeviceWarning}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors"
            >
              {t('session.understandBtn')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
