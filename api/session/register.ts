import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  AccountBannedError,
  AuthVerificationError,
  getAdminAuth,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { applyCorsHeaders } from '../_lib/cors';
import { mapFirestoreActiveDevice } from '../_lib/firestoreModels';
import {
  evaluateSessionRegister,
  sanitizeDeviceId,
  sanitizeDeviceInfo,
  SUPPORT_CONTACT_PLACEHOLDER,
} from '../_lib/sessionEngine';

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return req.body as Record<string, unknown>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/session/register.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;

    const body = parseBody(req);
    const deviceId = sanitizeDeviceId(body.deviceId);
    if (!deviceId) {
      res.status(400).json({
        code: 'invalid_device_id',
        error: 'Provide a valid deviceId (8-128 alphanumeric, underscore, or hyphen characters).',
      });
      return;
    }

    const deviceInfo = sanitizeDeviceInfo(body.deviceInfo);
    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const nowMs = Date.now();
    const sessionLogId = `sess_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;

    const plan = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const existingData = userSnap.data() ?? {};

      const currentState = {
        uid,
        activeDevice: mapFirestoreActiveDevice(existingData.activeDevice) ?? null,
        warningCount:
          typeof existingData.warningCount === 'number' && Number.isFinite(existingData.warningCount)
            ? Math.max(0, Math.floor(existingData.warningCount))
            : 0,
        banned: Boolean(existingData.banned),
        banReason: typeof existingData.banReason === 'string' ? existingData.banReason : null,
      };

      const evaluated = evaluateSessionRegister({
        userState: currentState,
        deviceId,
        deviceInfo,
        sessionLogId,
        nowMs,
      });

      if (evaluated.status === 'already_banned') {
        return evaluated;
      }

      const fallbackEmail = (decoded?.email ?? '').trim().slice(0, 200);
      const fallbackPhone = (decoded?.phone_number ?? '').trim().slice(0, 32);
      const fallbackName =
        (decoded?.name ?? fallbackEmail.split('@')[0] ?? fallbackPhone ?? 'Listener')
          .trim()
          .slice(0, 80) || 'Listener';
      const fallbackInitials = fallbackName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? '')
        .join('') || 'DT';

      // Ensure base profile fields exist if this is the very first write for a new Auth user
      const ensureBaseFields = userSnap.exists
        ? {}
        : {
            uid,
            email: fallbackEmail,
            ...(fallbackPhone ? { phoneNumber: fallbackPhone } : {}),
            displayName: fallbackName,
            bio: '',
            preferredLanguage: 'en',
            preferredFormat: 'audio',
            role: 'user',
            isDisabled: false,
            avatarInitials: fallbackInitials,
            createdAt: FieldValue.serverTimestamp(),
          };

      if (evaluated.status === 'active') {
        tx.set(
          userRef,
          {
            ...ensureBaseFields,
            activeDevice: {
              deviceId: evaluated.activeDevice.deviceId,
              deviceInfo: evaluated.activeDevice.deviceInfo,
              registeredAt: Timestamp.fromMillis(evaluated.activeDevice.registeredAt),
              lastSeen: FieldValue.serverTimestamp(),
            },
            lastSeen: FieldValue.serverTimestamp(),
            warningCount: evaluated.warningCount,
            banned: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else if (evaluated.status === 'violation_warning') {
        tx.set(
          userRef,
          {
            ...ensureBaseFields,
            warningCount: evaluated.warningCount,
            banned: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else if (evaluated.status === 'violation_ban') {
        tx.set(
          userRef,
          {
            ...ensureBaseFields,
            warningCount: evaluated.warningCount,
            banned: true,
            isDisabled: true,
            bannedAt: FieldValue.serverTimestamp(),
            banReason: evaluated.banReason,
            activeDevice: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      tx.set(db.collection('sessions').doc(evaluated.sessionLog.id), {
        id: evaluated.sessionLog.id,
        uid: evaluated.sessionLog.uid,
        deviceId: evaluated.sessionLog.deviceId,
        deviceInfo: evaluated.sessionLog.deviceInfo ?? null,
        eventType: evaluated.sessionLog.eventType,
        warningCountAfter: evaluated.sessionLog.warningCountAfter,
        bannedAfter: evaluated.sessionLog.bannedAfter,
        note: evaluated.sessionLog.note,
        createdAt: FieldValue.serverTimestamp(),
      });

      return evaluated;
    });

    if (plan.status === 'already_banned') {
      res.status(403).json({
        status: 'banned',
        code: 'account_banned',
        banned: true,
        warningCount: plan.warningCount,
        banReason: plan.banReason,
        supportContact: SUPPORT_CONTACT_PLACEHOLDER,
        error: 'This account has been banned.',
      });
      return;
    }

    if (plan.status === 'violation_ban') {
      // Enforce Firebase Auth disable + token revocation immediately via Firebase Admin
      const adminAuth = getAdminAuth();
      await Promise.all([
        adminAuth.updateUser(uid, { disabled: true }),
        adminAuth.revokeRefreshTokens(uid),
      ]);

      res.status(403).json({
        status: 'banned',
        code: 'account_banned',
        banned: true,
        warningCount: plan.warningCount,
        maxWarnings: plan.maxWarnings,
        banReason: plan.banReason,
        supportContact: SUPPORT_CONTACT_PLACEHOLDER,
        message: plan.message,
        error: plan.message,
      });
      return;
    }

    if (plan.status === 'violation_warning') {
      res.status(409).json({
        status: 'violation_warning',
        code: 'device_conflict',
        banned: false,
        warningCount: plan.warningCount,
        maxWarnings: plan.maxWarnings,
        activeDeviceLabel: plan.activeDeviceLabel,
        message: plan.message,
        error: plan.message,
      });
      return;
    }

    res.status(200).json({
      status: 'active',
      banned: false,
      warningCount: plan.warningCount,
      activeDevice: plan.activeDevice,
    });
  } catch (err) {
    if (err instanceof AccountBannedError) {
      res.status(403).json({
        status: 'banned',
        code: err.code,
        banned: true,
        warningCount: err.warningCount,
        banReason: err.banReason,
        supportContact: SUPPORT_CONTACT_PLACEHOLDER,
        error: err.message,
      });
      return;
    }
    if (err instanceof AuthVerificationError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/session/register] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to register device session right now.',
    });
  }
}
