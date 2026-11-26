import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DEFAULT_COIN_PACKAGES } from '../../src/services/payments/PaymentProvider';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import {
  mapFirestoreCoinPackage,
  mapFirestoreCoinTransaction,
  mapFirestoreEconomySettings,
  mapFirestoreEpisodeUnlock,
  mapFirestoreWallet,
} from '../_lib/firestoreModels';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/coins/wallet.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;
    const db = getAdminDb();

    const [walletSnap, txSnap, unlocksSnap, pkgSnap, economySnap] = await Promise.all([
      db.collection('wallets').doc(uid).get(),
      db.collection('coinTransactions').where('uid', '==', uid).limit(200).get(),
      db.collection('episodeUnlocks').where('uid', '==', uid).limit(500).get(),
      db.collection('coinPackages').get(),
      db.collection('platformSettings').doc('economy').get(),
    ]);

    const wallet = mapFirestoreWallet(uid, walletSnap.data());
    const transactions = txSnap.docs
      .map((d) => mapFirestoreCoinTransaction(d.id, d.data()))
      .sort((a, b) => b.createdAt - a.createdAt);

    const unlocks = unlocksSnap.docs
      .map((d) => mapFirestoreEpisodeUnlock(d.id, d.data()))
      .sort((a, b) => b.unlockedAt - a.unlockedAt);

    const dbPackages = pkgSnap.docs
      .map((d) => mapFirestoreCoinPackage(d.id, d.data()))
      .filter((p) => p.active)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const packages = dbPackages.length > 0 ? dbPackages : DEFAULT_COIN_PACKAGES;
    const economySettings = mapFirestoreEconomySettings(economySnap.data());

    res.status(200).json({
      wallet,
      transactions,
      unlocks,
      packages,
      economySettings,
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
    console.error('[api/coins/wallet] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to load coin wallet right now.',
    });
  }
}
