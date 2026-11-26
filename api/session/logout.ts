import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { mapFirestoreActiveDevice } from '../_lib/firestoreModels';
import { evaluateSessionLogout, sanitizeDeviceId } from '../_lib/sessionEngine';

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
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/session/logout.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;
    const body = parseBody(req);
    const deviceId = sanitizeDeviceId(body.deviceId);

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const nowMs = Date.now();
    const sessionLogId = `sess_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;

    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const data = userSnap.data() ?? {};
      const plan = evaluateSessionLogout({
        userState: {
          uid,
          activeDevice: mapFirestoreActiveDevice(data.activeDevice) ?? null,
          warningCount:
            typeof data.warningCount === 'number' && Number.isFinite(data.warningCount)
              ? Math.max(0, Math.floor(data.warningCount))
              : 0,
          banned: Boolean(data.banned),
        },
        deviceId,
        sessionLogId,
        nowMs,
      });

      if (plan.clearedActiveDevice && userSnap.exists) {
        tx.update(userRef, {
          activeDevice: null,
          lastSeen: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(db.collection('sessions').doc(plan.sessionLog.id), {
        id: plan.sessionLog.id,
        uid: plan.sessionLog.uid,
        deviceId: plan.sessionLog.deviceId,
        deviceInfo: plan.sessionLog.deviceInfo ?? null,
        eventType: plan.sessionLog.eventType,
        warningCountAfter: plan.sessionLog.warningCountAfter,
        bannedAfter: plan.sessionLog.bannedAfter,
        note: plan.sessionLog.note,
        createdAt: FieldValue.serverTimestamp(),
      });

      return plan;
    });

    res.status(200).json({
      loggedOut: true,
      clearedActiveDevice: result.clearedActiveDevice,
    });
  } catch (err) {
    if (err instanceof AuthVerificationError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/session/logout] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to sign out device session right now.',
    });
  }
}
