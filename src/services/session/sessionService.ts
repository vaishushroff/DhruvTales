import type { User } from 'firebase/auth';
import type {
  ActiveDeviceSession,
  AdminSessionActionType,
  DeviceInfo,
} from '../../types';

const DEVICE_ID_STORAGE_KEY = 'dhruv_tales_device_id_v1';
const PENDING_WARNING_KEY = 'dhruv_tales_device_warning_v1';
const PENDING_BAN_KEY = 'dhruv_tales_account_banned_v1';

export const DEFAULT_SUPPORT_CONTACT = 'support@dhruvtales.example';

export interface DeviceWarningNotice {
  warningCount: number;
  maxWarnings: number;
  activeDeviceLabel?: string;
  message: string;
  occurredAt: number;
}

export interface AccountBanNotice {
  warningCount: number;
  banReason: string;
  supportContact: string;
  occurredAt: number;
}

export type RegisterSessionClientResult =
  | {
      status: 'active';
      activeDevice: ActiveDeviceSession;
      warningCount: number;
    }
  | {
      status: 'violation_warning';
      warningCount: number;
      maxWarnings: number;
      activeDeviceLabel?: string;
      message: string;
    }
  | {
      status: 'banned';
      warningCount: number;
      banReason: string;
      supportContact: string;
      message: string;
    }
  | {
      status: 'token_revoked';
      message: string;
    }
  | {
      status: 'api_unavailable';
    };

function generateRandomDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `dev_${crypto.randomUUID().replace(/-/g, '')}`;
    }
  } catch {
    // fallback below
  }
  const rand = Math.random().toString(36).slice(2, 14);
  const ts = Date.now().toString(36);
  return `dev_${ts}_${rand}`;
}

/**
 * Returns the persistent browser-local deviceId (stored in localStorage).
 * Note: This is browser-based identification and resets if site storage is cleared.
 */
export function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) {
      return existing;
    }
    const created = generateRandomDeviceId();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateRandomDeviceId();
  }
}

export function getClientDeviceInfo(): DeviceInfo {
  if (typeof navigator === 'undefined') {
    return { label: 'Web Browser' };
  }
  const ua = navigator.userAgent || '';
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = platform || 'Device';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return {
    label: `${browser} on ${os}`.slice(0, 100),
    platform: os.slice(0, 60),
    userAgent: ua.slice(0, 220),
  };
}

export function savePendingDeviceWarning(notice: DeviceWarningNotice | null): void {
  try {
    if (!notice) {
      sessionStorage.removeItem(PENDING_WARNING_KEY);
    } else {
      sessionStorage.setItem(PENDING_WARNING_KEY, JSON.stringify(notice));
    }
  } catch {
    // ignore storage errors
  }
}

