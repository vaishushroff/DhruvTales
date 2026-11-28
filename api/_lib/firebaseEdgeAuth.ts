const FIREBASE_PROJECT_ID = 'dhruv-tales';
const FIREBASE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface JwkKey {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

let cachedJwks: { keys: JwkKey[]; fetchedAt: number } | null = null;
const TEXT_ENCODER = new TextEncoder();

function base64UrlToUint8Array(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padLen = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  try {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToUint8Array(segment);
  if (!bytes) return null;
  try {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchFirebaseJwks(forceRefresh = false): Promise<JwkKey[]> {
  if (!forceRefresh && cachedJwks && Date.now() - cachedJwks.fetchedAt < 60 * 60 * 1000) {
    return cachedJwks.keys;
  }
  const res = await fetch(FIREBASE_JWK_URL);
  if (!res.ok) {
    throw new Error('Unable to load Firebase public signing keys.');
  }
  const data = (await res.json()) as { keys?: JwkKey[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedJwks = { keys, fetchedAt: Date.now() };
  return keys;
}

export interface VerifiedEdgeUser {
  uid: string;
  email?: string;
}

/**
 * Cryptographically verifies a Firebase ID token using Google's public RS256 JWKs
 * and standard Web Crypto API (works identically on Cloudflare Workers and Node 20+).
 */
export async function verifyFirebaseIdTokenEdge(
  authHeader: string | string[] | null | undefined,
  projectId = FIREBASE_PROJECT_ID
): Promise<{ ok: true; user: VerifiedEdgeUser } | { ok: false; status: number; message: string }> {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const match = raw ? /^Bearer\s+(.+)$/i.exec(raw.trim()) : null;
  const token = match?.[1]?.trim();

  if (!token) {
    return {
      ok: false,
      status: 401,
      message: 'Sign in with your Creator or Admin account to access Google Drive folders.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, status: 401, message: 'Invalid Firebase session token.' };
  }

  const [headerSeg, payloadSeg, sigSeg] = parts;
  const header = decodeBase64UrlJson(headerSeg);
  const payload = decodeBase64UrlJson(payloadSeg);
  const sigBytes = base64UrlToUint8Array(sigSeg);

  if (!header || !payload || !sigBytes) {
    return { ok: false, status: 401, message: 'Malformed Firebase session token.' };
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    return { ok: false, status: 401, message: 'Unsupported Firebase token algorithm.' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload.iat === 'number' ? payload.iat : 0;
  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  const iss = typeof payload.iss === 'string' ? payload.iss : '';
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';

  if (!sub || exp <= nowSec || iat > nowSec + 300) {
    return { ok: false, status: 401, message: 'Your session expired. Please sign in again.' };
  }

  if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, status: 401, message: 'Session token does not belong to this project.' };
  }

  try {
    let keys = await fetchFirebaseJwks(false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      keys = await fetchFirebaseJwks(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) {
      return { ok: false, status: 401, message: 'Unrecognized Firebase signing key.' };
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBuffer = new ArrayBuffer(sigBytes.byteLength);
    new Uint8Array(sigBuffer).set(sigBytes);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      sigBuffer,
      TEXT_ENCODER.encode(`${headerSeg}.${payloadSeg}`)
    );

    if (!valid) {
      return { ok: false, status: 401, message: 'Invalid Firebase token signature.' };
    }

    return {
      ok: true,
      user: {
        uid: sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      },
    };
  } catch {
    return { ok: false, status: 503, message: 'Could not verify session token right now.' };
  }
}
