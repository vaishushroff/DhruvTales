import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminDb } from './firebaseAdmin';

export const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';

export interface DecodedAdminTokenLike {
  uid: string;
  email?: string;
  email_verified?: boolean;
  admin?: unknown;
  [key: string]: unknown;
}

export interface UserDocAdminLike {
  admin?: unknown;
  role?: unknown;
}

export type AdminAccessReason =
  | 'custom_claim'
  | 'bootstrap_email'
  | 'admins_registry'
  | 'user_doc_admin_flag'
  | 'user_doc_admin_role'
  | 'denied';

export interface AdminAccessResult {
  allowed: boolean;
  reason: AdminAccessReason;
}

/**
 * Verifies the Firebase Auth `'admin'` custom claim directly on the decoded ID token.
 * Strictly requires boolean `true` so truthy strings/numbers cannot spoof privilege.
 */
export function hasAdminCustomClaim(
  decoded: DecodedAdminTokenLike | null | undefined
): boolean {
  return Boolean(decoded && decoded.admin === true);
}

/**
 * Pure admin authorization evaluator combining:
 * 1. Firebase ID token `'admin'` custom claim (`decoded.admin === true`)
 * 2. Verified bootstrap admin email (`email_verified === true`)
 * 3. Trusted Firestore `admins/{uid}` registry document
 * 4. Firestore `users/{uid}` boolean `admin === true` flag or `role === 'admin'`
 */
export function evaluateAdminAccess(params: {
  decoded: DecodedAdminTokenLike | null | undefined;
  adminDocExists?: boolean;
  userDocData?: UserDocAdminLike | null;
}): AdminAccessResult {
  const { decoded, adminDocExists = false, userDocData = null } = params;
  if (!decoded) {
    return { allowed: false, reason: 'denied' };
  }

  if (hasAdminCustomClaim(decoded)) {
    return { allowed: true, reason: 'custom_claim' };
  }

  if (
    decoded.email_verified === true &&
    typeof decoded.email === 'string' &&
    decoded.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
  ) {
    return { allowed: true, reason: 'bootstrap_email' };
  }

  if (adminDocExists) {
    return { allowed: true, reason: 'admins_registry' };
  }

  if (userDocData?.admin === true) {
    return { allowed: true, reason: 'user_doc_admin_flag' };
  }

  if (userDocData?.role === 'admin') {
    return { allowed: true, reason: 'user_doc_admin_role' };
  }

  return { allowed: false, reason: 'denied' };
}

/**
 * Server-side admin gate for protected `/api/*` routes.
 * Checks the Firebase ID token `'admin'` custom claim first (zero Firestore reads),
 * then verified bootstrap email, then Firestore `admins/{uid}` and `users/{uid}` (`admin === true` or `role === 'admin'`).
 */
export async function verifyAdminActor(
  decoded: DecodedIdToken
): Promise<AdminAccessResult> {
  const tokenCheck = evaluateAdminAccess({ decoded });
  if (tokenCheck.allowed) {
    return tokenCheck;
  }

  const db = getAdminDb();
  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(decoded.uid).get(),
    db.collection('users').doc(decoded.uid).get(),
  ]);

  return evaluateAdminAccess({
    decoded,
    adminDocExists: adminSnap.exists,
    userDocData: (userSnap.data() as UserDocAdminLike | undefined) ?? null,
  });
}
