import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { applyCorsHeaders } from '../_lib/cors';
import { DriveClientError, listDriveFolderFiles } from '../_lib/driveClient';
import {
  AuthVerificationError,
  getAdminDb,
  ServerConfigError,
  verifyFirebaseBearerToken,
} from '../_lib/firebaseAdmin';
import { isValidFirestoreDocId, mapFirestoreUserProfile } from '../_lib/firestoreModels';
import { extractDriveFolderId, planFolderImport } from '../_lib/folderParser';

interface ImportFolderRequestBody {
  storyId?: unknown;
  folderId?: unknown;
}

function parseBody(req: VercelRequest): ImportFolderRequestBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as ImportFolderRequestBody;
    } catch {
      return {};
    }
  }
  return req.body as ImportFolderRequestBody;
}

function slugPart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      code: 'method_not_allowed',
      error: 'Use POST /api/media/import-folder.',
    });
    return;
  }

  const body = parseBody(req);
  const storyId = isValidFirestoreDocId(body.storyId) ? body.storyId.trim() : null;
  const folderId =
    typeof body.folderId === 'string' ? extractDriveFolderId(body.folderId) : null;

  if (!storyId) {
    res.status(400).json({
      code: 'invalid_request',
      error: 'Please select a valid story before importing from Google Drive.',
    });
    return;
  }

  if (!folderId) {
    res.status(400).json({
      code: 'invalid_folder_id',
      error: 'Please enter a valid Google Drive folder ID or shared Google Drive folder URL.',
    });
    return;
  }

  try {
    // 1. Require authenticated Creator or Admin via verified Firebase ID token
    const decodedToken = await verifyFirebaseBearerToken(req.headers.authorization, {
      required: true,
    });
    if (!decodedToken) {
      res.status(401).json({ code: 'unauthenticated', error: 'Sign in required.' });
      return;
    }

    const uid = decodedToken.uid;
    const db = getAdminDb();

    const [userSnap, adminSnap, storySnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('admins').doc(uid).get(),
      db.collection('stories').doc(storyId).get(),
    ]);

    const userProfile = mapFirestoreUserProfile(uid, userSnap.data());
    if (userProfile?.isDisabled) {
      res.status(403).json({
        code: 'account_disabled',
        error: 'Your account is disabled and cannot import content.',
      });
      return;
    }

    const isAdmin =
      adminSnap.exists ||
      userProfile?.role === 'admin' ||
      decodedToken.email === 'vaishushroff@gmail.com';
    const isCreator = userProfile?.role === 'creator';

    if (!isAdmin && !isCreator) {
      res.status(403).json({
        code: 'no_access',
        error: 'Only Creators and Admins can import episodes from Google Drive.',
      });
      return;
    }

    if (!storySnap.exists) {
      res.status(404).json({
        code: 'story_not_found',
        error: 'The selected story could not be found in Firestore.',
      });
      return;
    }

    const storyData = storySnap.data() ?? {};
    const storyOwnerUid = String(storyData.creatorOwnerUid ?? '');
    if (!isAdmin && storyOwnerUid !== uid) {
      res.status(403).json({
        code: 'no_access',
        error: 'You can only import episodes into stories that you own.',
      });
      return;
    }

    // 2. List files in the shared Google Drive folder using the service account
    const driveFiles = await listDriveFolderFiles(folderId);

    // 3. Load existing episodes for this story so we never overwrite them
    const existingEpsSnap = await db
      .collection('episodes')
      .where('storyId', '==', storyId)
      .get();

    const existingEpisodeNumbers = new Set<number>();
    let storyHasVideo = false;
    let storyHasAudio = false;

    for (const docSnap of existingEpsSnap.docs) {
      const epData = docSnap.data();
      const num = Number(epData.episodeNumber);
      if (Number.isFinite(num) && num >= 1) {
        existingEpisodeNumbers.add(num);
      }
      if (epData.videoMediaRef || epData.mediaRef?.type === 'video') {
        storyHasVideo = true;
      }
      if (epData.audioRef || epData.mediaRef?.type === 'audio') {
        storyHasAudio = true;
      }
    }

    // 4. Parse naming convention EP01_audio.* / EP01_video.* and merge same-episode tracks
    const plan = planFolderImport(driveFiles, existingEpisodeNumbers);

    const created: Array<{
      episodeId: string;
      episodeNumber: number;
      title: string;
      hasAudio: boolean;
      hasVideo: boolean;
      files: string[];
    }> = [];

    if (plan.toCreate.length > 0) {
      const batch = db.batch();
      const nowTs = Timestamp.now();
      const ownerForEpisodes = storyOwnerUid || uid;

      for (const item of plan.toCreate) {
        const padded = String(item.episodeNumber).padStart(2, '0');
        const episodeId = `ep-${slugPart(storyId) || 'story'}-drive-${padded}-${Date.now().toString(36).slice(-4)}`;

        const audioRef = item.audioFile
          ? { provider: 'drive' as const, id: item.audioFile.id, type: 'audio' as const }
          : undefined;
        const videoMediaRef = item.videoFile
          ? { provider: 'drive' as const, id: item.videoFile.id, type: 'video' as const }
          : undefined;

        const primaryRef = audioRef ?? videoMediaRef;
        if (!primaryRef) continue;

        if (audioRef) storyHasAudio = true;
        if (videoMediaRef) storyHasVideo = true;

        const title = `Episode ${item.episodeNumber} (Draft)`;
        const titleHi = `एपिसोड ${item.episodeNumber} (ड्राफ़्ट)`;

        // Strictly matches firestore.rules isValidEpisode & isValidMediaRef schema so
        // creators can edit & save imported episodes from Creator Studio without rule errors.
        const docPayload: Record<string, unknown> = {
          id: episodeId,
          storyId,
          creatorOwnerUid: ownerForEpisodes,
          episodeNumber: item.episodeNumber,
          title,
          titleHi,
          description:
            'Draft episode imported from Google Drive. Edit title, description, and duration in Creator Studio.',
          descriptionHi:
            'Google Drive से आयात किया गया ड्राफ़्ट एपिसोड। क्रिएटर स्टूडियो में शीर्षक और अवधि अपडेट करें।',
          durationSec: item.estimatedDurationSec,
          priceCoins: item.episodeNumber <= 2 ? 0 : 10,
          mediaRef: primaryRef,
          isEnding: false,
          publishedAt: nowTs,
          createdAt: FieldValue.serverTimestamp(),
        };

        if (audioRef) {
          docPayload.audioRef = audioRef;
        }
        if (videoMediaRef) {
          docPayload.videoMediaRef = videoMediaRef;
        }

        batch.set(db.collection('episodes').doc(episodeId), docPayload);

        created.push({
          episodeId,
          episodeNumber: item.episodeNumber,
          title,
          hasAudio: Boolean(audioRef),
          hasVideo: Boolean(videoMediaRef),
          files: [item.audioFile?.name, item.videoFile?.name].filter(
            (name): name is string => Boolean(name)
          ),
        });
      }

      const nextFormat =
        storyHasAudio && storyHasVideo ? 'hybrid' : storyHasVideo ? 'video' : 'audio';

      batch.update(db.collection('stories').doc(storyId), {
        episodeCount: existingEpsSnap.size + created.length,
        format: nextFormat,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();
    }

    res.status(200).json({
      storyId,
      totalFilesScanned: driveFiles.length,
      created,
      skipped: plan.skipped,
      invalid: plan.invalid,
    });
  } catch (err) {
    if (err instanceof AuthVerificationError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof DriveClientError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/media/import-folder] Unexpected error:', err);
    res.status(500).json({
      code: 'import_error',
      error: 'Unable to import files from Google Drive right now.',
    });
  }
}
