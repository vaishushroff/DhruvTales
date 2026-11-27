import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { CoinTransactionType } from '../../src/types';
import { applyCorsHeaders } from '../_lib/cors';
import {
  computeAdminWalletAdjustment,
  createEmptyWallet,
} from '../_lib/coinEngine';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import {
  isValidFirestoreDocId,
  mapFirestoreWallet,
} from '../_lib/firestoreModels';

const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';
const ALLOWED_TYPES = new Set<Extract<CoinTransactionType, 'admin_adjust' | 'bonus' | 'refund'>>([
  'admin_adjust',
  'bonus',
  'refund',
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

async function isAdminActor(uid: string, email: string | undefined): Promise<boolean> {
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true;
  const db = getAdminDb();
  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  return adminSnap.exists || userSnap.data()?.role === 'admin';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/coins/admin-adjust.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const actorUid = decoded!.uid;
    const actorEmail = decoded!.email ?? '';

    const isAdmin = await isAdminActor(actorUid, actorEmail);
    if (!isAdmin) {
      res.status(403).json({
        code: 'admin_only',
        error: 'Only Admins can adjust user coin wallets.',
      });
      return;
    }

    const body = parseBody(req);
    const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
    const txType = body.type as Extract<CoinTransactionType, 'admin_adjust' | 'bonus' | 'refund'>;
    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const episodeId =
      typeof body.episodeId === 'string' && isValidFirestoreDocId(body.episodeId)
        ? body.episodeId.trim()
        : null;
    const storyId =
      typeof body.storyId === 'string' && isValidFirestoreDocId(body.storyId)
        ? body.storyId.trim()
        : null;

    if (!isValidFirestoreDocId(targetUid)) {
      res.status(400).json({ code: 'invalid_user', error: 'Provide a valid targetUid.' });
      return;
    }
    if (!ALLOWED_TYPES.has(txType)) {
      res.status(400).json({
        code: 'invalid_type',
        error: 'type must be "admin_adjust", "bonus", or "refund".',
      });
      return;
    }

    const db = getAdminDb();
    const walletRef = db.collection('wallets').doc(targetUid);
    const nowMs = Date.now();
    const txId = `tx_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const auditId = `audit_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;

    const outcome = await db.runTransaction(async (tx) => {
      const walletDoc = await tx.get(walletRef);
      const currentWallet = walletDoc.exists
        ? mapFirestoreWallet(targetUid, walletDoc.data())
        : createEmptyWallet(targetUid, nowMs);

      const plan = computeAdminWalletAdjustment({
        wallet: currentWallet,
        type: txType,
        amount,
        note,
        txId,
        episodeId,
        storyId,
        nowMs,
      });

      if (!plan.ok || !plan.nextWallet || !plan.transaction) {
        return plan;
      }

      tx.set(walletRef, {
        uid: targetUid,
        balance: plan.nextWallet.balance,
        lifetimePurchased: plan.nextWallet.lifetimePurchased,
        lifetimeSpent: plan.nextWallet.lifetimeSpent,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('coinTransactions').doc(plan.transaction.id), {
        id: plan.transaction.id,
        uid: plan.transaction.uid,
        type: plan.transaction.type,
        amount: plan.transaction.amount,
        balanceAfter: plan.transaction.balanceAfter,
        episodeId: plan.transaction.episodeId,
        storyId: plan.transaction.storyId,
        creatorId: plan.transaction.creatorId,
        createdAt: FieldValue.serverTimestamp(),
        note: plan.transaction.note,
      });

      tx.set(db.collection('auditLogs').doc(auditId), {
        id: auditId,
        actorUid,
        actorEmail: actorEmail || `${actorUid}@dhruvtales.local`,
        action: 'wallet_admin_adjusted',
        targetCollection: 'wallets',
        targetId: targetUid,
        summary: `Admin ${txType} of ${amount > 0 ? `+${amount}` : amount} coins for ${targetUid} (new balance: ${plan.nextWallet.balance}) — ${plan.transaction.note}`.slice(0, 400),
        createdAt: FieldValue.serverTimestamp(),
      });

      return plan;
    });

    if (!outcome.ok) {
      res.status(400).json({
        code: 'invalid_adjustment',
        error: outcome.error ?? 'Unable to apply wallet adjustment.',
      });
      return;
    }

    res.status(200).json({
      wallet: outcome.nextWallet,
      transaction: outcome.transaction,
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
    console.error('[api/coins/admin-adjust] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to adjust user coin wallet right now.',
    });
  }
}