export function loadPendingDeviceWarning(): DeviceWarningNotice | null {
  try {
    const raw = sessionStorage.getItem(PENDING_WARNING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceWarningNotice>;
    if (typeof parsed.warningCount === 'number' && typeof parsed.message === 'string') {
      return {
        warningCount: parsed.warningCount,
        maxWarnings: typeof parsed.maxWarnings === 'number' ? parsed.maxWarnings : 3,
        activeDeviceLabel: parsed.activeDeviceLabel,
        message: parsed.message,
        occurredAt: typeof parsed.occurredAt === 'number' ? parsed.occurredAt : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePendingBanNotice(notice: AccountBanNotice | null): void {
  try {
    if (!notice) {
      sessionStorage.removeItem(PENDING_BAN_KEY);
    } else {
      sessionStorage.setItem(PENDING_BAN_KEY, JSON.stringify(notice));
    }
  } catch {
    // ignore storage errors
  }
}

export function loadPendingBanNotice(): AccountBanNotice | null {
  try {
    const raw = sessionStorage.getItem(PENDING_BAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountBanNotice>;
    if (typeof parsed.banReason === 'string') {
      return {
        warningCount: typeof parsed.warningCount === 'number' ? parsed.warningCount : 3,
        banReason: parsed.banReason,
        supportContact:
          typeof parsed.supportContact === 'string' && parsed.supportContact
            ? parsed.supportContact
            : DEFAULT_SUPPORT_CONTACT,
        occurredAt: typeof parsed.occurredAt === 'number' ? parsed.occurredAt : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSessionJson(
  url: string,
  init: RequestInit
): Promise<{ available: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return { available: false, status: response.status, data: {} };
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (response.status === 503 && data.code === 'server_not_configured') {
      return { available: false, status: response.status, data };
    }
    return { available: true, status: response.status, data };
  } catch {
    return { available: false, status: 0, data: {} };
  }
}

/**
 * Calls POST /api/session/register after login (Google, Email, or Phone).
 * Enforces one active device per user account server-side via Firebase Admin SDK.
 */
export async function registerDeviceSession(user: User): Promise<RegisterSessionClientResult> {
  const idToken = await user.getIdToken();
  const deviceId = getOrCreateDeviceId();
  const deviceInfo = getClientDeviceInfo();

  const api = await fetchSessionJson('/api/session/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ deviceId, deviceInfo }),
  });

  if (!api.available) {
    return { status: 'api_unavailable' };
  }

  if (api.status === 409 && api.data.code === 'device_conflict') {
    const warningCount = Number(api.data.warningCount ?? 1);
    const maxWarnings = Number(api.data.maxWarnings ?? 3);
    return {
      status: 'violation_warning',
      warningCount,
      maxWarnings,
      activeDeviceLabel:
        typeof api.data.activeDeviceLabel === 'string' ? api.data.activeDeviceLabel : undefined,
      message: String(
        api.data.message ??
          `Warning ${warningCount} of ${maxWarnings}: this account is already in use on another device`
      ),
    };
  }

  if (api.status === 403 && (api.data.code === 'account_banned' || api.data.banned === true)) {
    return {
      status: 'banned',
      warningCount: Number(api.data.warningCount ?? 3),
      banReason: String(
        api.data.banReason ??
          api.data.error ??
          'Account banned after exceeding 3 concurrent device warnings.'
      ),
      supportContact: String(api.data.supportContact ?? DEFAULT_SUPPORT_CONTACT),
      message: String(api.data.message ?? api.data.error ?? 'This account has been banned.'),
    };
  }

  if (api.status === 401 && api.data.code === 'token_revoked') {
    return {
      status: 'token_revoked',
      message: String(api.data.error ?? 'Your session was signed out. Please sign in again.'),
    };
  }

  if (api.status === 200 && api.data.status === 'active') {
    return {
      status: 'active',
      activeDevice: api.data.activeDevice as ActiveDeviceSession,
      warningCount: Number(api.data.warningCount ?? 0),
    };
  }

  return { status: 'api_unavailable' };
}

/**
 * Releases this browser's activeDevice lock on voluntary sign-out via POST /api/session/logout.
 */
export async function logoutDeviceSession(user: User | null): Promise<void> {
  if (!user) return;
  try {
    const idToken = await user.getIdToken();
    const deviceId = getOrCreateDeviceId();
    await fetchSessionJson('/api/session/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ deviceId }),
    });
  } catch {
    // Non-blocking: local sign-out still proceeds cleanly
  }
}

export interface AdminSessionApiResult {
  usedServerApi: boolean;
  ok: boolean;
  summary?: string;
  error?: string;
}

/**
 * Executes an Admin session action (ban, unban, reset_warnings, force_logout) via POST /api/session/admin.
 */
export async function runAdminSessionActionApi(
  adminUser: User,
  payload: {
    targetUid: string;
    action: AdminSessionActionType;
    warningCount?: number;
    reason?: string;
  }
): Promise<AdminSessionApiResult> {
  const idToken = await adminUser.getIdToken();
  const api = await fetchSessionJson('/api/session/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!api.available) {
    return { usedServerApi: false, ok: false };
  }

  if (api.status !== 200) {
    throw new Error(String(api.data.error ?? 'Unable to apply admin session action.'));
  }

  return {
    usedServerApi: true,
    ok: true,
    summary: String(api.data.summary ?? 'Action applied.'),
  };
}
