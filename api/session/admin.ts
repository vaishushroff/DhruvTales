import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { AdminSessionActionType } from '../../src/types';
import {
  AuthVerificationError,
  getAdminAuth,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { isValidFirestoreDocId, mapFirestoreActiveDevice } from '../_lib/firestoreModels';
import { applyCorsHeaders } from '../_lib/cors';
import { verifyAdminActor } from '../_lib/adminAuth';
import { evaluateAdminSessionAction } from '../_lib/sessionEngine';
const ALLOWED_ACTIONS = new Set<AdminSessionActionType>([
  'ban',
  'unban',
  'reset_warnings',
  'force_logout',
]);

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
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/session/admin.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const actorUid = decoded!.uid;
    const actorEmail = decoded!.email ?? `${actorUid}@dhruvtales.local`;

    const adminAccess = await verifyAdminActor(decoded!);
    if (!adminAccess.allowed) {
      res.status(403).json({
        code: 'admin_only',
        error: 'Only Administrators can manage user bans, warnings, and device sessions.',
      });
      return;
    }

    const body = parseBody(req);
    const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
    const action = body.action as AdminSessionActionType;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const warningCountOverride =
      typeof body.warningCount === 'number' ? body.warningCount : undefined;

    if (!isValidFirestoreDocId(targetUid)) {
      res.status(400).json({ code: 'invalid_user', error: 'Provide a valid targetUid.' });
      return;
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      res.status(400).json({
        code: 'invalid_action',
        error: 'action must be "ban", "unban", "reset_warnings", or "force_logout".',
      });
      return;
    }

    const db = getAdminDb();
    const targetRef = db.collection('users').doc(targetUid);
    const nowMs = Date.now();
    const sessionLogId = `sess_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const auditLogId = `audit_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;

    const plan = await db.runTransaction(async (tx) => {
      const targetSnap = await tx.get(targetRef);
      if (!targetSnap.exists) {
        return { notFound: true as const };
      }

      const data = targetSnap.data()!;
      const targetLabel = String(data.email || data.phoneNumber || data.displayName || targetUid);

      const evaluated = evaluateAdminSessionAction({
        actorUid,
        targetUid,
        targetLabel,
        action,
        warningCountOverride,
        reason,
        userState: {
          uid: targetUid,
          activeDevice: mapFirestoreActiveDevice(data.activeDevice) ?? null,
          warningCount:
            typeof data.warningCount === 'number' && Number.isFinite(data.warningCount)
              ? Math.max(0, Math.floor(data.warningCount))
              : 0,
          banned: Boolean(data.banned),
          banReason: typeof data.banReason === 'string' ? data.banReason : null,
        },
        sessionLogId,
        nowMs,
      });

      if (!evaluated.ok) {
        return { notFound: false as const, plan: evaluated };
      }

      const updatePayload: Record<string, unknown> = {
        banned: evaluated.nextBanned,
        isDisabled: evaluated.nextIsDisabled,
        warningCount: evaluated.nextWarningCount,
        banReason: evaluated.nextBanReason ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (action === 'ban') {
        updatePayload.bannedAt = FieldValue.serverTimestamp();
      } else if (action === 'unban') {
        updatePayload.bannedAt = null;
      }
      if (evaluated.clearActiveDevice) {
        updatePayload.activeDevice = null;
      }

      tx.update(targetRef, updatePayload);

      if (evaluated.sessionLog) {
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
      }

      if (evaluated.auditAction && evaluated.auditSummary) {
        tx.set(db.collection('auditLogs').doc(auditLogId), {
          id: auditLogId,
          actorUid,
          actorEmail,
          action: evaluated.auditAction,
          targetCollection: 'users',
          targetId: targetUid,
          summary: evaluated.auditSummary,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return { notFound: false as const, plan: evaluated };
    });

    if (plan.notFound) {
      res.status(404).json({ code: 'user_not_found', error: 'User profile not found.' });
      return;
    }

    if (!plan.plan.ok) {
      res.status(400).json({ code: 'invalid_request', error: plan.plan.error });
      return;
    }

    // Apply Firebase Admin Auth disable / enable / token revocation
    const adminAuth = getAdminAuth();
    if (plan.plan.authAction === 'disable_and_revoke') {
      await Promise.all([
        adminAuth.updateUser(targetUid, { disabled: true }),
        adminAuth.revokeRefreshTokens(targetUid),
      ]);
    } else if (plan.plan.authAction === 'enable') {
      await adminAuth.updateUser(targetUid, { disabled: false });
    } else if (plan.plan.authAction === 'revoke_only') {
      await adminAuth.revokeRefreshTokens(targetUid);
    }

    res.status(200).json({
      ok: true,
      action,
      targetUid,
      banned: plan.plan.nextBanned,
      warningCount: plan.plan.nextWarningCount,
      clearedActiveDevice: Boolean(plan.plan.clearActiveDevice),
      summary: plan.plan.auditSummary,
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
    console.error('[api/session/admin] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to apply admin session action right now.',
    });
  }
}
