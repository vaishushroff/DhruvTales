import crypto from 'node:crypto';

export const MEDIA_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes
export const MEDIA_TOKEN_TTL_MS = MEDIA_TOKEN_TTL_SECONDS * 1000;

export type StreamFormat = 'audio' | 'video';

export interface MediaStreamTokenPayload {
  episodeId: string;
  uid: string;
  format: StreamFormat;
  /** Expiration timestamp in Unix epoch milliseconds */
  exp: number;
}

export type MediaTokenVerificationResult =
  | {
      valid: true;
      payload: MediaStreamTokenPayload;
    }
  | {
      valid: false;
      code: 'missing_token' | 'invalid_token' | 'expired_token' | 'server_not_configured';
      message: string;
    };

function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64');
}

function computeSignature(encodedPayload: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest();
}

export function getMediaSigningSecret(): string | null {
  const secret = process.env.MEDIA_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return null;
  }
  return secret;
}

/**
 * Mints a short-lived HMAC-SHA256 signed token for /api/media/stream.
 * Encodes only { episodeId, uid, format, exp } — NEVER a Drive file ID or Drive URL.
 */
export function createMediaStreamToken(
  params: {
    episodeId: string;
    uid: string;
    format: StreamFormat;
  },
  secret: string,
  nowMs: number = Date.now(),
  ttlMs: number = MEDIA_TOKEN_TTL_MS
): { token: string; expiresAt: number } {
  if (!secret || secret.length < 16) {
    throw new Error('MEDIA_SIGNING_SECRET must be configured with at least 16 characters.');
  }

  const expiresAt = nowMs + ttlMs;
  const payload: MediaStreamTokenPayload = {
    episodeId: params.episodeId,
    uid: params.uid,
    format: params.format,
    exp: expiresAt,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(computeSignature(encodedPayload, secret));
  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
  };
}

/**
 * Verifies an HMAC-SHA256 signed media token using constant-time signature comparison.
 */
export function verifyMediaStreamToken(
  token: string | undefined | null,
  secret: string | null,
  nowMs: number = Date.now()
): MediaTokenVerificationResult {
  if (!secret || secret.length < 16) {
    return {
      valid: false,
      code: 'server_not_configured',
      message: 'Media signing secret is not configured on the server.',
    };
  }

  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      code: 'missing_token',
      message: 'Missing media stream token.',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Malformed media stream token.',
    };
  }

  const [encodedPayload, encodedSig] = parts;

  let providedSig: Buffer;
  try {
    providedSig = fromBase64Url(encodedSig);
  } catch {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Invalid media token signature encoding.',
    };
  }

  const expectedSig = computeSignature(encodedPayload, secret);
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Invalid media stream token signature.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
  } catch {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Corrupted media stream token payload.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Invalid media stream token payload.',
    };
  }

  const record = parsed as Record<string, unknown>;
  const episodeId = typeof record.episodeId === 'string' ? record.episodeId.trim() : '';
  const uid = typeof record.uid === 'string' ? record.uid.trim() : '';
  const format = record.format === 'audio' || record.format === 'video' ? record.format : null;
  const exp = typeof record.exp === 'number' && Number.isFinite(record.exp) ? record.exp : 0;

  if (!episodeId || !uid || !format || exp <= 0) {
    return {
      valid: false,
      code: 'invalid_token',
      message: 'Incomplete media stream token payload.',
    };
  }

  if (exp <= nowMs) {
    return {
      valid: false,
      code: 'expired_token',
      message: 'Media stream token has expired. Refreshing authorization is required.',
    };
  }

  return {
    valid: true,
    payload: {
      episodeId,
      uid,
      format,
      exp,
    },
  };
}
