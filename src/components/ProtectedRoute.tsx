import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, ShieldAlert, Sparkles, UserCheck } from 'lucide-react';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { hasRouteAccess } from '../services/studio/studioAnalytics';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { profile, authReady } = useAppData();
  const { t } = useLanguage();

  if (!authReady) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="h-56 rounded-2xl bg-[#141418] border border-white/[0.08] animate-pulse" />
      </div>
    );
  }

  const check = hasRouteAccess(profile, allowedRoles);
  if (check.allowed) {
    return <>{children}</>;
  }

  const bodyText =
    check.reason === 'unauthenticated'
      ? t('access.signInRequiredBody')
      : check.reason === 'disabled'
        ? t('access.disabledBody')
        : t('access.roleRequiredBody');

  const canApplyAsCreator =
    profile &&
    !profile.isDisabled &&
    profile.role === 'user' &&
    allowedRoles.includes('creator');

  return (
    <div
      data-testid="no-access-screen"
      className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16"
    >
      <div className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 sm:p-10 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#1C1C22] border border-[#E5A93C]/30 text-[#E5A93C] flex items-center justify-center shrink-0">
            {check.reason === 'disabled' ? (
              <ShieldAlert className="w-6 h-6" aria-hidden="true" />
            ) : (
              <Lock className="w-6 h-6" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#F5F3EE]">
              {t('access.noAccessTitle')}
            </h1>
            <p className="text-sm text-[#A39E93] leading-relaxed">{bodyText}</p>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4 text-xs">
          <div className="space-y-1">
            <dt className="text-[#8A857B]">{t('access.currentRoleLabel')}</dt>
            <dd className="font-medium text-[#F5F3EE] capitalize">
              {profile ? profile.role : t('access.guestRole')}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-[#8A857B]">{t('access.requiredRolesLabel')}</dt>
            <dd className="font-medium text-[#E5A93C] capitalize">
              {allowedRoles.join(' · ')}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {!profile && (
            <Link
              to="/profile"
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <UserCheck className="w-4 h-4" aria-hidden="true" />
              {t('nav.signIn')}
            </Link>
          )}

          {canApplyAsCreator && (
            <Link
              to="/profile#become-creator"
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              {t('access.applyCreatorCta')}
            </Link>
          )}

          {profile && (
            <Link
              to="/profile"
              className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] border border-white/15 text-sm font-medium text-[#F5F3EE] hover:border-white/30 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
            >
              {t('access.goProfile')}
            </Link>
          )}

          <Link
            to="/"
            className="min-h-[44px] px-4 rounded-xl border border-white/10 text-sm font-medium text-[#A39E93] hover:text-[#F5F3EE] hover:border-white/25 transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t('access.goHome')}
          </Link>
        </div>
      </div>
    </div>
  );
};
