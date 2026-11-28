import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import type { Episode, MediaRef, Story, UserProfile } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';
import { canAccessEpisode } from '../access/episodeAccess';
import { resolveApiUrl } from '../api/apiClient';
import { auth, db, handleFirestoreError, OperationType } from '../firebase/config';
import { slugify } from '../studio/studioAnalytics';
import {
  buildDrivePreviewEmbedUrl,
  extractDriveFileId,
  isStaticHostApiUnavailable,
  normalizeDirectMediaUrl,
  parseBatchEpisodeLines,
} from './driveFallback';
import { buildDriveCandidateUrls, inferMimeTypeFromUrl } from './mediaFormats';
import type {
  MediaPlaybackResolution,
  MediaProvider,
  MediaUploadMetadata,
} from './MediaProvider';

export type DriveMediaErrorCode =
  | 'unauthenticated'
  | 'no_access'
  | 'account_disabled'
  | 'folder_not_shared'
  | 'file_not_found'
  | 'file_not_shared'
  | 'episode_not_found'
  | 'quota_exceeded'
  | 'invalid_folder_id'
  | 'server_not_configured'
  | 'network_error'
  | 'unknown_error';

export class DriveMediaError extends Error {
  readonly code: DriveMediaErrorCode;
  readonly status: number;

  constructor(code: DriveMediaErrorCode, status: number, message: string) {
    super(message);
    this.name = 'DriveMediaError';
    this.code = code;
    this.status = status;
  }
}

export interface DriveImportCreatedItem {
  episodeId: string;
  episodeNumber: number;
  title: string;
  hasAudio: boolean;
  hasVideo: boolean;
  files: string[];
}

export interface DriveImportSkippedItem {
  fileId: string;
  fileName: string;
  episodeNumber: number;
  reason: string;
}

export interface DriveImportInvalidItem {
  fileId: string;
  fileName: string;
  reason: string;
}

export interface DriveFolderImportResult {
  storyId: string;
  totalFilesScanned: number;
  created: DriveImportCreatedItem[];
  skipped: DriveImportSkippedItem[];
  invalid: DriveImportInvalidItem[];
  mode?: 'server' | 'direct-firestore';
}

interface ApiErrorPayload {
  code?: string;
  error?: string;
  reason?: string;
}

export function mapDriveApiError(status: number, payload: ApiErrorPayload | null): DriveMediaError {
  const code = (payload?.code ?? '') as DriveMediaErrorCode | '';
  const serverMsg = payload?.error?.trim();

  if (code === 'folder_not_shared') {
    return new DriveMediaError(
      'folder_not_shared',
      status,
      serverMsg ||
        'This Google Drive folder is not shared with the Dhruv Tales service account (or does not exist). Share the folder as Viewer and retry.'
    );
  }
  if (code === 'file_not_shared') {
    return new DriveMediaError(
      'file_not_shared',
      status,
      serverMsg ||
        'Access denied to this Google Drive file. Verify the folder is shared with the service account.'
    );
  }
  if (code === 'file_not_found' || code === 'episode_not_found') {
    return new DriveMediaError(
      code,
      status,
      serverMsg || 'The requested media file is missing in Google Drive.'
    );
  }
  if (code === 'quota_exceeded' || status === 429) {
    return new DriveMediaError(
      'quota_exceeded',
      429,
      serverMsg ||
        'Google Drive bandwidth or API quota has been exceeded. Please try again later.'
    );
  }
  if (code === 'server_not_configured' || status === 503 || status === 405) {
    return new DriveMediaError(
      'server_not_configured',
      status || 503,
      serverMsg ||
        'Backend Google Drive API is not available on this host. Use Direct Batch Import or deploy the Node API server.'
    );
  }
  if (code === 'invalid_folder_id') {
    return new DriveMediaError(
      'invalid_folder_id',
      400,
      serverMsg || 'Enter a valid Google Drive folder ID or shared Google Drive folder URL.'
    );
  }
  if (status === 401 || code === 'unauthenticated') {
    return new DriveMediaError(
      'unauthenticated',
      401,
      serverMsg || 'Please sign in to access this episode.'
    );
  }
  if (status === 403 || code === 'no_access' || code === 'account_disabled') {
    return new DriveMediaError(
      code === 'account_disabled' ? 'account_disabled' : 'no_access',
      403,
      serverMsg || 'You do not have access to play or manage this media.'
    );
  }

  return new DriveMediaError(
    'unknown_error',
    status || 500,
    serverMsg || 'Unable to complete the Google Drive media request.'
  );
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getOptionalFirebaseIdToken(): Promise<string | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  try {
    return await currentUser.getIdToken();
  } catch {
    return null;
  }
}

