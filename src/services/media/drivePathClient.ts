import { resolveApiUrl } from '../api/apiClient';
import { auth } from '../firebase/config';

export interface ResolvedDriveFileInfo {
  fileId: string;
  name: string;
  normalizedPath: string;
  mimeType: string;
  mediaKind: 'audio' | 'video';
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
  previewProxyUrl: string;
  expiresAt?: number;
}

export interface DriveBrowseFolderItem {
  id: string;
  name: string;
  path: string;
}

export interface DriveBrowseFileItem {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  mediaKind: 'audio' | 'video';
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface DriveBrowseResponse {
  currentPath: string;
  serviceAccountEmail: string;
  folders: DriveBrowseFolderItem[];
  files: DriveBrowseFileItem[];
}

export class DrivePathClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'DrivePathClientError';
    this.code = code;
    this.status = status;
  }
}

async function getRequiredFirebaseBearer(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new DrivePathClientError(
      'unauthenticated',
      401,
      'Please sign in with your Creator or Admin account to locate Google Drive files.'
    );
  }
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

export function formatBytesReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Probes an encrypted same-origin `/api/media/proxy?token=...` URL in the browser
 * to read exact audio/video duration and original video dimensions.
 */
export function probeProxyMediaDuration(
  proxyUrl: string,
  slot: 'audio' | 'video',
  timeoutMs = 20000
): Promise<{ durationSec?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !proxyUrl) {
      resolve({});
      return;
    }

    const el = document.createElement(slot === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    if (slot === 'video') {
      (el as HTMLVideoElement).playsInline = true;
    }

    let settled = false;
    let timerId: number | null = null;

    const finish = (result: { durationSec?: number; width?: number; height?: number }) => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load();
      resolve(result);
    };

    const onLoaded = () => {
      const dur =
        Number.isFinite(el.duration) && el.duration > 0
          ? Math.max(1, Math.min(86400, Math.round(el.duration)))
          : undefined;
      if (slot === 'video') {
        const v = el as HTMLVideoElement;
        finish({
          durationSec: dur,
          width: v.videoWidth > 0 ? v.videoWidth : undefined,
          height: v.videoHeight > 0 ? v.videoHeight : undefined,
        });
      } else {
        finish({ durationSec: dur });
      }
    };

    const onError = () => finish({});

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('error', onError);
    timerId = window.setTimeout(() => finish({}), timeoutMs);

    try {
      el.src = proxyUrl;
      el.load();
    } catch {
      finish({});
    }
  });
}

/**
 * Resolves a Google Drive file path (e.g. "Trinetra/EP_1.wav") or existing Drive file ID
 * using the backend Service Account via POST /api/drive/resolve-path, and detects exact
 * real duration & original video dimensions automatically.
 */
export async function resolveDrivePathWithServiceAccount(params: {
  path?: string;
  fileId?: string;
  slot: 'audio' | 'video';
}): Promise<ResolvedDriveFileInfo> {
  const authorization = await getRequiredFirebaseBearer();
  const res = await fetch(resolveApiUrl('/api/drive/resolve-path'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      ...(params.path ? { path: params.path.trim() } : {}),
      ...(params.fileId ? { fileId: params.fileId.trim() } : {}),
      slot: params.slot,
    }),
  });

  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json')
    ? ((await res.json()) as Partial<ResolvedDriveFileInfo> & { code?: string; error?: string })
    : null;

  if (!res.ok || !payload?.fileId) {
    throw new DrivePathClientError(
      payload?.code || 'drive_resolve_failed',
      res.status || 502,
      payload?.error ||
        'Could not reach the Google Drive Service Account endpoint on this host. Redeploy the latest server/Worker build.'
    );
  }

  const fullProxyUrl = resolveApiUrl(payload.previewProxyUrl || '');
  let durationSec = payload.durationSec;
  let width = payload.width;
  let height = payload.height;

  // Google Drive API populates durationMillis for video files, but for audio (WAV/MP3/M4A/FLAC)
  // we read the exact real duration from the encrypted Service Account proxy stream in the browser.
  if ((!durationSec || (params.slot === 'video' && (!width || !height))) && fullProxyUrl) {
    const probed = await probeProxyMediaDuration(fullProxyUrl, params.slot);
    if (!durationSec && probed.durationSec) durationSec = probed.durationSec;
    if (!width && probed.width) width = probed.width;
    if (!height && probed.height) height = probed.height;
  }

  return {
    fileId: payload.fileId,
    name: payload.name || payload.fileId,
    normalizedPath: payload.normalizedPath || payload.name || payload.fileId,
    mimeType: payload.mimeType || (params.slot === 'video' ? 'video/mp4' : 'audio/mpeg'),
    mediaKind: payload.mediaKind === 'video' ? 'video' : 'audio',
    sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : 0,
    durationSec,
    width,
    height,
    previewProxyUrl: fullProxyUrl,
    expiresAt: payload.expiresAt,
  };
}

/**
 * Lists folders and real audio/video files at a Google Drive folder path using the Service Account.
 */
export async function browseDriveFolderWithServiceAccount(
  folderPath = ''
): Promise<DriveBrowseResponse> {
  const authorization = await getRequiredFirebaseBearer();
  const qs = folderPath.trim() ? `?path=${encodeURIComponent(folderPath.trim())}` : '';
  const res = await fetch(resolveApiUrl(`/api/drive/browse${qs}`), {
    method: 'GET',
    headers: { Authorization: authorization },
  });

  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json')
    ? ((await res.json()) as Partial<DriveBrowseResponse> & { code?: string; error?: string })
    : null;

  if (!res.ok || !payload || !Array.isArray(payload.folders) || !Array.isArray(payload.files)) {
    throw new DrivePathClientError(
      payload?.code || 'drive_browse_failed',
      res.status || 502,
      payload?.error ||
        'Could not browse Google Drive folders. Verify GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is set on your server/Worker.'
    );
  }

  return {
    currentPath: payload.currentPath ?? '',
    serviceAccountEmail: payload.serviceAccountEmail ?? '',
    folders: payload.folders,
    files: payload.files,
  };
}
