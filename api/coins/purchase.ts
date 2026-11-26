import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import {
  DEFAULT_COIN_PACKAGES,
  mockPaymentProvider,
} from '../../src/services/payments/PaymentProvider';
import {
  computePackagePurchaseMutation,
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
  mapFirestoreCoinPackage,
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
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/coins/purchase.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;

    const body = parseBody(req);
    const packageId = typeof body.packageId === 'string' ? body.packageId.trim() : '';
    if (!isValidFirestoreDocId(packageId)) {
      res.status(400).json({ code: 'invalid_package', error: 'Provide a valid coin packageId.' });
      return;
    }

    const db = getAdminDb();

    // Load admin-defined package from Firestore; fall back to default packages only if collection is empty
    const [pkgSnap, anyPkgSnap] = await Promise.all([
      db.collection('coinPackages').doc(packageId).get(),
      db.collection('coinPackages').limit(1).get(),
    ]);

    let coinPackage = pkgSnap.exists
      ? mapFirestoreCoinPackage(pkgSnap.id, pkgSnap.data()!)
      : null;

    if (!coinPackage && anyPkgSnap.empty) {
      coinPackage = DEFAULT_COIN_PACKAGES.find((p) => p.id === packageId) ?? null;
    }

    if (!coinPackage || !coinPackage.active) {
      res.status(404).json({
        code: 'package_unavailable',
        error: 'This coin package is no longer available.',
      });
      return;
    }

    // Complete simulated payment via PaymentProvider (Mock only — no real money charged)
    const receipt = await mockPaymentProvider.completeCoinPackagePurchase(coinPackage, uid);

    const nowMs = Date.now();
    const txIdBase = `tx_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const walletRef = db.collection('wallets').doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const walletDoc = await tx.get(walletRef);
      const currentWallet = walletDoc.exists
        ? mapFirestoreWallet(uid, walletDoc.data())
        : createEmptyWallet(uid, nowMs);

      const plan = computePackagePurchaseMutation({
        wallet: currentWallet,
        coinPackage: coinPackage!,
        receiptId: receipt.receiptId,
        txIdBase,
        nowMs,
      });

      tx.set(walletRef, {
        uid,
        balance: plan.nextWallet.balance,
        lifetimePurchased: plan.nextWallet.lifetimePurchased,
        lifetimeSpent: plan.nextWallet.lifetimeSpent,
        updatedAt: FieldValue.serverTimestamp(),
      });

      for (const entry of plan.transactions) {
        tx.set(db.collection('coinTransactions').doc(entry.id), {
          id: entry.id,
          uid: entry.uid,
          type: entry.type,
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          episodeId: entry.episodeId,
          storyId: entry.storyId,
          creatorId: entry.creatorId,
          createdAt: FieldValue.serverTimestamp(),
          note: entry.note,
        });
      }

      return plan;
    });

    res.status(200).json({
      wallet: result.nextWallet,
      transactions: result.transactions,
      receipt,
      provider: mockPaymentProvider.providerId,
      demoOnly: true,
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
    console.error('[api/coins/purchase] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to complete coin purchase right now.',
    });
  }
}
