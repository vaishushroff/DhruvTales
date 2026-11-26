import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ConfirmationResult } from 'firebase/auth';
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Database,
  LogOut,
  MailCheck,
  Mic,
  MonitorSmartphone,
  Shield,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';
import { resolveDisplayIdentity } from '../services/firebase/activityPersistence';
import { getSafeErrorMessage } from '../utils/validation';
import type { ContentLanguage, LanguageCode, PlaybackFormat } from '../types';

export const ProfilePage: React.FC = () => {
  const { lang, supportedLanguages, setLang, t } = useLanguage();
  const {
    firebaseUser,
    profile,
    authReady,
    isVerifiedUser,
    preferredFormat,
    catalogSource,
    wallet,
    episodeUnlocks,
    creatorRequest,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    sendPhoneOtp,
    verifyPhoneOtp,
    logout,
    sendVerification,
    refreshVerificationStatus,
    updateProfile,
    deleteAccount,
    seedCatalog,
    submitCreatorRequest,
    refreshProfileAndRequest,
  } = useAppData();

  // Auth form state
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'phone'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [phoneConfirmation, setPhoneConfirmation] = useState<ConfirmationResult | null>(null);
  const [phoneSentTo, setPhoneSentTo] = useState<string | null>(null);
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const clearRecaptchaRef = useRef<(() => void) | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Profile edit state
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editLang, setEditLang] = useState<LanguageCode>(lang);
  const [editFormat, setEditFormat] = useState<PlaybackFormat>(preferredFormat);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  // Seed & verification status
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  // Become a Creator form state
  const [studioName, setStudioName] = useState('');
  const [creatorHandle, setCreatorHandle] = useState('');
  const [creatorLang, setCreatorLang] = useState<ContentLanguage>('bilingual');
  const [creatorPitch, setCreatorPitch] = useState('');
  const [creatorSampleLink, setCreatorSampleLink] = useState('');
  const [creatorReqBusy, setCreatorReqBusy] = useState(false);
  const [creatorReqMessage, setCreatorReqMessage] = useState<string | null>(null);

  // Delete modal
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const identity = resolveDisplayIdentity(profile, firebaseUser);

  useEffect(() => {
    if (profile || firebaseUser) {
      setEditName(profile?.displayName || identity.displayName);
      setEditBio(profile?.bio ?? '');
      if (profile?.preferredLanguage) {
        setEditLang(profile.preferredLanguage);
      }
      setEditFormat(profile?.preferredFormat === 'video' ? 'video' : 'audio');
    }
  }, [profile, firebaseUser, identity.displayName]);

  useEffect(() => {
    if (creatorRequest) {
      setStudioName(creatorRequest.studioName);
      setCreatorHandle(creatorRequest.handle);
      setCreatorLang(creatorRequest.language);
      setCreatorPitch(creatorRequest.pitch);
      setCreatorSampleLink(creatorRequest.sampleLink ?? '');
    }
  }, [creatorRequest]);

  useEffect(() => {
    if (!confirmDeleteOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmDeleteOpen]);

  useEffect(() => {
    return () => {
      clearRecaptchaRef.current?.();
      clearRecaptchaRef.current = null;
    };
  }, []);

  const resetPhoneFlow = () => {
    clearRecaptchaRef.current?.();
    clearRecaptchaRef.current = null;
    setPhoneConfirmation(null);
    setPhoneSentTo(null);
    setOtpInput('');
    setAuthError(null);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setAuthError(getSafeErrorMessage(err, 'Google sign-in failed.'));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!email.trim() || !password) {
      setAuthError('Please enter both email address and password.');
      return;
    }
    if (authMode === 'signup' && password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, signupName || email.split('@')[0]);
      }
      setPassword('');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (raw.includes('operation-not-allowed')) {
        setAuthError(
          'Email/Password sign-in is not yet enabled in Firebase Console. Use Google Sign-In above, or enable Email/Password under Firebase Console → Authentication → Sign-in method.'
        );
      } else {
        setAuthError(getSafeErrorMessage(err, 'Authentication failed.'));
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!recaptchaContainerRef.current) {
      setAuthError('Phone verification container is not ready. Please reload and try again.');
      return;
    }
    clearRecaptchaRef.current?.();
    clearRecaptchaRef.current = null;

    setAuthBusy(true);
    try {
      const res = await sendPhoneOtp(phoneInput, recaptchaContainerRef.current);
      clearRecaptchaRef.current = res.clearRecaptcha;
      setPhoneConfirmation(res.confirmation);
      setPhoneSentTo(phoneInput.trim());
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (raw.includes('operation-not-allowed')) {
        setAuthError(
          'Phone sign-in is not enabled yet in Firebase Console. Enable Phone under Firebase Console → Authentication → Sign-in method.'
        );
      } else if (raw.includes('billing-not-enabled')) {
        setAuthError(
          'Firebase Phone Auth requires upgrading to the Blaze plan (or configuring test phone numbers in Firebase Console) before sending SMS.'
        );
      } else {
        setAuthError(getSafeErrorMessage(err, 'Could not send verification code.'));
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneConfirmation) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      await verifyPhoneOtp(phoneConfirmation, otpInput);
      resetPhoneFlow();
    } catch (err) {
      setAuthError(getSafeErrorMessage(err, 'Invalid or expired verification code.'));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setProfileBusy(true);
    setProfileStatus(null);
    try {
      await updateProfile({
        displayName: editName,
        bio: editBio,
        preferredLanguage: editLang,
        preferredFormat: editFormat,
      });
      setProfileStatus(t('profile.profileSaved'));
    } catch (err) {
      setProfileStatus(getSafeErrorMessage(err, 'Could not update profile.'));
    } finally {
      setProfileBusy(false);
    }
  };

  const handleSeedFirestore = async () => {
    setSeedBusy(true);
    setSeedMessage(null);
    try {
      const res = await seedCatalog();
      setSeedMessage(
        `Seeded Firestore: ${res.categoriesWritten} genres, ${res.creatorsWritten} creators, ${res.storiesWritten} stories, ${res.episodesWritten} episodes (${res.skippedExisting} already existed).`
      );
    } catch (err) {
      setSeedMessage(getSafeErrorMessage(err, 'Seeding failed.'));
    } finally {
      setSeedBusy(false);
    }
  };


  const handleSubmitCreatorRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatorReqBusy(true);
    setCreatorReqMessage(null);
    try {
      await submitCreatorRequest({
        studioName,
        handle: creatorHandle,
        language: creatorLang,
        pitch: creatorPitch,
        sampleLink: creatorSampleLink,
      });
      setCreatorReqMessage(t('profile.reqStatusPending'));
    } catch (err) {
      setCreatorReqMessage(getSafeErrorMessage(err, 'Unable to submit creator request.'));
    } finally {
      setCreatorReqBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      setConfirmDeleteOpen(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (raw.includes('requires-recent-login')) {
        setDeleteError(
          'For security, please sign out and sign back in right before deleting your account.'
        );
      } else {
        setDeleteError(getSafeErrorMessage(err, 'Account deletion failed.'));
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!authReady) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="h-64 rounded-2xl bg-[#141418] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
          {t('profile.title')}
        </h1>
        {firebaseUser && (
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-[44px] px-4 rounded-xl bg-[#141418] border border-white/15 text-xs font-medium text-[#F5F3EE] hover:border-white/30 inline-flex items-center gap-2 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            {t('profile.signOut')}
          </button>
        )}
      </div>

      {/* Signed-Out Auth View */}
      {!firebaseUser ? (
        <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 sm:p-8 space-y-6 max-w-xl">
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-semibold text-[#F5F3EE]">
              {t('profile.signInHeading')}
            </h2>
            <p className="text-sm text-[#A39E93]">{t('profile.signInSub')}</p>
          </div>

          <button
            type="button"
            disabled={authBusy}
            onClick={() => void handleGoogleSignIn()}
            className="w-full min-h-[46px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] disabled:opacity-60 transition-colors"
          >
            {t('profile.continueWithGoogle')}
          </button>

          <div className="flex items-center gap-3 text-xs text-[#9B968B]">
            <div className="h-px flex-1 bg-white/10" />
            <span>{t('profile.orEmail')}</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* Login / Signup / Phone OTP segmented tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0B0B0E] border border-white/10">
            <button
              type="button"
              data-testid="auth-tab-login"
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
              className={`min-h-[44px] rounded-lg text-xs font-semibold transition-colors ${
                authMode === 'login' ? 'bg-[#1C1C22] text-[#F5F3EE]' : 'text-[#A39E93]'
              }`}
            >
              {t('profile.tabLogin')}
            </button>
            <button
              type="button"
              data-testid="auth-tab-signup"
              onClick={() => {
                setAuthMode('signup');
                setAuthError(null);
              }}
              className={`min-h-[44px] rounded-lg text-xs font-semibold transition-colors ${
                authMode === 'signup' ? 'bg-[#1C1C22] text-[#F5F3EE]' : 'text-[#A39E93]'
              }`}
            >
              {t('profile.tabSignup')}
            </button>
            <button
              type="button"
              data-testid="auth-tab-phone"
              onClick={() => {
                setAuthMode('phone');
                setAuthError(null);
              }}
              className={`min-h-[44px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                authMode === 'phone' ? 'bg-[#1C1C22] text-[#F5F3EE]' : 'text-[#A39E93]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
              {t('profile.tabPhone')}
            </button>
          </div>

          {authMode === 'phone' ? (
            <div className="space-y-4">
              {!phoneConfirmation ? (
                <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="auth-phone" className="text-xs font-medium text-[#A39E93] block">
                      {t('profile.phoneLabel')}
                    </label>
                    <input
                      id="auth-phone"
                      data-testid="phone-number-input"
                      type="tel"
                      autoComplete="tel"
                      placeholder={t('profile.phonePlaceholder')}
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#78736A] focus:outline-none focus:border-[#E5A93C]"
                      required
                    />
                  </div>

                  {authError && (
                    <p
                      role="alert"
                      data-testid="phone-auth-error"
                      className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/25 rounded-xl px-4 py-3 leading-relaxed"
                    >
                      {authError}
                    </p>
                  )}

                  <button
                    type="submit"
                    data-testid="phone-send-otp-btn"
                    disabled={authBusy}
                    className="w-full min-h-[44px] rounded-xl bg-[#1C1C22] border border-white/15 text-sm font-semibold text-[#F5F3EE] hover:border-[#E5A93C]/50 disabled:opacity-50 transition-colors"
                  >
                    {t('profile.sendOtpBtn')}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyPhoneOtp} className="space-y-4">
                  <p className="text-xs text-[#E5A93C] bg-[#0B0B0E] border border-[#E5A93C]/25 rounded-xl px-4 py-3">
                    {t('profile.otpSentNotice', { phone: phoneSentTo ?? phoneInput })}
                  </p>

                  <div className="space-y-1.5">
                    <label htmlFor="auth-otp" className="text-xs font-medium text-[#A39E93] block">
                      {t('profile.otpLabel')}
                    </label>
                    <input
                      id="auth-otp"
                      data-testid="phone-otp-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder={t('profile.otpPlaceholder')}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm tracking-widest text-[#F5F3EE] placeholder:text-[#78736A] focus:outline-none focus:border-[#E5A93C]"
                      required
                    />
                  </div>

                  {authError && (
                    <p
                      role="alert"
                      className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/25 rounded-xl px-4 py-3 leading-relaxed"
                    >
                      {authError}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      data-testid="phone-verify-otp-btn"
                      disabled={authBusy}
                      className="flex-1 min-h-[44px] rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-sm font-semibold hover:bg-[#F3C669] disabled:opacity-50 transition-colors"
                    >
                      {t('profile.verifyOtpBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={resetPhoneFlow}
                      className="min-h-[44px] px-4 rounded-xl bg-[#0B0B0E] border border-white/15 text-xs font-medium text-[#D6D2C9] hover:text-[#F5F3EE]"
                    >
                      {t('profile.changePhoneBtn')}
                    </button>
                  </div>
                </form>
              )}

              {/* Invisible reCAPTCHA mount point for Firebase Phone Auth */}
              <div ref={recaptchaContainerRef} id="phone-recaptcha-container" />

              <p
                data-testid="phone-auth-console-note"
                className="text-[11px] text-[#9B968B] leading-relaxed"
              >
                {t('profile.phoneAuthConsoleNote')}
              </p>
            </div>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-4">
              {authMode === 'signup' && (
                <div className="space-y-1.5">
                  <label htmlFor="auth-name" className="text-xs font-medium text-[#A39E93] block">
                    {t('profile.displayNameLabel')}
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    maxLength={80}
                    value={signupName}
                    onChange={(e) => setSignupName(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="auth-email" className="text-xs font-medium text-[#A39E93] block">
                  {t('profile.emailLabel')}
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="auth-password" className="text-xs font-medium text-[#A39E93] block">
                  {t('profile.passwordLabel')}
                </label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                  required
                />
              </div>

              {authError && (
                <p
                  role="alert"
                  className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/25 rounded-xl px-4 py-3 leading-relaxed"
                >
                  {authError}
                </p>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className="w-full min-h-[44px] rounded-xl bg-[#1C1C22] border border-white/15 text-sm font-semibold text-[#F5F3EE] hover:border-[#E5A93C]/50 disabled:opacity-50 transition-colors"
              >
                {authMode === 'login' ? t('profile.loginBtn') : t('profile.signupBtn')}
              </button>

              <p className="text-[11px] text-[#9B968B] leading-relaxed">
                {t('profile.emailAuthConsoleNote')}
              </p>
            </form>
          )}
        </section>
      ) : (
        <div className="space-y-8">
          {/* Email verification notice if unverified */}
          {!isVerifiedUser && (
            <div className="rounded-2xl bg-[#1C1C22] border border-[#E5A93C]/40 p-5 space-y-3">
              <div className="flex items-start gap-3">
                <MailCheck className="w-5 h-5 text-[#E5A93C] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#F5F3EE]">
                    {t('profile.verifyEmailBanner')}
                  </p>
                  {verifyMessage && <p className="text-xs text-[#E5A93C]">{verifyMessage}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-8">
                <button
                  type="button"
                  onClick={async () => {
                    await sendVerification();
                    setVerifyMessage('Verification email sent. Check your inbox.');
                  }}
                  className="min-h-[44px] px-4 rounded-lg bg-[#141418] border border-white/15 text-xs font-medium text-[#F5F3EE]"
                >
                  {t('profile.resendVerify')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await refreshVerificationStatus();
                    setVerifyMessage(
                      ok ? 'Email verified! Cloud sync is now active.' : 'Still not verified yet.'
                    );
                  }}
                  className="min-h-[44px] px-4 rounded-lg bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold"
                >
                  {t('profile.refreshVerify')}
                </button>
              </div>
            </div>
          )}

          {/* Account Summary + Edit Profile */}
          <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#E5A93C]/15 border border-[#E5A93C]/40 text-[#F3C669] font-display text-xl font-semibold flex items-center justify-center shrink-0">
                  {identity.avatarInitials}
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold text-[#F5F3EE] truncate">
                    {identity.displayName}
                  </h2>
                  <p className="text-xs text-[#A39E93] truncate">
                    {identity.email || profile?.phoneNumber || firebaseUser?.phoneNumber}
                  </p>
                  <p className="text-xs text-[#E5A93C] mt-0.5 tabular-nums">
                    {t('profile.roleLabel')}: <span className="capitalize">{profile?.role ?? 'user'}</span> ·{' '}
                    {wallet.balance.toLocaleString()} {t('coins.unit')}
                  </p>
                </div>
              </div>

              {/* Single-Device Enforcement Read-Only Summary */}
              <div className="rounded-xl bg-[#0B0B0E] border border-white/10 px-3.5 py-2.5 text-xs space-y-1">
                <p className="text-[#F5F3EE] font-medium inline-flex items-center gap-1.5">
                  <MonitorSmartphone className="w-3.5 h-3.5 text-[#E5A93C]" aria-hidden="true" />
                  {t('session.deviceStatusHeading')}
                </p>
                <p className="text-[#A39E93] truncate max-w-[240px]">
                  {profile?.activeDevice?.deviceInfo.label ?? t('session.activeDeviceNone')}
                </p>
                <p className="text-[#9B968B] tabular-nums">
                  {t('session.warningsCountLabel')}:{' '}
                  <span
                    className={
                      (profile?.warningCount ?? 0) > 0 ? 'text-[#F3C669] font-medium' : 'text-[#D6D2C9]'
                    }
                  >
                    {profile?.warningCount ?? 0} / 3
                  </span>
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <h3 className="text-sm font-semibold text-[#F5F3EE]">
                {t('profile.editProfileHeading')}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="profile-name" className="text-xs text-[#A39E93] block">
                    {t('profile.displayNameLabel')}
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    maxLength={80}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="profile-lang" className="text-xs text-[#A39E93] block">
                    {t('profile.languagePrefLabel')}
                  </label>
                    <select
                      id="profile-lang"
                      value={editLang}
                      onChange={(e) => {
                        const next = e.target.value as LanguageCode;
                        setEditLang(next);
                        setLang(next);
                      }}
                      className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                    >
                      {supportedLanguages.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.nativeLabel} ({item.label})
                        </option>
                      ))}
                    </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="profile-format" className="text-xs text-[#A39E93] block">
                    {t('profile.preferredFormatLabel')}
                  </label>
                  <select
                    id="profile-format"
                    value={editFormat}
                    onChange={(e) => setEditFormat(e.target.value as PlaybackFormat)}
                    className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                  >
                    <option value="audio">{t('player.audioMode')}</option>
                    <option value="video">{t('player.videoMode')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="profile-bio" className="text-xs text-[#A39E93] block">
                  {t('profile.bioLabel')}
                </label>
                <textarea
                  id="profile-bio"
                  rows={2}
                  maxLength={300}
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  placeholder="Tell fellow listeners what genres you enjoy..."
                  className="w-full p-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE] placeholder:text-[#9B968B] focus:outline-none focus:border-[#E5A93C]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={profileBusy || !isVerifiedUser}
                  className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 transition-colors"
                >
                  {t('profile.saveProfile')}
                </button>
                {profileStatus && (
                  <span className="text-xs text-[#E5A93C] inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    {profileStatus}
                  </span>
                )}
              </div>
            </form>
          </section>

          {/* Role Workspaces Quick Links */}
          <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
              {t('profile.workspacesHeading')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link
                to="/wallet"
                className="min-h-[56px] p-4 rounded-xl bg-[#0B0B0E] border border-white/10 hover:border-[#E5A93C]/50 flex items-center justify-between gap-2 transition-colors"
              >
                <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[#F5F3EE]">
                  <Coins className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                  {t('profile.openWallet')}
                </span>
                <ArrowRight className="w-4 h-4 text-[#8A857B]" aria-hidden="true" />
              </Link>

              {(profile?.role === 'creator' || profile?.role === 'admin') && (
                <Link
                  to="/studio"
                  className="min-h-[56px] p-4 rounded-xl bg-[#0B0B0E] border border-[#E5A93C]/30 hover:border-[#E5A93C] flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[#F5F3EE]">
                    <Mic className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                    {t('profile.openStudio')}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                </Link>
              )}

              {profile?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="min-h-[56px] p-4 rounded-xl bg-[#0B0B0E] border border-[#E5A93C]/30 hover:border-[#E5A93C] flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="inline-flex items-center gap-2.5 text-sm font-medium text-[#F5F3EE]">
                    <Shield className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                    {t('profile.openAdmin')}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
                </Link>
              )}
            </div>
          </section>

          {/* Become a Creator Application Flow (for standard user role) */}
          {profile?.role === 'user' && (
            <section
              id="become-creator"
              className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                    {t('profile.becomeCreatorHeading')}
                  </h2>
                  <p className="text-xs text-[#A39E93] max-w-2xl leading-relaxed">
                    {t('profile.becomeCreatorDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshProfileAndRequest()}
                  className="min-h-[44px] px-3 rounded-lg text-xs text-[#E5A93C] hover:text-[#F3C669] font-medium inline-flex items-center"
                >
                  {t('common.refresh')}
                </button>
              </div>

              {creatorRequest && (
                <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-1.5 text-xs">
                  <p
                    className={`font-semibold ${
                      creatorRequest.status === 'approved'
                        ? 'text-emerald-400'
                        : creatorRequest.status === 'rejected'
                          ? 'text-rose-300'
                          : 'text-[#E5A93C]'
                    }`}
                  >
                    {creatorRequest.status === 'pending'
                      ? t('profile.reqStatusPending')
                      : creatorRequest.status === 'approved'
                        ? t('profile.reqStatusApproved')
                        : t('profile.reqStatusRejected')}
                  </p>
                  <p className="text-[#A39E93]">
                    {creatorRequest.studioName} ({creatorRequest.handle})
                  </p>
                  {creatorRequest.reviewNote && (
                    <p className="text-[#D6D2C9]">Admin note: {creatorRequest.reviewNote}</p>
                  )}
                </div>
              )}

              {(!creatorRequest || creatorRequest.status === 'rejected') && (
                <form onSubmit={handleSubmitCreatorRequest} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="creator-studio-name" className="text-xs text-[#A39E93] block">
                        {t('profile.studioNameLabel')}
                      </label>
                      <input
                        id="creator-studio-name"
                        type="text"
                        required
                        maxLength={100}
                        value={studioName}
                        onChange={(e) => setStudioName(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="creator-handle" className="text-xs text-[#A39E93] block">
                        {t('profile.handleLabel')}
                      </label>
                      <input
                        id="creator-handle"
                        type="text"
                        placeholder="@yourstudio"
                        maxLength={60}
                        value={creatorHandle}
                        onChange={(e) => setCreatorHandle(e.target.value)}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="creator-lang" className="text-xs text-[#A39E93] block">
                        {t('profile.storyLanguageLabel')}
                      </label>
                      <select
                        id="creator-lang"
                        value={creatorLang}
                        onChange={(e) => setCreatorLang(e.target.value as ContentLanguage)}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                      >
                        <option value="bilingual">{t('common.bilingual')}</option>
                        <option value="hi">{t('common.hindi')}</option>
                        <option value="en">{t('common.english')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="creator-pitch" className="text-xs text-[#A39E93] block">
                      {t('profile.pitchLabel')}
                    </label>
                    <textarea
                      id="creator-pitch"
                      rows={3}
                      required
                      minLength={10}
                      maxLength={600}
                      value={creatorPitch}
                      onChange={(e) => setCreatorPitch(e.target.value)}
                      className="w-full p-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="creator-sample" className="text-xs text-[#A39E93] block">
                      {t('profile.sampleLinkLabel')}
                    </label>
                    <input
                      id="creator-sample"
                      type="url"
                      maxLength={300}
                      placeholder="https://..."
                      value={creatorSampleLink}
                      onChange={(e) => setCreatorSampleLink(e.target.value)}
                      className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/10 text-sm text-[#F5F3EE]"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={creatorReqBusy || !isVerifiedUser}
                      className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 transition-colors"
                    >
                      {creatorRequest?.status === 'rejected'
                        ? t('profile.resubmitCreatorReq')
                        : t('profile.submitCreatorReq')}
                    </button>
                    {creatorReqMessage && (
                      <span className="text-xs text-[#E5A93C]">{creatorReqMessage}</span>
                    )}
                  </div>
                </form>
              )}
            </section>
          )}

          {/* Coin Wallet Summary Section */}
          <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Coins className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                  {t('profile.walletHeading')}
                </h2>
                <p className="text-xs text-[#A39E93] max-w-2xl">
                  {t('profile.walletDesc')}
                </p>
              </div>
              <Link
                to="/wallet"
                className="min-h-[44px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Coins className="w-4 h-4" aria-hidden="true" />
                {t('profile.openWallet')}
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
              <div className="rounded-xl bg-[#0B0B0E] border border-[#E5A93C]/30 p-4">
                <p className="text-[11px] text-[#A39E93]">{t('wallet.balanceLabel')}</p>
                <p className="font-display text-2xl font-semibold text-[#F3C669] mt-1">
                  {wallet.balance.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4">
                <p className="text-[11px] text-[#A39E93]">{t('wallet.statPurchased')}</p>
                <p className="font-display text-2xl font-semibold text-[#F5F3EE] mt-1">
                  {wallet.lifetimePurchased.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4">
                <p className="text-[11px] text-[#A39E93]">{t('wallet.statSpent')}</p>
                <p className="font-display text-2xl font-semibold text-[#F5F3EE] mt-1">
                  {wallet.lifetimeSpent.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4">
                <p className="text-[11px] text-[#A39E93]">{t('wallet.statUnlocked')}</p>
                <p className="font-display text-2xl font-semibold text-[#F5F3EE] mt-1">
                  {episodeUnlocks.length}
                </p>
              </div>
            </div>
          </section>

          {/* Firestore Database Seeder */}
          <section className="rounded-2xl bg-[#141418] border border-white/[0.08] p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Database className="w-5 h-5 text-[#E5A93C]" aria-hidden="true" />
                  {t('profile.seedHeading')}
                </h2>
                <p className="text-xs text-[#A39E93]">{t('profile.seedSubtitle')}</p>
                <p className="text-xs text-[#9B968B]">
                  Current source:{' '}
                  <span className="text-[#F5F3EE]">
                    {catalogSource === 'firestore'
                      ? t('home.catalogSourceFirestore')
                      : 'Local Seed Fallback'}
                  </span>
                </p>
              </div>

              {profile?.role === 'admin' ? (
                <button
                  type="button"
                  disabled={seedBusy}
                  onClick={() => void handleSeedFirestore()}
                  className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {seedBusy ? t('profile.seeding') : t('profile.seedButton')}
                </button>
              ) : (
                <span className="text-xs text-[#9B968B]">{t('profile.seedAdminOnly')}</span>
              )}
            </div>

            {seedMessage && (
              <p className="text-xs text-[#E5A93C] bg-[#0B0B0E] border border-white/10 rounded-xl px-4 py-3">
                {seedMessage}
              </p>
            )}
          </section>

          {/* Danger Zone: Delete Account */}
          <section className="rounded-2xl bg-[#141418] border border-rose-500/20 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-rose-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                {t('profile.dangerZone')}
              </h2>
              <p className="text-xs text-[#A39E93] max-w-xl">{t('profile.dangerDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="min-h-[44px] px-4 rounded-xl border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('profile.deleteBtn')}
            </button>
          </section>
        </div>
      )}

      {/* Delete Account Confirmation Dialog */}
      {confirmDeleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('profile.confirmDeleteTitle')}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-white/10 p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#F5F3EE]">
              {t('profile.confirmDeleteTitle')}
            </h2>
            <p className="text-sm text-[#A39E93] leading-relaxed">
              {t('profile.confirmDeleteBody')}
            </p>
            {deleteError && <p className="text-xs text-rose-300">{deleteError}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 disabled:opacity-50"
              >
                {t('profile.confirmDeleteBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
