import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase/config';
import type { ClientDriveFileItem, ClientDriveFolderItem } from './googleDriveParser';

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;
let cachedTokenUid: string | null = null;
let cachedTokenExpiresAt = 0;

if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user: User | null) => {
    if (!user || (cachedTokenUid && user.uid !== cachedTokenUid)) {
      cachedDriveAccessToken = null;
      cachedTokenUid = null;
      cachedTokenExpiresAt = 0;
    }
  });
}

function buildDriveProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of GOOGLE_DRIVE_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export function getCachedDriveAccessToken(): string | null {
  if (!cachedDriveAccessToken) return null;
  if (Date.now() >= cachedTokenExpiresAt) {
    cachedDriveAccessToken = null;
    cachedTokenExpiresAt = 0;
    return null;
  }
  return cachedDriveAccessToken;
}

export function clearCachedDriveAccessToken(): void {
  cachedDriveAccessToken = null;
  cachedTokenUid = null;
  cachedTokenExpiresAt = 0;
}

/**
 * Connects the signed-in creator/admin's Google Drive account using client-side
 * Firebase Auth popup and caches the OAuth access token strictly in memory.
 */
export async function connectGoogleDriveAccount(): Promise<string> {
  const provider = buildDriveProvider();
  const currentUser = auth.currentUser;

  let result;
  if (
    currentUser &&
    currentUser.providerData.some((p) => p.providerId === 'google.com')
  ) {
    try {
      result = await reauthenticateWithPopup(currentUser, provider);
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code ?? '')
          : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw new Error('Google Drive connection was cancelled. Please try again.');
      }
      // Fall back to signInWithPopup if user chose a different Google account
      result = await signInWithPopup(auth, provider);
    }
  } else {
    result = await signInWithPopup(auth, provider);
  }

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error('Could not obtain Google Drive access token. Please try connecting again.');
  }

  cachedDriveAccessToken = accessToken;
  cachedTokenUid = result.user.uid;
  // Standard Google OAuth access tokens live ~60 minutes; refresh safely at 50 minutes
  cachedTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return accessToken;
}

async function driveApiGet<T>(pathAndQuery: string, accessToken: string): Promise<T> {
  const res = await fetch(`${DRIVE_API_BASE}${pathAndQuery}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (res.status === 401) {
    clearCachedDriveAccessToken();
    throw new Error('Your Google Drive session expired. Please reconnect Google Drive.');
  }

  if (res.status === 403) {
    throw new Error(
      'Google Drive denied access to this folder. Make sure you connected the Google account that owns or has access to this folder.'
    );
  }

  if (res.status === 404) {
    throw new Error('That Google Drive folder could not be found. Check the folder link or pick a folder from your Drive list.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      detail = errJson.error?.message || '';
    } catch {
      // ignore parse failure
    }
    throw new Error(detail || `Google Drive request failed (HTTP ${res.status}).`);
  }

  return (await res.json()) as T;
}

/**
 * Lists the user's Google Drive folders (newest modified first) directly in the browser.
 */
export async function listGoogleDriveFolders(
  accessToken: string,
  searchQuery = ''
): Promise<ClientDriveFolderItem[]> {
  const safeSearch = searchQuery.trim().replace(/['\\]/g, '').slice(0, 80);
  const qParts = [
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ];
  if (safeSearch) {
    qParts.push(`name contains '${safeSearch}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '30',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const data = await driveApiGet<{
    files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
  }>(`/files?${params.toString()}`, accessToken);

  return (data.files ?? [])
    .filter((f): f is { id: string; name: string; modifiedTime?: string } => Boolean(f.id && f.name))
    .map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    }));
}

/**
 * Lists all non-trashed files inside a Google Drive folder directly from the browser.
 */
export async function listGoogleDriveFolderFiles(
  accessToken: string,
  folderId: string
): Promise<ClientDriveFileItem[]> {
  const safeFolderId = folderId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeFolderId) {
    throw new Error('Please enter or select a valid Google Drive folder.');
  }

  const collected: ClientDriveFileItem[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < 10) {
    pages += 1;
    const params = new URLSearchParams({
      q: `'${safeFolderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,videoMediaMetadata(durationMillis))',
      orderBy: 'name',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const data = await driveApiGet<{
      nextPageToken?: string;
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        videoMediaMetadata?: { durationMillis?: string };
      }>;
    }>(`/files?${params.toString()}`, accessToken);

    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      const durationMs = file.videoMediaMetadata?.durationMillis
        ? Number.parseInt(file.videoMediaMetadata.durationMillis, 10)
        : NaN;
      collected.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType || 'application/octet-stream',
        sizeBytes: file.size ? Number.parseInt(file.size, 10) : undefined,
        durationSec:
          Number.isFinite(durationMs) && durationMs > 0
            ? Math.max(1, Math.round(durationMs / 1000))
            : undefined,
      });
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return collected;
}

/**
 * Fetches a Google Drive audio/video file directly via Drive API v3 using the
 * signed-in creator's in-memory access token (useful for instant Studio preview
 * even before a file is shared publicly).
 */
export async function fetchDriveMediaBlobUrl(
  accessToken: string,
  fileId: string,
  fallbackMime: string
): Promise<{ url: string; mimeType: string } | null> {
  const safeId = fileId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return null;

  try {
    const res = await fetch(
      `${DRIVE_API_BASE}/files/${encodeURIComponent(safeId)}?alt=media&supportsAllDrives=true`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!res.ok) {
      if (res.status === 401) clearCachedDriveAccessToken();
      return null;
    }
    const blob = await res.blob();
    const mimeType = blob.type || fallbackMime;
    return {
      url: URL.createObjectURL(blob),
      mimeType,
    };
  } catch {
    return null;
  }
}