function resolveDirectDriveFallback(mediaRef: MediaRef): MediaPlaybackResolution {
  const rawId = mediaRef.id.trim();
  const driveFileId = extractDriveFileId(rawId);

  if (driveFileId) {
    const [primaryUrl, ...fallbackUrls] = buildDriveCandidateUrls(driveFileId);
    return {
      url: primaryUrl,
      fallbackUrls,
      embedFallbackUrl: buildDrivePreviewEmbedUrl(driveFileId),
      mimeType: mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg',
      provider: 'drive',
      isSimulatedMedia: false,
      isProductionProtected: false,
      label: 'Google Drive (Direct shared playback)',
    };
  }

  const safeUrl = normalizeDirectMediaUrl(rawId) ?? sanitizeSafeUrl(rawId);
  if (safeUrl) {
    return {
      url: safeUrl,
      mimeType: inferMimeTypeFromUrl(safeUrl, mediaRef.type),
      provider: 'drive',
      isSimulatedMedia: false,
      isProductionProtected: false,
      label: 'Direct HTTPS Media Stream',
    };
  }

  throw new DriveMediaError(
    'file_not_found',
    400,
    'This episode does not have a valid Google Drive file ID or direct HTTPS media URL.'
  );
}

/**
 * Google Drive MediaProvider adapter.
 *
 * Works seamlessly on BOTH full-stack and static-only hosts:
 * - On Node/serverless hosts (Vercel, Render, Cloud Run, local dev): calls POST /api/media/authorize
 *   to obtain a short-lived HMAC-signed `/api/media/stream?token=...` URL.
 * - On static-only hosts (Cloudflare Workers Static Assets, Netlify) where `/api/*` returns 404/405:
 *   automatically falls back to direct shared Google Drive playback (`uc?export=download&id=...`)
 *   or direct HTTPS URLs so playback works everywhere with zero 405 errors.
 */
export class DriveMediaProvider implements MediaProvider {
  readonly providerType = 'drive' as const;
  readonly displayName = 'Google Drive Media Provider';
  readonly isImplemented = true;
  readonly isProductionProtected = false;

  async checkAccess(
    _mediaRef: MediaRef,
    user: UserProfile | null,
    episode?: Episode
  ): Promise<boolean> {
    if (!episode) return false;
    return canAccessEpisode(user, episode).allowed;
  }

  async getPlaybackUrl(
    mediaRef: MediaRef,
    _user: UserProfile | null,
    episode?: Episode
  ): Promise<MediaPlaybackResolution> {
    if (!episode?.id) {
      throw new DriveMediaError(
        'episode_not_found',
        400,
        'Episode context is required to authorize Google Drive media playback.'
      );
    }

    const idToken = await getOptionalFirebaseIdToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    let response: Response;
    try {
      response = await fetch(resolveApiUrl('/api/media/authorize'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          episodeId: episode.id,
          format: mediaRef.type,
        }),
      });
    } catch {
      // Network/unreachable backend -> use direct shared Google Drive playback fallback
      return resolveDirectDriveFallback(mediaRef);
    }

    const payload = await parseJsonSafe<{
      url?: string;
      expiresAt?: number;
      mimeType?: string;
      code?: string;
      error?: string;
      reason?: string;
    }>(response);

    if (!response.ok) {
      // Static hosting (404/405/non-JSON) or server not configured (503) -> fall back to direct shared playback
      if (
        isStaticHostApiUnavailable(response.status, Boolean(payload)) ||
        response.status === 503 ||
        payload?.code === 'server_not_configured'
      ) {
        return resolveDirectDriveFallback(mediaRef);
      }
      throw mapDriveApiError(response.status, payload);
    }

    if (!payload?.url || !payload.url.startsWith('/api/media/stream')) {
      return resolveDirectDriveFallback(mediaRef);
    }

    return {
      url: resolveApiUrl(payload.url),
      expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
      mimeType:
        payload.mimeType || (mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
      provider: 'drive',
      isSimulatedMedia: false,
      isProductionProtected: false,
      label: 'Google Drive (Signed stream proxy)',
    };
  }

  async upload(_file: File, _metadata?: MediaUploadMetadata): Promise<MediaRef> {
    throw new DriveMediaError(
      'unknown_error',
      501,
      'Paste a shared Google Drive file link/ID or use Bulk Import in Creator Studio.'
    );
  }
}

/**
 * Creator/Admin helper calling POST /api/media/import-folder to batch-import
 * EP01_audio.* / EP01_video.* files from a shared Google Drive folder into draft episodes.
 */
