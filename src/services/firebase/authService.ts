import {
  createUserWithEmailAndPassword,
  deleteUser,
  RecaptchaVerifier,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { ActiveDeviceSession, LanguageCode, PlaybackFormat, UserProfile } from '../../types';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './config';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  buildFallbackUserProfile,
  computeInitials,
  isPermissionDeniedError,
} from './activityPersistence';

export { BOOTSTRAP_ADMIN_EMAIL, buildFallbackUserProfile, computeInitials };
export type { ConfirmationResult };

export function normalizeE164Phone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export async function signInWithGoogleAccount(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const safeName = displayName.trim().slice(0, 80) || 'Listener';
  await updateProfile(cred.user, { displayName: safeName });
  try {
    await sendEmailVerification(cred.user);
  } catch (err) {
    console.warn('Verification email could not be dispatched:', err);
  }
  return cred.user;
}

/**
 * Firebase Phone Auth code path (requires enabling Phone sign-in in Firebase Console).
 * Creates an invisible reCAPTCHA verifier attached to `containerElement` and sends an SMS OTP.
 */
export async function startPhoneOtpSignIn(
  rawPhone: string,
  containerElement: HTMLElement
): Promise<{ confirmation: ConfirmationResult; clearRecaptcha: () => void }> {
  const normalized = normalizeE164Phone(rawPhone);
  if (!normalized) {
    throw new Error('Enter a valid phone number in international format (e.g. +919876543210).');
  }
  const verifier = new RecaptchaVerifier(auth, containerElement, {
    size: 'invisible',
  });
  try {
    const confirmation = await signInWithPhoneNumber(auth, normalized, verifier);
    return {
      confirmation,
      clearRecaptcha: () => {
        try {
          verifier.clear();
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    try {
      verifier.clear();
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function confirmPhoneOtpSignIn(
  confirmation: ConfirmationResult,
  otpCode: string
): Promise<User> {
  const cleaned = otpCode.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(cleaned)) {
    throw new Error('Enter the 6-digit verification code sent to your phone.');
  }
  const cred = await confirmation.confirm(cleaned);
  return cred.user;
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

function toMs(val: unknown): number | null {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return null;
}

function parseClientActiveDevice(raw: unknown): ActiveDeviceSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const deviceId = typeof obj.deviceId === 'string' ? obj.deviceId : '';
  if (!deviceId) return null;
  const info = (obj.deviceInfo && typeof obj.deviceInfo === 'object'
    ? obj.deviceInfo
    : {}) as Record<string, unknown>;
  return {
    deviceId,
    deviceInfo: {
      label: typeof info.label === 'string' ? info.label : 'Web Browser',
      platform: typeof info.platform === 'string' ? info.platform : undefined,
      userAgent: typeof info.userAgent === 'string' ? info.userAgent : undefined,
    },
    registeredAt: toMs(obj.registeredAt) ?? 0,
    lastSeen: toMs(obj.lastSeen) ?? 0,
  };
}

/**
 * Fetches or creates the user's Firestore profile document (`users/{uid}`).
 * Only writes to Firestore when `user.emailVerified === true` or `user.phoneNumber` is verified.
 * Never writes server-managed fields (`warningCount`, `banned`, `activeDevice`, `lastSeen`).
 */
export async function syncUserProfile(
  user: User,
  defaultLanguage: LanguageCode
): Promise<UserProfile> {
  const fallbackProfile = buildFallbackUserProfile(user, defaultLanguage);
  const isVerifiedAccount = Boolean(user.emailVerified || user.phoneNumber);
  const isBootstrapAdmin =
    user.emailVerified && user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  let hasAdminTokenClaim = false;
  try {
    const tokenResult = await user.getIdTokenResult();
    hasAdminTokenClaim = tokenResult.claims?.admin === true;
  } catch {
    hasAdminTokenClaim = false;
  }

  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const resolvedDisplayName =
        (typeof data.displayName === 'string' && data.displayName.trim()) ||
        fallbackProfile.displayName;
      const resolvedEmail =
        (typeof data.email === 'string' && data.email.trim()) || fallbackProfile.email;
      const resolvedPhone =
        (typeof data.phoneNumber === 'string' && data.phoneNumber.trim()) ||
        fallbackProfile.phoneNumber;
      const hasAdminFlag = data.admin === true;
      const roleVal =
        data.role === 'admin' || data.role === 'creator' || data.role === 'user'
          ? data.role
          : fallbackProfile.role;
      const isResolvedAdmin =
        isBootstrapAdmin || hasAdminTokenClaim || hasAdminFlag || roleVal === 'admin';

      return {
        ...fallbackProfile,
        uid: user.uid,
        email: resolvedEmail,
        ...(resolvedPhone ? { phoneNumber: resolvedPhone } : {}),
        displayName: resolvedDisplayName,
        bio: typeof data.bio === 'string' ? data.bio : '',
        preferredLanguage:
          typeof data.preferredLanguage === 'string' ? data.preferredLanguage : defaultLanguage,
        preferredFormat: data.preferredFormat === 'video' ? 'video' : 'audio',
        role: isResolvedAdmin ? 'admin' : roleVal,
        admin: isResolvedAdmin,
        isDisabled: Boolean(data.isDisabled),
        warningCount:
          typeof data.warningCount === 'number' && Number.isFinite(data.warningCount)
            ? Math.max(0, Math.floor(data.warningCount))
            : 0,
        banned: Boolean(data.banned),
        bannedAt: toMs(data.bannedAt),
        banReason: typeof data.banReason === 'string' ? data.banReason : null,
        activeDevice: parseClientActiveDevice(data.activeDevice),
        lastSeen: toMs(data.lastSeen),
        avatarInitials:
          (typeof data.avatarInitials === 'string' && data.avatarInitials.trim()) ||
          computeInitials(resolvedDisplayName),
      };
    }

    if (!isVerifiedAccount) {
      return hasAdminTokenClaim ? { ...fallbackProfile, role: 'admin', admin: true } : fallbackProfile;
    }

    const baseDoc: Record<string, unknown> = {
      uid: user.uid,
      email: fallbackProfile.email.slice(0, 200),
      displayName: fallbackProfile.displayName,
      bio: '',
      preferredLanguage: defaultLanguage,
      role: 'user' as const,
      avatarInitials: fallbackProfile.avatarInitials,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (fallbackProfile.phoneNumber) {
      baseDoc.phoneNumber = fallbackProfile.phoneNumber.slice(0, 32);
    }

    try {
      await setDoc(userRef, {
        ...baseDoc,
        preferredFormat: 'audio' as const,
      });
    } catch (createErr) {
      if (isPermissionDeniedError(createErr)) {
        await setDoc(userRef, baseDoc);
      } else {
        throw createErr;
      }
    }

    return fallbackProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function updateUserProfileRecord(
  uid: string,
  updates: {
    displayName: string;
    bio: string;
    preferredLanguage: LanguageCode;
    preferredFormat?: PlaybackFormat;
  }
): Promise<void> {
  const safeName = updates.displayName.trim().slice(0, 80);
  const safeBio = updates.bio.trim().slice(0, 300);
  const avatarInitials = computeInitials(safeName);

  const userRef = doc(db, 'users', uid);
  try {
    const payload: Record<string, unknown> = {
      displayName: safeName,
      bio: safeBio,
      preferredLanguage: updates.preferredLanguage,
      avatarInitials,
      updatedAt: serverTimestamp(),
    };
    if (updates.preferredFormat === 'audio' || updates.preferredFormat === 'video') {
      payload.preferredFormat = updates.preferredFormat;
    }
    await updateDoc(userRef, payload);
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: safeName });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function updateUserPreferredFormat(
  uid: string,
  preferredFormat: PlaybackFormat
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    await updateDoc(userRef, {
      preferredFormat,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

/**
 * Deletes the user's personal Firestore records (profile, history, bookmarks,
 * daily unlocks, interactive choices) and removes their Firebase Auth account.
 */
export async function deleteAccountAndData(user: User): Promise<void> {
  const uid = user.uid;
  try {
    const userCollections = ['listeningHistory', 'bookmarks', 'dailyUnlocks', 'userChoices'];
    const batch = writeBatch(db);

    for (const colName of userCollections) {
      const snap = await getDocs(
        query(collection(db, colName), where('userId', '==', uid))
      );
      snap.docs.forEach((d) => batch.delete(d.ref));
    }

    await batch.commit();

    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await deleteDoc(userRef);
    }

    await deleteUser(user);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
  }
}
