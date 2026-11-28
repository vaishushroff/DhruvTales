import crypto from 'node:crypto';
import { resolveDriveServiceAccountCreds } from './driveServiceAccount';
import type { StreamFormat } from './mediaToken';

export interface ProxyStreamTokenPayload {
  kind: 'drive' | 'url';
  target: string;
  format: StreamFormat;
  exp: number;
}

const PROXY_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Lazily initialized only inside request handlers (never at top-level module import)
let lazyEphemeralFallbackKey: Buffer | null = null;

function getProxyAesKey(): Buffer {
  const configured = process.env.MEDIA_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return crypto
      .createHash('sha256')
      .update(`dhruv-tales:media-proxy:v1:${configured}`, 'utf8')
      .digest();
  }
  const saCreds = resolveDriveServiceAccountCreds(process.env);
  if (saCreds) {
    return crypto
      .createHash('sha256')
      .update(`dhruv-tales:media-proxy-sa:v1:${saCreds.clientEmail}:${saCreds.privateKey}`, 'utf8')
      .digest();
  }
  if (!lazyEphemeralFallbackKey) {
    lazyEphemeralFallbackKey = crypto.randomBytes(32);
  }
  return lazyEphemeralFallbackKey;
}

function toBase64Url(input: Buffer | Uint8Array): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padLen = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function createProxyStreamToken(params: {
  kind: 'drive' | 'url';
  target: string;
  format: StreamFormat;
  ttlMs?: number;
}): { token: string; expiresAt: number } {
  const ttl = Math.max(30_000, Math.min(30 * 60 * 1000, params.ttlMs ?? PROXY_TOKEN_TTL_MS));
  const expiresAt = Date.now() + ttl;
  const payload: ProxyStreamTokenPayload = {
    kind: params.kind,
    target: params.target,
    format: params.format,
    exp: expiresAt,
  };

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getProxyAesKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, encrypted, authTag]);

  return {
    token: `v1.${toBase64Url(packed)}`,
    expiresAt,
  };
}

export type ProxyTokenVerificationResult =
  | { valid: true; payload: ProxyStreamTokenPayload }
  | { valid: false; code: 'invalid_token' | 'expired_token'; message: string };

export function verifyProxyStreamToken(token: string | null | undefined): ProxyTokenVerificationResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, code: 'invalid_token', message: 'Missing media stream token.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] !== 'v1') {
    return { valid: false, code: 'invalid_token', message: 'Malformed media stream token.' };
  }

  const packed = fromBase64Url(parts[1]);
  if (!packed || packed.length <= IV_BYTES + AUTH_TAG_BYTES) {
    return { valid: false, code: 'invalid_token', message: 'Invalid media token payload.' };
  }

  const iv = packed.subarray(0, IV_BYTES);
  const authTag = packed.subarray(packed.length - AUTH_TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES, packed.length - AUTH_TAG_BYTES);

  let decrypted: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getProxyAesKey(), iv);
    decipher.setAuthTag(authTag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return { valid: false, code: 'invalid_token', message: 'Media stream token verification failed.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted.toString('utf8'));
  } catch {
    return { valid: false, code: 'invalid_token', message: 'Corrupt media token payload.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, code: 'invalid_token', message: 'Invalid media token payload.' };
  }

  const record = parsed as Record<string, unknown>;
  const kind = record.kind === 'drive' || record.kind === 'url' ? record.kind : null;
  const target = typeof record.target === 'string' && record.target.trim() ? record.target.trim() : null;
  const format = record.format === 'audio' || record.format === 'video' ? record.format : null;
  const exp = typeof record.exp === 'number' && Number.isFinite(record.exp) ? record.exp : null;

  if (!kind || !target || !format || !exp) {
    return { valid: false, code: 'invalid_token', message: 'Incomplete media token payload.' };
  }

  if (Date.now() > exp) {
    return { valid: false, code: 'expired_token', message: 'Media stream session expired.' };
  }

  return {
    valid: true,
    payload: { kind, target, format, exp },
  };
}
