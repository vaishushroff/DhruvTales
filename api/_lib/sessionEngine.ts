import type {
  ActiveDeviceSession,
  AdminSessionActionType,
  AuditActionType,
  DeviceInfo,
  SessionLogEntry,
} from '../../src/types';

export const MAX_DEVICE_WARNINGS = 3;
export const SUPPORT_CONTACT_PLACEHOLDER = 'support@dhruvtales.example';

const DEVICE_ID_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

export interface UserSessionState {
  uid: string;
  activeDevice: ActiveDeviceSession | null;
  warningCount: number;
  banned: boolean;
  banReason?: string | null;
}

export function sanitizeDeviceId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DEVICE_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeDeviceInfo(raw: unknown): DeviceInfo {
  if (!raw || typeof raw !== 'object') {
    return { label: 'Unknown Browser' };
  }
  const obj = raw as Record<string, unknown>;
  const label =
    typeof obj.label === 'string' && obj.label.trim()
      ? obj.label.trim().slice(0, 100)
      : 'Web Browser';
  const platform =
    typeof obj.platform === 'string' && obj.platform.trim()
      ? obj.platform.trim().slice(0, 60)
      : undefined;
  const userAgent =
    typeof obj.userAgent === 'string' && obj.userAgent.trim()
      ? obj.userAgent.trim().slice(0, 220)
      : undefined;

  return {
    label,
    ...(platform ? { platform } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

export type SessionRegisterPlan =
  | {
      status: 'already_banned';
      warningCount: number;
      banned: true;
      banReason: string;
    }
  | {
      status: 'active';
      activeDevice: ActiveDeviceSession;
      warningCount: number;
      banned: false;
      sessionLog: SessionLogEntry;
    }
  | {
      status: 'violation_warning';
      warningCount: number;
      maxWarnings: number;
      banned: false;
      activeDeviceLabel: string;
      message: string;
      sessionLog: SessionLogEntry;
    }
  | {
      status: 'violation_ban';
      warningCount: number;
      maxWarnings: number;
      banned: true;
      banReason: string;
      message: string;
      shouldDisableAuth: true;
      shouldRevokeTokens: true;
      sessionLog: SessionLogEntry;
    };

/**
 * Pure single-device enforcement state machine.
 * - One activeDevice per user account across all sign-in methods (Google, Email, Phone).
 * - If another device is already active: reject the new device, increment warningCount,
 *   and keep the original activeDevice untouched.
 * - At 3 warnings: set banned = true, clear activeDevice, disable Firebase Auth user,
 *   and revoke refresh tokens.
 */
export function evaluateSessionRegister(params: {
  userState: UserSessionState;
  deviceId: string;
  deviceInfo: DeviceInfo;
  sessionLogId: string;
  nowMs?: number;
}): SessionRegisterPlan {
  const nowMs = params.nowMs ?? Date.now();
  const currentWarnings = Math.max(0, Math.floor(params.userState.warningCount || 0));

  if (params.userState.banned) {
    return {
      status: 'already_banned',
      warningCount: currentWarnings,
      banned: true,
      banReason:
        params.userState.banReason?.trim() ||
        'Account banned due to repeated concurrent device login violations.',
    };
  }

  const existingActive = params.userState.activeDevice;

  // Case 1: No active device or same device refreshing its session
  if (!existingActive || existingActive.deviceId === params.deviceId) {
    const nextActive: ActiveDeviceSession = {
      deviceId: params.deviceId,
      deviceInfo: params.deviceInfo,
      registeredAt: existingActive?.registeredAt ?? nowMs,
      lastSeen: nowMs,
    };

    return {
      status: 'active',
      activeDevice: nextActive,
      warningCount: currentWarnings,
      banned: false,
      sessionLog: {
        id: params.sessionLogId,
        uid: params.userState.uid,
        deviceId: params.deviceId,
        deviceInfo: params.deviceInfo,
        eventType: 'login_registered',
        warningCountAfter: currentWarnings,
        bannedAfter: false,
        note: existingActive
          ? `Refreshed active session on ${params.deviceInfo.label}`
          : `Registered active device: ${params.deviceInfo.label}`,
        createdAt: nowMs,
      },
    };
  }

  // Case 2: Different device while another device is active -> flag violation
  const nextWarnings = currentWarnings + 1;
  const activeDeviceLabel = existingActive.deviceInfo?.label || 'another device';

  if (nextWarnings >= MAX_DEVICE_WARNINGS) {
    const banReason = `Account banned after reaching ${nextWarnings} of ${MAX_DEVICE_WARNINGS} concurrent device warnings.`;
    return {
      status: 'violation_ban',
      warningCount: nextWarnings,
      maxWarnings: MAX_DEVICE_WARNINGS,
      banned: true,
      banReason,
      message: `Warning ${nextWarnings} of ${MAX_DEVICE_WARNINGS}: this account has been banned for concurrent device logins.`,
      shouldDisableAuth: true,
      shouldRevokeTokens: true,
      sessionLog: {
        id: params.sessionLogId,
        uid: params.userState.uid,
        deviceId: params.deviceId,
        deviceInfo: params.deviceInfo,
        eventType: 'violation_ban',
        warningCountAfter: nextWarnings,
        bannedAfter: true,
        note: `Strike ${nextWarnings}/${MAX_DEVICE_WARNINGS}: login from ${params.deviceInfo.label} conflicted with active ${activeDeviceLabel}. Account banned & tokens revoked.`,
        createdAt: nowMs,
      },
    };
  }

  return {
    status: 'violation_warning',
    warningCount: nextWarnings,
    maxWarnings: MAX_DEVICE_WARNINGS,
    banned: false,
    activeDeviceLabel,
    message: `Warning ${nextWarnings} of ${MAX_DEVICE_WARNINGS}: this account is already in use on another device`,
    sessionLog: {
      id: params.sessionLogId,
      uid: params.userState.uid,
      deviceId: params.deviceId,
      deviceInfo: params.deviceInfo,
      eventType: 'violation_warning',
      warningCountAfter: nextWarnings,
      bannedAfter: false,
      note: `Warning ${nextWarnings}/${MAX_DEVICE_WARNINGS}: blocked concurrent login from ${params.deviceInfo.label} while ${activeDeviceLabel} is active.`,
      createdAt: nowMs,
    },
  };
}

export interface SessionLogoutPlan {
  clearedActiveDevice: boolean;
  sessionLog: SessionLogEntry;
}

/**
 * Releases `activeDevice` only when the logging-out client owns the current active session.
 * Prevents an unauthorized/conflicting second device from clearing the active device on forced sign-out.
 */
export function evaluateSessionLogout(params: {
  userState: UserSessionState;
  deviceId: string | null;
  sessionLogId: string;
  nowMs?: number;
}): SessionLogoutPlan {
  const nowMs = params.nowMs ?? Date.now();
  const currentWarnings = Math.max(0, Math.floor(params.userState.warningCount || 0));
  const matchesActive = Boolean(
    params.deviceId &&
      params.userState.activeDevice &&
      params.userState.activeDevice.deviceId === params.deviceId
  );

  return {
    clearedActiveDevice: matchesActive,
    sessionLog: {
      id: params.sessionLogId,
      uid: params.userState.uid,
      deviceId: params.deviceId,
      deviceInfo: matchesActive ? params.userState.activeDevice?.deviceInfo ?? null : null,
      eventType: 'logout',
      warningCountAfter: currentWarnings,
      bannedAfter: params.userState.banned,
      note: matchesActive
        ? 'Signed out cleanly and released active device lock.'
        : 'Sign-out recorded (device was not the active session).',
      createdAt: nowMs,
    },
  };
}

export interface AdminSessionMutationPlan {
  ok: boolean;
  error?: string;
  nextBanned?: boolean;
  nextIsDisabled?: boolean;
  nextWarningCount?: number;
  nextBanReason?: string | null;
  clearActiveDevice?: boolean;
  authAction?: 'disable_and_revoke' | 'enable' | 'revoke_only' | 'none';
  auditAction?: AuditActionType;
  auditSummary?: string;
  sessionLog?: SessionLogEntry;
}

/**
 * Pure evaluator for Admin session moderation actions:
 * - ban: bans account, clears activeDevice, disables Firebase Auth user + revokes refresh tokens
 * - unban: restores account, re-enables Firebase Auth user, resets warningCount to chosen integer (default 0)
 * - reset_warnings: sets warningCount = 0
 * - force_logout: clears activeDevice and revokes refresh tokens
 */
export function evaluateAdminSessionAction(params: {
  actorUid: string;
  targetUid: string;
  targetLabel: string;
  action: AdminSessionActionType;
  warningCountOverride?: number;
  reason?: string;
  userState: UserSessionState;
  sessionLogId: string;
  nowMs?: number;
}): AdminSessionMutationPlan {
  const nowMs = params.nowMs ?? Date.now();
  const currentWarnings = Math.max(0, Math.floor(params.userState.warningCount || 0));
  const safeReason = (params.reason ?? '').trim().slice(0, 240);

  if (
    params.actorUid === params.targetUid &&
    (params.action === 'ban' || params.action === 'force_logout')
  ) {
    return {
      ok: false,
      error: 'Administrators cannot ban or force-logout their own account.',
    };
  }

  if (params.action === 'ban') {
    const banReason = safeReason || 'Banned by an administrator.';
    return {
      ok: true,
      nextBanned: true,
      nextIsDisabled: true,
      nextWarningCount: Math.max(currentWarnings, MAX_DEVICE_WARNINGS),
      nextBanReason: banReason,
      clearActiveDevice: true,
      authAction: 'disable_and_revoke',
      auditAction: 'user_ban',
      auditSummary: `Banned ${params.targetLabel} (${banReason})`.slice(0, 400),
      sessionLog: {
        id: params.sessionLogId,
        uid: params.targetUid,
        deviceId: null,
        deviceInfo: null,
        eventType: 'admin_ban',
        warningCountAfter: Math.max(currentWarnings, MAX_DEVICE_WARNINGS),
        bannedAfter: true,
        note: `Admin banned user: ${banReason}`,
        createdAt: nowMs,
      },
    };
  }

  if (params.action === 'unban') {
    const rawOverride = params.warningCountOverride ?? 0;
    if (
      typeof rawOverride !== 'number' ||
      !Number.isFinite(rawOverride) ||
      !Number.isInteger(rawOverride) ||
      rawOverride < 0 ||
      rawOverride >= MAX_DEVICE_WARNINGS
    ) {
      return {
        ok: false,
        error: `Warning count after unban must be an integer between 0 and ${MAX_DEVICE_WARNINGS - 1}.`,
      };
    }

    return {
      ok: true,
      nextBanned: false,
      nextIsDisabled: false,
      nextWarningCount: rawOverride,
      nextBanReason: null,
      clearActiveDevice: false,
      authAction: 'enable',
      auditAction: 'user_unban',
      auditSummary: `Unbanned ${params.targetLabel} and set warnings to ${rawOverride}${safeReason ? ` (${safeReason})` : ''}`.slice(0, 400),
      sessionLog: {
        id: params.sessionLogId,
        uid: params.targetUid,
        deviceId: null,
        deviceInfo: null,
        eventType: 'admin_unban',
        warningCountAfter: rawOverride,
        bannedAfter: false,
        note: `Admin unbanned user and set warningCount=${rawOverride}${safeReason ? ` (${safeReason})` : ''}`,
        createdAt: nowMs,
      },
    };
  }

  if (params.action === 'reset_warnings') {
    return {
      ok: true,
      nextBanned: params.userState.banned,
      nextIsDisabled: params.userState.banned,
      nextWarningCount: 0,
      nextBanReason: params.userState.banReason ?? null,
      clearActiveDevice: false,
      authAction: 'none',
      auditAction: 'user_warnings_reset',
      auditSummary: `Reset device warnings for ${params.targetLabel} from ${currentWarnings} to 0`,
      sessionLog: {
        id: params.sessionLogId,
        uid: params.targetUid,
        deviceId: null,
        deviceInfo: null,
        eventType: 'admin_reset_warnings',
        warningCountAfter: 0,
        bannedAfter: params.userState.banned,
        note: `Admin reset warningCount from ${currentWarnings} to 0.`,
        createdAt: nowMs,
      },
    };
  }

  if (params.action === 'force_logout') {
    return {
      ok: true,
      nextBanned: params.userState.banned,
      nextIsDisabled: params.userState.banned,
      nextWarningCount: currentWarnings,
      nextBanReason: params.userState.banReason ?? null,
      clearActiveDevice: true,
      authAction: 'revoke_only',
      auditAction: 'user_force_logout',
      auditSummary: `Force-logged out ${params.targetLabel} (cleared active device and revoked tokens)`,
      sessionLog: {
        id: params.sessionLogId,
        uid: params.targetUid,
        deviceId: params.userState.activeDevice?.deviceId ?? null,
        deviceInfo: params.userState.activeDevice?.deviceInfo ?? null,
        eventType: 'admin_force_logout',
        warningCountAfter: currentWarnings,
        bannedAfter: params.userState.banned,
        note: 'Admin force-logged out active device and revoked refresh tokens.',
        createdAt: nowMs,
      },
    };
  }

  return { ok: false, error: 'Unsupported admin session action.' };
}

/**
 * Builds the exact Firestore `users/{uid}` update payload for an evaluated admin
 * session action so both server-side Admin SDK and client-side Firestore Admin
 * fallback write identical, schema-valid fields allowed by `firestore.rules`.
 */
export function buildAdminSessionFirestoreUpdate<TTimestamp>(
  action: AdminSessionActionType,
  evaluated: AdminSessionMutationPlan,
  timestampValue: TTimestamp
): Record<string, unknown> {
  const updatePayload: Record<string, unknown> = {
    banned: Boolean(evaluated.nextBanned),
    isDisabled: Boolean(evaluated.nextIsDisabled),
    warningCount: Math.max(0, Math.min(100, Math.floor(evaluated.nextWarningCount ?? 0))),
    banReason:
      typeof evaluated.nextBanReason === 'string' && evaluated.nextBanReason.trim()
        ? evaluated.nextBanReason.trim().slice(0, 300)
        : null,
    updatedAt: timestampValue,
  };

  if (action === 'ban') {
    updatePayload.bannedAt = timestampValue;
  } else if (action === 'unban') {
    updatePayload.bannedAt = null;
  }

  if (evaluated.clearActiveDevice) {
    updatePayload.activeDevice = null;
  }

  return updatePayload;
}
