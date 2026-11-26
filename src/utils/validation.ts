/**
 * Input validation, safe URL scheme sanitization, and user-facing error redaction.
 * Ensures untrusted URLs (coverUrl, sampleLink, external media) cannot inject
 * javascript:, vbscript:, or data: schemes, and prevents internal Firestore JSON
 * diagnostic payloads (UIDs, emails, paths) from leaking into end-user alerts.
 */

const SAFE_URL_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Returns a sanitized URL safe for <img src>, <video poster>, <a href>, or media playback.
 * Allows:
 * - Relative root paths starting with "/" (excluding protocol-relative "//")
 * - Valid http:// or https:// URLs
 * Blocks javascript:, data:, vbscript:, file:, and malformed URLs.
 */
export function sanitizeSafeUrl(raw: string | null | undefined): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;

  // Reject control characters or whitespace-smuggled protocols
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return undefined;

  // Allow safe root-relative app paths (e.g. /demo-media/clip.mp4, /assets/cover.png)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Validates an optional user-entered URL (such as cover image or portfolio sample link).
 * Empty string is valid (optional); non-empty strings must be valid http/https or root-relative URLs.
 */
export function validateOptionalUrl(
  raw: string | null | undefined,
  allowRelative = false
): { valid: boolean; sanitized?: string; error?: string } {
  if (!raw || !raw.trim()) {
    return { valid: true, sanitized: undefined };
  }
  const trimmed = raw.trim();
  if (trimmed.length > 300) {
    return { valid: false, error: 'URL must be 300 characters or fewer.' };
  }
  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { valid: true, sanitized: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
      return { valid: false, error: 'Only https:// or http:// links are allowed.' };
    }
    return { valid: true, sanitized: parsed.toString() };
  } catch {
    return { valid: false, error: 'Please enter a valid https:// URL.' };
  }
}

/**
 * Converts raw Firebase Auth, Firestore, or JSON diagnostic errors into clean,
 * safe user-facing messages that never expose internal UIDs, emails, or stack traces.
 */
export function getSafeErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (!error) return fallback;

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;

  const trimmed = rawMessage.trim();
  if (!trimmed) return fallback;

  // Detect internal structured Firestore diagnostic JSON thrown by handleFirestoreError()
  if (trimmed.startsWith('{') && trimmed.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: string };
      const inner = (parsed.error ?? '').toLowerCase();
      if (inner.includes('permission-denied') || inner.includes('missing or insufficient permissions')) {
        return 'You do not have permission to perform this action. Please sign in with an authorized, verified account.';
      }
      if (inner.includes('unavailable') || inner.includes('offline') || inner.includes('network')) {
        return 'Unable to reach Cloud Firestore right now. Please check your connection and try again.';
      }
      if (inner.includes('not-found')) {
        return 'The requested record could not be found. Please refresh and try again.';
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  const lower = trimmed.toLowerCase();

  // Common Firebase Auth error mappings
  if (lower.includes('auth/operation-not-allowed')) {
    return 'Email/Password sign-in is not yet enabled in Firebase Console. Use Google Sign-In above, or enable Email/Password under Authentication → Sign-in method.';
  }
  if (lower.includes('auth/invalid-credential') || lower.includes('auth/wrong-password') || lower.includes('auth/user-not-found')) {
    return 'Invalid email or password. Please check your credentials and try again.';
  }
  if (lower.includes('auth/email-already-in-use')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('auth/weak-password')) {
    return 'Please choose a stronger password (at least 6 characters).';
  }
  if (lower.includes('auth/too-many-requests')) {
    return 'Too many attempts. Please wait a moment before trying again.';
  }
  if (lower.includes('auth/popup-closed-by-user')) {
    return 'Sign-in popup was closed before completing. Please try again.';
  }
  if (lower.includes('auth/network-request-failed') || lower.includes('network error')) {
    return 'Network connection error. Please check your internet connection and retry.';
  }
  if (lower.includes('auth/requires-recent-login')) {
    return 'For security, please sign out and sign back in right before deleting your account.';
  }
  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return 'You do not have permission to perform this action.';
  }

  // Strip raw Firebase prefix noise like "Firebase: Error (auth/...)." if unrecognized
  if (lower.startsWith('firebase:')) {
    return fallback;
  }

  // Preserve concise, intentional application validation messages
  return trimmed.slice(0, 260);
}
