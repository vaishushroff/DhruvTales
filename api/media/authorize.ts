import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  canAccessEpisode,
  resolveEffectiveEpisodePrice,
} from '../../src/services/access/episodeAccess';
import { buildEpisodeUnlockDocId } from '../_lib/coinEngine';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import {
  getDefaultMimeTypeForFormat,
  isValidFirestoreDocId,
  mapFirestoreDailyUnlock,
  mapFirestoreEconomySettings,
  mapFirestoreEpisode,
  mapFirestoreEpisodeUnlock,
  mapFirestoreStorySummary,
  mapFirestoreUserProfile,
  resolveDriveRefForFormat,
} from '../_lib/firestoreModels';
import {
  createMediaStreamToken,
  getMediaSigningSecret,
  type StreamFormat,
} from '../_lib/mediaToken';

const BOOTSTRAP_ADMIN_EMAIL = 'vaishushroff@gmail.com';

interface AuthorizeRequestBody {
  episodeId?: unknown;
  format?: unknown;
}

function parseBody(req: VercelRequest): AuthorizeRequestBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as AuthorizeRequestBody;
    } catch {
      return {};
    }
  }
  return req.body as AuthorizeRequestBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/media/authorize.' });
    return;
  }

  const signingSecret = getMediaSigningSecret();
  if (!signingSecret) {
    res.status(503).json({
      code: 'server_not_configured',
      error:
        'MEDIA_SIGNING_SECRET is not configured on the server. Set a 32+ character secret in Vercel environment variables.',
    });
    return;
  }

  const body = parseBody(req);
  const episodeId = isValidFirestoreDocId(body.episodeId) ? body.episodeId.trim() : null;
  const format: StreamFormat | null =
    body.format === 'audio' || body.format === 'video' ? body.format : null;

  if (!episodeId || !format) {
    res.status(400).json({
      code: 'invalid_request',
      error: 'Request body must include valid episodeId and format ("audio" or "video").',
    });
    return;
  }

  try {
    // 1. Verify Firebase ID token if provided (reject malformed/expired tokens with 401)
    const decodedToken = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: false,
    });

    const db = getAdminDb();

    // 2. Load episode and economy settings from Firestore via Admin SDK
    const [episodeSnap, economySnap] = await Promise.all([
      db.collection('episodes').doc(episodeId).get(),
      db.collection('platformSettings').doc('economy').get(),
    ]);

    if (!episodeSnap.exists || episodeSnap.data()?.isDeleted === true) {
      res.status(404).json({
        code: 'episode_not_found',
        error: 'Episode not found in Firestore.',
      });
      return;
    }

    const episode = mapFirestoreEpisode(episodeSnap.id, episodeSnap.data() ?? {});
    const economySettings = mapFirestoreEconomySettings(economySnap.data());

    // 3. Load parent story to respect any Admin story-level price override
    const storySnap = episode.storyId
      ? await db.collection('stories').doc(episode.storyId).get()
      : null;
    if (storySnap?.exists && storySnap.data()?.isDeleted === true) {
      res.status(404).json({
        code: 'episode_not_found',
        error: 'Story has been archived or removed.',
      });
      return;
    }
    const story = storySnap?.exists
      ? mapFirestoreStorySummary(storySnap.id, storySnap.data())
      : null;

    // 4. Verify the episode actually references a Drive asset for the requested format
    const driveRef = resolveDriveRefForFormat(episode, format);
    if (!driveRef) {
      res.status(404).json({
        code: 'file_not_found',
        error: `This episode does not have a Google Drive ${format} file attached.`,
      });
      return;
    }

    const effectivePrice = resolveEffectiveEpisodePrice(episode, story);

    // 5. Load user profile, permanent episodeUnlock, and dailyUnlocks when authenticated
    let userProfile: ReturnType<typeof mapFirestoreUserProfile> = null;
    let episodeUnlocks: ReturnType<typeof mapFirestoreEpisodeUnlock>[] = [];
    let dailyUnlocks: ReturnType<typeof mapFirestoreDailyUnlock>[] = [];

    if (decodedToken) {
      const uid = decodedToken.uid;
      const unlockDocId = buildEpisodeUnlockDocId(uid, episode.id);
      const [userSnap, adminSnap, permanentUnlockSnap, dailyUnlocksSnap] = await Promise.all([
        db.collection('users').doc(uid).get(),
        db.collection('admins').doc(uid).get(),
        db.collection('episodeUnlocks').doc(unlockDocId).get(),
        db.collection('dailyUnlocks').where('userId', '==', uid).get(),
      ]);

      userProfile = mapFirestoreUserProfile(uid, userSnap.data());
      if (userProfile?.isDisabled) {
        res.status(403).json({
          code: 'account_disabled',
          error: 'This account is disabled and cannot stream protected media.',
        });
        return;
      }

      const isBootstrapAdmin =
        decodedToken.email_verified === true &&
        decodedToken.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;

      if ((adminSnap.exists || isBootstrapAdmin) && userProfile) {
        userProfile = { ...userProfile, role: 'admin' as const };
      }

      if (permanentUnlockSnap.exists) {
        episodeUnlocks = [
          mapFirestoreEpisodeUnlock(permanentUnlockSnap.id, permanentUnlockSnap.data() ?? {}),
        ];
      }

      dailyUnlocks = dailyUnlocksSnap.docs.map((d) => mapFirestoreDailyUnlock(d.id, d.data()));
    } else if (effectivePrice > 0) {
      res.status(401).json({
        code: 'unauthenticated',
        priceCoins: effectivePrice,
        error: 'Sign in and unlock this episode with coins to play it.',
      });
      return;
    }

    // 6. Run the EXACT SAME pure access logic used on the client
    const access = canAccessEpisode(userProfile, episode, {
      story,
      episodeUnlocks,
      dailyUnlocks,
      economySettings,
    });

    if (!access.allowed) {
      const status = decodedToken ? 403 : 401;
      res.status(status).json({
        code: 'no_access',
        reason: access.reason,
        priceCoins: access.effectivePriceCoins,
        error: `Unlock this episode for ${access.effectivePriceCoins} coins to watch or listen.`,
      });
      return;
    }

    // 7. Mint short-lived (5 min) HMAC-signed token for /api/media/stream (NEVER return a Drive URL or ID)
    const { token, expiresAt } = createMediaStreamToken(
      {
        episodeId: episode.id,
        uid: decodedToken?.uid ?? 'guest',
        format,
      },
      signingSecret
    );

    res.status(200).json({
      url: `/api/media/stream?token=${encodeURIComponent(token)}`,
      expiresAt,
      format,
      mimeType: getDefaultMimeTypeForFormat(format),
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
    console.error('[api/media/authorize] Unexpected error:', err);
    res.status(500).json({
      code: 'internal_error',
      error: 'Unable to authorize media playback right now.',
    });
  }
}
