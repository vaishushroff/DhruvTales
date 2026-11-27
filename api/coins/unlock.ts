import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { applyCorsHeaders } from '../_lib/cors';
import {
  buildEpisodeUnlockDocId,
  computeEpisodeUnlockMutation,
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
  mapFirestoreEpisode,
  mapFirestoreEpisodeUnlock,
  mapFirestoreStorySummary,
  mapFirestoreWallet,
} from '../_lib/firestoreModels';

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
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/coins/unlock.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;

    const body = parseBody(req);
    const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
    if (!isValidFirestoreDocId(episodeId)) {
      res.status(400).json({ code: 'invalid_episode', error: 'Provide a valid episodeId.' });
      return;
    }

    const db = getAdminDb();
    const episodeRef = db.collection('episodes').doc(episodeId);
    const unlockDocId = buildEpisodeUnlockDocId(uid, episodeId);
    const unlockRef = db.collection('episodeUnlocks').doc(unlockDocId);
    const walletRef = db.collection('wallets').doc(uid);
    const nowMs = Date.now();
    const txId = `tx_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;

    const outcome = await db.runTransaction(async (tx) => {
      const episodeSnap = await tx.get(episodeRef);
      if (!episodeSnap.exists) {
        return { kind: 'not_found' as const };
      }

      const episode = mapFirestoreEpisode(episodeSnap.id, episodeSnap.data()!);
      const storyRef = db.collection('stories').doc(episode.storyId);

      const [storySnap, unlockSnap, walletSnap] = await Promise.all([
        tx.get(storyRef),
        tx.get(unlockRef),
        tx.get(walletRef),
      ]);

      const story = storySnap.exists
        ? mapFirestoreStorySummary(storySnap.id, storySnap.data())
        : null;
      const existingUnlock = unlockSnap.exists
        ? mapFirestoreEpisodeUnlock(unlockSnap.id, unlockSnap.data()!)
        : null;
      const currentWallet = walletSnap.exists
        ? mapFirestoreWallet(uid, walletSnap.data())
        : createEmptyWallet(uid, nowMs);

      const plan = computeEpisodeUnlockMutation({
        wallet: currentWallet,
        episode,
        story,
        existingUnlock,
        txId,
        nowMs,
      });

      if (plan.status === 'unlocked') {
        tx.set(walletRef, {
          uid,
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

        tx.set(unlockRef, {
          id: plan.unlock.id,
          uid: plan.unlock.uid,
          episodeId: plan.unlock.episodeId,
          storyId: plan.unlock.storyId,
          creatorId: plan.unlock.creatorId,
          pricePaidCoins: plan.unlock.pricePaidCoins,
          transactionId: plan.unlock.transactionId,
          unlockedAt: FieldValue.serverTimestamp(),
        });
      }

      return { kind: 'computed' as const, plan };
    });

    if (outcome.kind === 'not_found') {
      res.status(404).json({ code: 'episode_not_found', error: 'Episode not found.' });
      return;
    }

    const { plan } = outcome;
    if (plan.status === 'free_episode') {
      res.status(200).json({
        unlocked: true,
        alreadyUnlocked: false,
        freeEpisode: true,
        effectivePrice: 0,
        wallet: plan.wallet,
      });
      return;
    }

    if (plan.status === 'already_unlocked') {
      res.status(200).json({
        unlocked: true,
        alreadyUnlocked: true,
        effectivePrice: plan.effectivePrice,
        wallet: plan.wallet,
        unlock: plan.unlock,
      });
      return;
    }

    if (plan.status === 'insufficient_balance') {
      res.status(402).json({
        code: 'insufficient_balance',
        error: `You need ${plan.effectivePrice} coins to unlock this episode (short by ${plan.shortfall} coins).`,
        effectivePrice: plan.effectivePrice,
        currentBalance: plan.currentBalance,
        shortfall: plan.shortfall,
      });
      return;
    }

    res.status(200).json({
      unlocked: true,
      alreadyUnlocked: false,
      effectivePrice: plan.effectivePrice,
      wallet: plan.nextWallet,
      transaction: plan.transaction,
      unlock: plan.unlock,
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
    console.error('[api/coins/unlock] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to unlock this episode right now.',
    });
  }
}
