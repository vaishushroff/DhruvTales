import { JWT } from 'google-auth-library';
import type { DriveFolderFileItem } from './folderParser';

export type DriveErrorCode =
  | 'server_not_configured'
  | 'folder_not_shared'
  | 'file_not_found'
  | 'file_not_shared'
  | 'quota_exceeded'
  | 'drive_error';

export class DriveClientError extends Error {
  readonly code: DriveErrorCode;
  readonly status: number;

  constructor(code: DriveErrorCode, status: number, message: string) {
    super(message);
    this.name = 'DriveClientError';
    this.code = code;
    this.status = status;
  }
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  durationSec?: number;
}

interface ParsedDriveServiceAccount {
  client_email: string;
  private_key: string;
}

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const SAFE_DRIVE_ID = /^[a-zA-Z0-9_-]{10,120}$/;

let cachedJwtClient: JWT | null = null;

function parseDriveServiceAccount(): ParsedDriveServiceAccount {
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new DriveClientError(
      'server_not_configured',
      503,
      'Google Drive service account is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON in Vercel environment variables.'
    );
  }

  try {
    const jsonText = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const clientEmail = String(parsed.client_email ?? '').trim();
    const privateKey = String(parsed.private_key ?? '').replace(/\\n/g, '\n').trim();
    if (!clientEmail || !privateKey) {
      throw new Error('Missing client_email or private_key.');
    }
    return { client_email: clientEmail, private_key: privateKey };
  } catch (err) {
    throw new DriveClientError(
      'server_not_configured',
      503,
      `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is invalid: ${err instanceof Error ? err.message : 'parse error'}`
    );
  }
}

async function getDriveAccessToken(): Promise<string> {
  if (!cachedJwtClient) {
    const creds = parseDriveServiceAccount();
    cachedJwtClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [DRIVE_READONLY_SCOPE],
    });
  }

  try {
    const tokenResponse = await cachedJwtClient.getAccessToken();
    const token = tokenResponse.token;
    if (!token) {
      throw new Error('Empty Google OAuth access token.');
    }
    return token;
  } catch (err) {
    if (err instanceof DriveClientError) throw err;
    throw new DriveClientError(
      'server_not_configured',
      503,
      'Could not authenticate the Google Drive service account. Verify GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON and that Google Drive API is enabled.'
    );
  }
}

async function mapDriveApiFailure(
  response: Response,
  context: 'file' | 'folder'
): Promise<DriveClientError> {
  let rawReason = '';
  try {
    const body = (await response.json()) as {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    rawReason = body.error?.errors?.[0]?.reason || body.error?.message || '';
  } catch {
    // Non-JSON upstream error
  }

  const lowerReason = rawReason.toLowerCase();
  if (
    response.status === 429 ||
    lowerReason.includes('quota') ||
    lowerReason.includes('ratelimit') ||
    lowerReason.includes('dailylimit')
  ) {
    return new DriveClientError(
      'quota_exceeded',
      429,
      'Google Drive bandwidth or API quota has been exceeded. Try again later or migrate to dedicated media storage.'
    );
  }

  if (response.status === 404) {
    if (context === 'folder') {
      return new DriveClientError(
        'folder_not_shared',
        404,
        'Google Drive folder was not found or is not shared with the Dhruv Tales service account.'
      );
    }
    return new DriveClientError(
      'file_not_found',
      404,
      'The requested media file is missing in Google Drive or is not shared with the service account.'
    );
  }

  if (response.status === 403) {
    if (context === 'folder') {
      return new DriveClientError(
        'folder_not_shared',
        403,
        'Access denied to Google Drive folder. Share the folder with the service account email as Viewer.'
      );
    }
    return new DriveClientError(
      'file_not_shared',
      403,
      'Access denied to Google Drive media file. Confirm the file or its parent folder is shared with the service account.'
    );
  }

  return new DriveClientError(
    'drive_error',
    response.status >= 500 ? 502 : 500,
    'Google Drive returned an unexpected error while reading media.'
  );
}

export function assertValidDriveId(id: string): string {
  const trimmed = (id || '').trim();
  if (!SAFE_DRIVE_ID.test(trimmed)) {
    throw new DriveClientError('file_not_found', 400, 'Invalid Google Drive file or folder ID.');
  }
  return trimmed;
}

export async function getDriveFileMetadata(fileId: string): Promise<DriveFileMetadata> {
  const safeId = assertValidDriveId(fileId);
  const accessToken = await getDriveAccessToken();

  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    safeId
  )}?fields=id,name,mimeType,size,trashed,videoMediaMetadata&supportsAllDrives=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw await mapDriveApiFailure(response, 'file');
  }

  const data = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    trashed?: boolean;
    videoMediaMetadata?: { durationMillis?: string };
  };

  if (data.trashed) {
    throw new DriveClientError('file_not_found', 404, 'The media file has been trashed in Google Drive.');
  }

  const size = Number.parseInt(data.size ?? '0', 10);
  const durationMillis = Number.parseInt(data.videoMediaMetadata?.durationMillis ?? '0', 10);

  return {
    id: data.id || safeId,
    name: data.name || safeId,
    mimeType: data.mimeType || 'application/octet-stream',
    size: Number.isFinite(size) && size > 0 ? size : 0,
    durationSec:
      Number.isFinite(durationMillis) && durationMillis > 0
        ? Math.round(durationMillis / 1000)
        : undefined,
  };
}

export async function fetchDriveFileRange(
  fileId: string,
  start: number,
  end: number
): Promise<Response> {
  const safeId = assertValidDriveId(fileId);
  const accessToken = await getDriveAccessToken();

  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    safeId
  )}?alt=media&supportsAllDrives=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: `bytes=${start}-${end}`,
    },
  });

  if (!response.ok) {
    throw await mapDriveApiFailure(response, 'file');
  }

  return response;
}

export async function listDriveFolderFiles(folderId: string): Promise<DriveFolderFileItem[]> {
  const safeFolderId = assertValidDriveId(folderId);
  const accessToken = await getDriveAccessToken();

  // First verify the folder itself exists and is shared with the service account
  const folderCheckUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    safeFolderId
  )}?fields=id,name,mimeType,trashed&supportsAllDrives=true`;
  const folderCheckRes = await fetch(folderCheckUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!folderCheckRes.ok) {
    throw await mapDriveApiFailure(folderCheckRes, 'folder');
  }
  const folderMeta = (await folderCheckRes.json()) as {
    mimeType?: string;
    trashed?: boolean;
  };
  if (folderMeta.trashed || folderMeta.mimeType !== 'application/vnd.google-apps.folder') {
    throw new DriveClientError(
      'folder_not_shared',
      404,
      'The provided ID is not an accessible Google Drive folder.'
    );
  }

  const items: DriveFolderFileItem[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < 10) {
    pages += 1;
    const query = `'${safeFolderId}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,mimeType,size,videoMediaMetadata)',
      pageSize: '200',
      orderBy: 'name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const listRes = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) {
      throw await mapDriveApiFailure(listRes, 'folder');
    }

    const body = (await listRes.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        videoMediaMetadata?: { durationMillis?: string };
      }>;
    };

    for (const f of body.files ?? []) {
      if (!f.id || !f.name) continue;
      const sizeBytes = Number.parseInt(f.size ?? '0', 10);
      const durationMillis = Number.parseInt(f.videoMediaMetadata?.durationMillis ?? '0', 10);
      items.push({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType || 'application/octet-stream',
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
        durationSec:
          Number.isFinite(durationMillis) && durationMillis > 0
            ? Math.round(durationMillis / 1000)
            : undefined,
      });
    }

    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }

  return items;
}
