import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';

export class ServerConfigError extends Error {
  readonly code = 'server_not_configured' as const;
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = 'ServerConfigError';
  }
}

export class AuthVerificationError extends Error {
  readonly code: 'unauthenticated' | 'invalid_token' | 'token_revoked' | 'account_banned';
  readonly status: 401 | 403;

  constructor(
    code: 'unauthenticated' | 'invalid_token' | 'token_revoked' | 'account_banned',
    message: string,
    status: 401 | 403 = 401
  ) {
    super(message);
    this.name = 'AuthVerificationError';
    this.code = code;
    this.status = status;
  }
}

export class AccountBannedError extends AuthVerificationError {
  readonly banReason: string;
  readonly warningCount: number;

  constructor(message: string, banReason = '', warningCount = 3) {
    super('account_banned', message, 403);
    this.name = 'AccountBannedError';
    this.banReason = banReason;
    this.warningCount = warningCount;
  }
}

function parseJsonOrBase64(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(decoded) as Record<string, unknown>;
}

function loadServiceAccountFromEnv(): ServiceAccount {
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonEnv) {
    try {
      const parsed = parseJsonOrBase64(jsonEnv);
      const projectId = String(parsed.project_id ?? parsed.projectId ?? '').trim();
      const clientEmail = String(parsed.client_email ?? parsed.clientEmail ?? '').trim();
      const privateKey = String(parsed.private_key ?? parsed.privateKey ?? '')
        .replace(/\\n/g, '\n')
        .trim();

      if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Missing project_id, client_email, or private_key in FIREBASE_SERVICE_ACCOUNT_JSON.');
      }

      return { projectId, clientEmail, privateKey };
    } catch (err) {
      throw new ServerConfigError(
        `FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ${err instanceof Error ? err.message : 'parse error'}`
      );
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  throw new ServerConfigError(
    'Firebase Admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON (or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) in Vercel environment variables.'
  );
}

function resolveFirestoreDatabaseId(): string | undefined {
  const envDbId = process.env.FIREBASE_DATABASE_ID?.trim();
  if (envDbId) {
    return envDbId === '(default)' ? undefined : envDbId;
  }

  // Fallback to non-secret database ID recorded in firebase-applet-config.json
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        firestoreDatabaseId?: string;
      };
      const id = parsed.firestoreDatabaseId?.trim();
      if (id && id !== '(default)') {
        return id;
      }
    }
  } catch {
    // Fall back to default database
  }

  return undefined;
}

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

export function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  const serviceAccount = loadServiceAccountFromEnv();
  cachedApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId,
  });
  return cachedApp;
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getFirebaseAdminApp();
  const databaseId = resolveFirestoreDatabaseId();
  cachedDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  return cachedDb;
}

export function extractBearerToken(authorizationHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Verifies a Firebase ID token (including revocation & disabled checks) and enforces
 * server-side ban blocking across ALL /api routes.
 */
export async function verifyFirebaseBearerToken(
  authorizationHeader: string | string[] | undefined,
  options: { required?: boolean; allowBanned?: boolean } = {}
): Promise<DecodedIdToken | null> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    if (options.required) {
      throw new AuthVerificationError(
        'unauthenticated',
        'Authentication required. Provide a valid Authorization: Bearer <Firebase ID token> header.'
      );
    }
    return null;
  }

  const app = getFirebaseAdminApp();
  let decoded: DecodedIdToken;
  try {
    // checkRevoked = true rejects revoked refresh tokens and disabled Auth users immediately
    decoded = await getAuth(app).verifyIdToken(token, true);
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : '';
    if (code === 'auth/user-disabled') {
      throw new AccountBannedError(
        'This account has been banned or disabled. Contact support for assistance.'
      );
    }
    if (code === 'auth/id-token-revoked') {
      throw new AuthVerificationError(
        'token_revoked',
        'Your session was signed out from another action. Please sign in again.',
        401
      );
    }
    throw new AuthVerificationError(
      'invalid_token',
      'Your session token is invalid or expired. Please sign in again.',
      401
    );
  }

  if (!options.allowBanned) {
    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userData = userSnap.data();
    if (userData?.banned === true || userData?.isDisabled === true) {
      const reason =
        typeof userData.banReason === 'string' && userData.banReason.trim()
          ? userData.banReason.trim()
          : 'Account banned due to single-device policy violation or administrator action.';
      const warnings =
        typeof userData.warningCount === 'number' && Number.isFinite(userData.warningCount)
          ? Math.max(0, Math.floor(userData.warningCount))
          : 3;
      throw new AccountBannedError(
        'This account has been banned and cannot access API services.',
        reason,
        warnings
      );
    }
  }

  return decoded;
}
