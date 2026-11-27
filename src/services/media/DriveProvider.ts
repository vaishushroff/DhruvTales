import type { Episode, MediaRef, UserProfile } from '../../types';
import { canAccessEpisode } from '../access/episodeAccess';
import { resolveApiUrl } from '../api/apiClient';
import { auth } from '../firebase/config';
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
  if (code === 'server_not_configured' || status === 503) {
    return new DriveMediaError(
      'server_not_configured',
      503,
      serverMsg ||
        'Google Drive media server environment variables are not configured yet on the backend server.'
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

/**
 * Google Drive MediaProvider adapter.
 *
 * Security model:
 * - Frontend stores ONLY `{ provider: "drive", id: <driveFileId>, type: "audio"|"video" }`.
 * - Never receives or constructs a public Drive link.
 * - Playback calls POST /api/media/authorize with the user's Firebase ID token and
 *   receives a short-lived (5-minute) HMAC-signed `/api/media/stream?token=...` URL.
 * - Intended for testing and low-traffic streaming only (not production-grade DRM).
 */
export class DriveMediaProvider implements MediaProvider {
  readonly providerType = 'drive' as const;
  readonly displayName = 'Google Drive Media Provider (Testing / Low Traffic)';
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
      throw new DriveMediaError(
        'network_error',
        0,
        'Could not reach /api/media/authorize. Check your network connection or backend API server.'
      );
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
      if (!payload && response.status === 404) {
        throw new DriveMediaError(
          'server_not_configured',
          404,
          'Media authorization API (/api/media/authorize) is unavailable on this host. Configure VITE_API_BASE_URL or run the backend API server.'
        );
      }
      throw mapDriveApiError(response.status, payload);
    }

    if (!payload?.url || !payload.url.startsWith('/api/media/stream')) {
      throw new DriveMediaError(
        'unknown_error',
        502,
        'Media authorization server returned an unexpected response.'
      );
    }

    return {
      url: resolveApiUrl(payload.url),
      expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : undefined,
      mimeType:
        payload.mimeType || (mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
      provider: 'drive',
      isSimulatedMedia: false,
      isProductionProtected: false,
      label: 'Google Drive (Signed stream proxy · Testing / low traffic only)',
    };
  }

  async upload(_file: File, _metadata?: MediaUploadMetadata): Promise<MediaRef> {
    throw new DriveMediaError(
      'unknown_error',
      501,
      'Direct browser uploads to Google Drive are disabled. Upload files named EP01_audio.mp3 / EP01_video.mp4 to your shared Drive folder and use "Import from Drive folder" in Creator Studio.'
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
      'network_error',
      0,
      'Could not reach /api/media/import-folder. Check your network connection or backend API server.'
    );
  }

  const payload = await parseJsonSafe<DriveFolderImportResult & ApiErrorPayload>(response);

  if (!response.ok) {
    if (!payload && response.status === 404) {
      throw new DriveMediaError(
        'server_not_configured',
        404,
        'Drive folder import API (/api/media/import-folder) is unavailable on this host. Configure VITE_API_BASE_URL or run the backend API server.'
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
  };
}

/** Backward-compatible class export alias */
export const DriveProvider = DriveMediaProvider;