export async function importEpisodesFromDriveFolder(
  storyId: string,
  folderId: string
): Promise<DriveFolderImportResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new DriveMediaError(
      'unauthenticated',
      401,
      'Please sign in with your Creator or Admin account before importing from Google Drive.'
    );
  }

  let idToken: string;
  try {
    idToken = await currentUser.getIdToken();
  } catch {
    throw new DriveMediaError(
      'unauthenticated',
      401,
      'Could not obtain a valid Firebase session token. Please sign in again.'
    );
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl('/api/media/import-folder'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        storyId,
        folderId: folderId.trim(),
      }),
    });
  } catch {
    throw new DriveMediaError(
      'server_not_configured',
      0,
      'Drive folder scan API (/api/media/import-folder) is unavailable on this host. Use Direct Batch Links below to import episodes directly into Firestore.'
    );
  }

  const payload = await parseJsonSafe<DriveFolderImportResult & ApiErrorPayload>(response);

  if (!response.ok) {
    if (isStaticHostApiUnavailable(response.status, Boolean(payload))) {
      throw new DriveMediaError(
        'server_not_configured',
        response.status,
        'Drive folder scan API (/api/media/import-folder) is not running on this static host. Use Direct Batch Links below—it saves episodes directly to Firestore with no backend server required.'
      );
    }
    throw mapDriveApiError(response.status, payload);
  }

  if (!payload || !Array.isArray(payload.created)) {
    throw new DriveMediaError(
      'unknown_error',
      502,
      'Drive folder import API returned an invalid response.'
    );
  }

  return {
    storyId: payload.storyId,
    totalFilesScanned: payload.totalFilesScanned,
    created: payload.created,
    skipped: payload.skipped ?? [],
    invalid: payload.invalid ?? [],
    mode: 'server',
  };
}

/**
 * Direct Firestore batch importer that works on ANY host (including Cloudflare Workers Static Assets
 * and Netlify with zero backend server). Parses pasted Google Drive file links/IDs or direct HTTPS
 * MP3/MP4 URLs and creates episodes atomically via Firestore batch write.
 */
export async function importEpisodesFromDirectLinks(params: {
  story: Story;
  existingEpisodes: Episode[];
  actorUid: string;
  rawLines: string;
  defaultPriceCoins?: number;
}): Promise<DriveFolderImportResult> {
  const existingNumbers = params.existingEpisodes
    .filter((ep) => !ep.isDeleted)
    .map((ep) => ep.episodeNumber);
  const plan = parseBatchEpisodeLines(params.rawLines, existingNumbers);

  if (plan.totalLines === 0) {
    throw new DriveMediaError(
      'invalid_folder_id',
      400,
      'Paste at least one Google Drive file link/ID or direct https:// audio/video URL.'
    );
  }

  const created: DriveImportCreatedItem[] = [];
  const priceCoins = Math.max(
    0,
    Math.min(100_000, Math.floor(params.defaultPriceCoins ?? 0))
  );
  const ownerUid = params.story.creatorOwnerUid || params.actorUid;

  if (plan.groups.length > 0) {
    try {
      const batch = writeBatch(db);
      const stamp = Date.now().toString(36);
      const storySlug = slugify(params.story.id).slice(0, 20);
      let anyNewVideo = false;

      for (const group of plan.groups) {
        const epId = `ep-${storySlug}-${group.episodeNumber}-${stamp}`.slice(0, 80);
        const epPayload: Record<string, unknown> = {
          id: epId,
          storyId: params.story.id,
          creatorOwnerUid: ownerUid,
          episodeNumber: group.episodeNumber,
          title: group.title.slice(0, 160),
          titleHi: group.title.slice(0, 160),
          description: '',
          descriptionHi: '',
          durationSec: 300,
          priceCoins,
          mediaRef: group.audioRef,
          audioRef: group.audioRef,
          isEnding: false,
          publishedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        };

        if (group.videoMediaRef) {
          epPayload.videoMediaRef = group.videoMediaRef;
          anyNewVideo = true;
        }

        batch.set(doc(db, 'episodes', epId), epPayload);
        created.push({
          episodeId: epId,
          episodeNumber: group.episodeNumber,
          title: group.title,
          hasAudio: true,
          hasVideo: Boolean(group.videoMediaRef),
          files: group.sources,
        });
      }

      await batch.commit();

      const totalEpisodesAfter = params.existingEpisodes.filter((e) => !e.isDeleted).length + created.length;
      const storyHasAnyVideo =
        anyNewVideo || params.existingEpisodes.some((e) => !e.isDeleted && Boolean(e.videoMediaRef));

      await updateDoc(doc(db, 'stories', params.story.id), {
        episodeCount: totalEpisodesAfter,
        format: storyHasAnyVideo ? 'hybrid' : params.story.format,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `episodes(batch:${params.story.id})`);
    }
  }

  return {
    storyId: params.story.id,
    totalFilesScanned: plan.totalLines,
    created,
    skipped: plan.skipped.map((s) => ({
      fileId: `line-${s.lineNumber}`,
      fileName: `Line ${s.lineNumber}`,
      episodeNumber: s.episodeNumber,
      reason: s.reason,
    })),
    invalid: plan.invalid.map((inv) => ({
      fileId: `line-${inv.lineNumber}`,
      fileName: `Line ${inv.lineNumber}: ${inv.rawLine.slice(0, 48)}`,
      reason: inv.reason,
    })),
    mode: 'direct-firestore',
  };
}

/** Backward-compatible class export alias */
export const DriveProvider = DriveMediaProvider;
