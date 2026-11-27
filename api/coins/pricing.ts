import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import type { UserRole } from '../../src/types';
import { validatePriceChangePermission } from '../_lib/coinEngine';
import { applyCorsHeaders } from '../_lib/cors';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { isValidFirestoreDocId } from '../_lib/firestoreModels';

const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';

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

async function resolveActorRole(uid: string, email: string | undefined): Promise<UserRole> {
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) {
    return 'admin';
  }
  const db = getAdminDb();
  const [adminSnap, userSnap] = await Promise.all([
    db.collection('admins').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  if (adminSnap.exists) return 'admin';
  const role = userSnap.data()?.role;
  if (role === 'admin' || role === 'creator') return role;
  return 'user';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/coins/pricing.' });
    return;
  }

  try {
    const decoded = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    const uid = decoded!.uid;
    const email = decoded!.email ?? '';

    const body = parseBody(req);
    const target = body.target;
    if (target !== 'episode_price' && target !== 'story_override') {
      res.status(400).json({
        code: 'invalid_target',
        error: 'target must be "episode_price" or "story_override".',
      });
      return;
    }

    const rawPrice = body.priceCoins;
    const priceCoins = rawPrice === null ? null : typeof rawPrice === 'number' ? rawPrice : NaN;
    const actorRole = await resolveActorRole(uid, email);

    const permission = validatePriceChangePermission({
      actorRole,
      target,
      isExistingResource: true,
      newPriceCoins: priceCoins,
    });

    if (!permission.allowed) {
      const status = permission.code === 'invalid_price' ? 400 : 403;
      res.status(status).json({
        code: permission.code ?? 'forbidden',
        error: permission.error ?? 'Not authorized to change pricing.',
      });
      return;
    }

    const db = getAdminDb();
    const logId = `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    if (target === 'episode_price') {
      const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : '';
      if (!isValidFirestoreDocId(episodeId)) {
        res.status(400).json({ code: 'invalid_episode', error: 'Provide a valid episodeId.' });
        return;
      }

      const epRef = db.collection('episodes').doc(episodeId);
      const epSnap = await epRef.get();
      if (!epSnap.exists) {
        res.status(404).json({ code: 'episode_not_found', error: 'Episode not found.' });
        return;
      }

      const prevPrice = epSnap.data()?.priceCoins ?? 0;
      const epTitle = String(epSnap.data()?.title ?? episodeId);

      await Promise.all([
        epRef.update({ priceCoins }),
        db.collection('auditLogs').doc(logId).set({
          id: logId,
          actorUid: uid,
          actorEmail: email || `${uid}@dhruvtales.local`,
          action: 'episode_price_updated',
          targetCollection: 'episodes',
          targetId: episodeId,
          summary: `Changed episode "${epTitle}" price from ${prevPrice} to ${priceCoins} coins`,
          createdAt: FieldValue.serverTimestamp(),
        }),
      ]);

      res.status(200).json({
        updated: true,
        target: 'episode_price',
        episodeId,
        priceCoins,
      });
      return;
    }

    // target === 'story_override'
    const storyId = typeof body.storyId === 'string' ? body.storyId.trim() : '';
    if (!isValidFirestoreDocId(storyId)) {
      res.status(400).json({ code: 'invalid_story', error: 'Provide a valid storyId.' });
      return;
    }

    const storyRef = db.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      res.status(404).json({ code: 'story_not_found', error: 'Story not found.' });
      return;
    }

    const storyTitle = String(storySnap.data()?.title ?? storyId);
    await Promise.all([
      storyRef.update({
        priceOverrideCoins: priceCoins,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      db.collection('auditLogs').doc(logId).set({
        id: logId,
        actorUid: uid,
        actorEmail: email || `${uid}@dhruvtales.local`,
        action: 'story_price_override_updated',
        targetCollection: 'stories',
        targetId: storyId,
        summary:
          priceCoins === null
            ? `Cleared story-level coin price override for "${storyTitle}"`
            : `Set story-level coin price override for "${storyTitle}" to ${priceCoins} coins`,
        createdAt: FieldValue.serverTimestamp(),
      }),
    ]);

    res.status(200).json({
      updated: true,
      target: 'story_override',
      storyId,
      priceOverrideCoins: priceCoins,
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
    console.error('[api/coins/pricing] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to update pricing right now.',
    });
  }
}
