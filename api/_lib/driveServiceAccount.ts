import {
  classifyDriveMediaFile,
  escapeDriveQueryLiteral,
  normalizeDriveFolderPath,
  normalizeDrivePath,
  pickBestDriveNameMatch,
} from './drivePathUtils';
import { isValidDriveFileId } from './mediaProxySecurity';

export interface DriveServiceAccountEnv {
  GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_DRIVE_CLIENT_EMAIL?: string;
  GOOGLE_DRIVE_PRIVATE_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_DRIVE_ROOT_FOLDER_ID?: string;
}

export interface ParsedServiceAccountCreds {
  clientEmail: string;
  privateKey: string;
}

export interface DriveServiceEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  mediaKind: 'audio' | 'video' | null;
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface ResolvedDrivePathFile {
  fileId: string;
  name: string;
  normalizedPath: string;
  mimeType: string;
  mediaKind: 'audio' | 'video';
  sizeBytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface DriveBrowseResult {
  currentPath: string;
  rootFolderName?: string;
  serviceAccountEmail: string;
  folders: Array<{ id: string; name: string; path: string }>;
  files: Array<{
    id: string;
    name: string;
    path: string;
    mimeType: string;
    mediaKind: 'audio' | 'video';
    sizeBytes: number;
    durationSec?: number;
    width?: number;
    height?: number;
  }>;
}

export class DriveServiceAccountError extends Error {
  readonly code:
    | 'drive_sa_not_configured'
    | 'drive_auth_failed'
    | 'invalid_path'
    | 'path_not_found'
    | 'not_media_file'
    | 'file_not_found'
    | 'access_denied'
    | 'quota_exceeded'
    | 'drive_api_error';
  readonly status: number;

  constructor(
    code: DriveServiceAccountError['code'],
    status: number,
    message: string
  ) {
    super(message);
    this.name = 'DriveServiceAccountError';
    this.code = code;
    this.status = status;
  }
}

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const TEXT_ENCODER = new TextEncoder();

interface TokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const accessTokenCache = new Map<string, TokenCacheEntry>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJsonBase64Url(obj: Record<string, unknown>): string {
  return toBase64Url(TEXT_ENCODER.encode(JSON.stringify(obj)));
}

function decodeBase64ToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  return atob(normalized + '='.repeat(pad));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function parseServiceAccountJsonString(raw: string): ParsedServiceAccountCreds | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const jsonText = trimmed.startsWith('{') ? trimmed : decodeBase64ToString(trimmed);
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const clientEmail = String(parsed.client_email ?? parsed.clientEmail ?? '').trim();
    const privateKey = String(parsed.private_key ?? parsed.privateKey ?? '')
      .replace(/\\n/g, '\n')
      .trim();
    if (!clientEmail || !privateKey) return null;
    return { clientEmail, privateKey };
  } catch {
    return null;
  }
}

export function resolveDriveServiceAccountCreds(
  env: DriveServiceAccountEnv
): ParsedServiceAccountCreds | null {
  const candidates = [
    env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    env.GOOGLE_SERVICE_ACCOUNT_JSON,
  ];
  for (const raw of candidates) {
    if (raw) {
      const parsed = parseServiceAccountJsonString(raw);
      if (parsed) return parsed;
    }
  }

  const email = env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim();
  const key = env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (email && key) {
    return { clientEmail: email, privateKey: key };
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = parseServiceAccountJsonString(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed) return parsed;
  }

  return null;
}

export function isDriveServiceAccountConfigured(env: DriveServiceAccountEnv): boolean {
  return resolveDriveServiceAccountCreds(env) !== null;
}

function extractRootFolderId(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]{10,120})/i.exec(trimmed);
  if (folderMatch?.[1] && isValidDriveFileId(folderMatch[1])) {
    return folderMatch[1];
  }
  return isValidDriveFileId(trimmed) ? trimmed : null;
}

export async function getDriveServiceAccountAccessToken(
  env: DriveServiceAccountEnv
): Promise<{ accessToken: string; clientEmail: string }> {
  const creds = resolveDriveServiceAccountCreds(env);
  if (!creds) {
    throw new DriveServiceAccountError(
      'drive_sa_not_configured',
      503,
      'Google Drive Service Account is not configured on this server. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON in your environment/Worker secrets.'
    );
  }

  const cached = accessTokenCache.get(creds.clientEmail);
  if (cached && cached.expiresAtMs - Date.now() > 60_000) {
    return { accessToken: cached.token, clientEmail: creds.clientEmail };
  }

  let signingKey: CryptoKey;
  try {
    const keyBuf = pemToArrayBuffer(creds.privateKey);
    signingKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBuf,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch {
    throw new DriveServiceAccountError(
      'drive_auth_failed',
      503,
      'Invalid Service Account private key format in GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.'
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = encodeJsonBase64Url({ alg: 'RS256', typ: 'JWT' });
  const claimSet = encodeJsonBase64Url({
    iss: creds.clientEmail,
    scope: DRIVE_READONLY_SCOPE,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  });
  const signingInput = `${header}.${claimSet}`;
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingKey,
    TEXT_ENCODER.encode(signingInput)
  );
  const assertion = `${signingInput}.${toBase64Url(new Uint8Array(sigBuf))}`;

  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new DriveServiceAccountError(
      'drive_auth_failed',
      503,
      `Google Service Account authentication failed (${tokenRes.status}). Verify GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON and that Google Drive API is enabled.${errText ? '' : ''}`
    );
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new DriveServiceAccountError(
      'drive_auth_failed',
      503,
      'Google OAuth returned an empty access token for the Service Account.'
    );
  }

  const expiresInMs = Math.max(300, Number(tokenJson.expires_in) || 3500) * 1000;
  accessTokenCache.set(creds.clientEmail, {
    token: tokenJson.access_token,
    expiresAtMs: Date.now() + expiresInMs,
  });

  return { accessToken: tokenJson.access_token, clientEmail: creds.clientEmail };
}

interface RawDriveApiFile {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
}

function mapRawDriveFile(raw: RawDriveApiFile): DriveServiceEntry | null {
  if (!raw.id || !raw.name || raw.trashed) return null;
  const mime = raw.mimeType || 'application/octet-stream';
  const isFolder = mime === FOLDER_MIME;
  const classified = isFolder
    ? { isMedia: false, kind: null, resolvedMimeType: FOLDER_MIME }
    : classifyDriveMediaFile(mime, raw.name);
  const sizeBytes = Number.parseInt(raw.size ?? '0', 10);
  const durationMillis = Number.parseInt(raw.videoMediaMetadata?.durationMillis ?? '0', 10);
  const width =
    typeof raw.videoMediaMetadata?.width === 'number' && raw.videoMediaMetadata.width > 0
      ? Math.round(raw.videoMediaMetadata.width)
      : undefined;
  const height =
    typeof raw.videoMediaMetadata?.height === 'number' && raw.videoMediaMetadata.height > 0
      ? Math.round(raw.videoMediaMetadata.height)
      : undefined;

  return {
    id: raw.id,
    name: raw.name,
    mimeType: classified.resolvedMimeType,
    isFolder,
    mediaKind: classified.kind,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
    durationSec:
      Number.isFinite(durationMillis) && durationMillis > 0
        ? Math.max(1, Math.round(durationMillis / 1000))
        : undefined,
    width,
    height,
  };
}

async function throwMappedDriveApiError(res: Response, clientEmail: string): Promise<never> {
  let reason = '';
  try {
    const body = (await res.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
    };
    reason = body.error?.errors?.[0]?.reason || body.error?.message || '';
  } catch {
    // ignore non-json
  }
  const lower = reason.toLowerCase();

  if (res.status === 429 || lower.includes('quota') || lower.includes('ratelimit')) {
    throw new DriveServiceAccountError(
      'quota_exceeded',
      429,
      'Google Drive API rate limit reached. Please retry in a moment.'
    );
  }
  if (res.status === 403) {
    if (lower.includes('accessnotconfigured') || lower.includes('not been used in project')) {
      throw new DriveServiceAccountError(
        'drive_auth_failed',
        503,
        'Google Drive API is not enabled in your Google Cloud project. Enable "Google Drive API" in Google Cloud Console.'
      );
    }
    throw new DriveServiceAccountError(
      'access_denied',
      403,
      `Service Account (${clientEmail}) does not have Viewer access to this Drive file or folder. Share your Drive folder with ${clientEmail} as Viewer.`
    );
  }
  if (res.status === 404) {
    throw new DriveServiceAccountError(
      'file_not_found',
      404,
      `File or folder was not found in Google Drive for Service Account (${clientEmail}). Make sure it is shared with ${clientEmail}.`
    );
  }

  throw new DriveServiceAccountError(
    'drive_api_error',
    res.status >= 500 ? 502 : res.status || 502,
    reason || 'Google Drive API returned an unexpected error.'
  );
}

async function listDriveChildren(
  accessToken: string,
  clientEmail: string,
  parentFolderId: string | null
): Promise<DriveServiceEntry[]> {
  const query = parentFolderId
    ? `'${escapeDriveQueryLiteral(parentFolderId)}' in parents and trashed = false`
    : `(sharedWithMe = true or 'root' in parents) and trashed = false`;

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,mimeType,size,trashed,videoMediaMetadata)',
    pageSize: '200',
    orderBy: 'folder,name',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    await throwMappedDriveApiError(res, clientEmail);
  }

  const data = (await res.json()) as { files?: RawDriveApiFile[] };
  const mapped: DriveServiceEntry[] = [];
  for (const f of data.files ?? []) {
    const entry = mapRawDriveFile(f);
    if (entry) mapped.push(entry);
  }
  return mapped;
}

export async function getDriveFileMetadataWithServiceAccount(
  fileId: string,
  env: DriveServiceAccountEnv
): Promise<DriveServiceEntry> {
  const cleanId = fileId.trim();
  if (!isValidDriveFileId(cleanId)) {
    throw new DriveServiceAccountError('file_not_found', 400, 'Invalid Google Drive file ID.');
  }

  const { accessToken, clientEmail } = await getDriveServiceAccountAccessToken(env);
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    cleanId
  )}?fields=id,name,mimeType,size,trashed,videoMediaMetadata&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    await throwMappedDriveApiError(res, clientEmail);
  }

  const raw = (await res.json()) as RawDriveApiFile;
  const entry = mapRawDriveFile(raw);
  if (!entry) {
    throw new DriveServiceAccountError('file_not_found', 404, 'File is trashed or unavailable in Google Drive.');
  }
  return entry;
}

/**
 * Walks folder segments from either GOOGLE_DRIVE_ROOT_FOLDER_ID or the folders shared
 * with the Service Account, returning the matching folder's entries (or resolving a file).
 */
async function walkSegmentsFromStart(
  accessToken: string,
  clientEmail: string,
  startParentId: string | null,
  segments: string[],
  expectFile: boolean
): Promise<{
  ok: true;
  folderId: string | null;
  matchedEntry?: DriveServiceEntry;
  children?: DriveServiceEntry[];
} | {
  ok: false;
  missingSegment: string;
  availableNames: string[];
}> {
  let currentParentId = startParentId;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const entries = await listDriveChildren(accessToken, clientEmail, currentParentId);

    if (isLast && expectFile) {
      const files = entries.filter((e) => !e.isFolder);
      const matched = pickBestDriveNameMatch(files, seg, true);
      if (!matched) {
        return {
          ok: false,
          missingSegment: seg,
          availableNames: entries.slice(0, 12).map((e) => (e.isFolder ? `${e.name}/` : e.name)),
        };
      }
      return { ok: true, folderId: currentParentId, matchedEntry: matched };
    }

    const folders = entries.filter((e) => e.isFolder);
    const matchedFolder = pickBestDriveNameMatch(folders, seg, false);
    if (!matchedFolder) {
      return {
        ok: false,
        missingSegment: seg,
        availableNames: folders.slice(0, 12).map((f) => `${f.name}/`),
      };
    }
    currentParentId = matchedFolder.id;
  }

  const children = await listDriveChildren(accessToken, clientEmail, currentParentId);
  return { ok: true, folderId: currentParentId, children };
}

/**
 * Resolves a human-readable Google Drive path (e.g. "Trinetra/EP_1.wav") using ONLY the
 * configured Service Account via Google Drive API v3.
 */
export async function resolveDriveFileByPath(
  rawPath: string,
  expectedSlot: 'audio' | 'video' | 'any',
  env: DriveServiceAccountEnv
): Promise<ResolvedDrivePathFile> {
  const parsed = normalizeDrivePath(rawPath);
  if (!parsed.ok) {
    throw new DriveServiceAccountError('invalid_path', 400, parsed.reason);
  }

  const { accessToken, clientEmail } = await getDriveServiceAccountAccessToken(env);
  const configuredRootId = extractRootFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

  let walk = await walkSegmentsFromStart(
    accessToken,
    clientEmail,
    configuredRootId,
    parsed.segments,
    true
  );

  // If no explicit GOOGLE_DRIVE_ROOT_FOLDER_ID is set and the user omitted their single shared
  // top-level folder name (e.g., shared "DhruvTales" and typed "Trinetra/EP_1.wav"), auto-check inside top-level shared folders!
  if (!walk.ok && !configuredRootId) {
    const topEntries = await listDriveChildren(accessToken, clientEmail, null);
    const topFolders = topEntries.filter((e) => e.isFolder);
    for (const rootCandidate of topFolders.slice(0, 5)) {
      const retry = await walkSegmentsFromStart(
        accessToken,
        clientEmail,
        rootCandidate.id,
        parsed.segments,
        true
      );
      if (retry.ok) {
        walk = retry;
        break;
      }
    }
  }

  if (!walk.ok) {
    const hint =
      walk.availableNames.length > 0
        ? ` Available here: ${walk.availableNames.join(', ')}`
        : ` Make sure your Google Drive folder is shared with ${clientEmail} as Viewer.`;
    throw new DriveServiceAccountError(
      'path_not_found',
      404,
      `Could not find "${walk.missingSegment}" in Google Drive path "${parsed.normalizedPath}".${hint}`
    );
  }

  if (!walk.matchedEntry) {
    throw new DriveServiceAccountError(
      'path_not_found',
      404,
      `Could not find file at Google Drive path "${parsed.normalizedPath}". Make sure your Google Drive folder is shared with ${clientEmail} as Viewer.`
    );
  }

  const entry = walk.matchedEntry;
  if (!entry.mediaKind) {
    throw new DriveServiceAccountError(
      'not_media_file',
      400,
      `"${entry.name}" is not a supported audio or video file (${entry.mimeType}).`
    );
  }

  if (expectedSlot === 'video' && entry.mediaKind !== 'video') {
    throw new DriveServiceAccountError(
      'not_media_file',
      400,
      `"${entry.name}" is an audio file (${entry.mimeType}), not a video file.`
    );
  }

  return {
    fileId: entry.id,
    name: entry.name,
    normalizedPath: parsed.normalizedPath,
    mimeType: entry.mimeType,
    mediaKind: entry.mediaKind,
    sizeBytes: entry.sizeBytes,
    durationSec: entry.durationSec,
    width: entry.width,
    height: entry.height,
  };
}

/**
 * Lists folders and real audio/video files at a given Google Drive folder path using ONLY
 * the configured Service Account so creators can browse & pick files without copying links.
 */
export async function browseDriveFolder(
  rawFolderPath: string | null | undefined,
  env: DriveServiceAccountEnv
): Promise<DriveBrowseResult> {
  const parsed = normalizeDriveFolderPath(rawFolderPath);
  if (!parsed.ok) {
    throw new DriveServiceAccountError('invalid_path', 400, parsed.reason);
  }

  const { accessToken, clientEmail } = await getDriveServiceAccountAccessToken(env);
  const configuredRootId = extractRootFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

  let walk = await walkSegmentsFromStart(
    accessToken,
    clientEmail,
    configuredRootId,
    parsed.segments,
    false
  );

  if (!walk.ok && !configuredRootId && parsed.segments.length > 0) {
    const topEntries = await listDriveChildren(accessToken, clientEmail, null);
    const topFolders = topEntries.filter((e) => e.isFolder);
    for (const rootCandidate of topFolders.slice(0, 5)) {
      const retry = await walkSegmentsFromStart(
        accessToken,
        clientEmail,
        rootCandidate.id,
        parsed.segments,
        false
      );
      if (retry.ok) {
        walk = retry;
        break;
      }
    }
  }

  if (!walk.ok) {
    const hint =
      walk.availableNames.length > 0
        ? ` Available folders: ${walk.availableNames.join(', ')}`
        : ` Share your Drive folder with ${clientEmail} as Viewer.`;
    throw new DriveServiceAccountError(
      'path_not_found',
      404,
      `Folder "${walk.missingSegment}" was not found.${hint}`
    );
  }

  if (!walk.children) {
    throw new DriveServiceAccountError(
      'path_not_found',
      404,
      `Folder "${parsed.normalizedPath || '/'}" could not be listed. Share your Drive folder with ${clientEmail} as Viewer.`
    );
  }

  const prefix = parsed.normalizedPath ? `${parsed.normalizedPath}/` : '';
  const folders = walk.children
    .filter((e) => e.isFolder)
    .map((f) => ({
      id: f.id,
      name: f.name,
      path: `${prefix}${f.name}`,
    }));

  const files = walk.children
    .filter((e) => !e.isFolder && e.mediaKind !== null)
    .map((f) => ({
      id: f.id,
      name: f.name,
      path: `${prefix}${f.name}`,
      mimeType: f.mimeType,
      mediaKind: f.mediaKind as 'audio' | 'video',
      sizeBytes: f.sizeBytes,
      durationSec: f.durationSec,
      width: f.width,
      height: f.height,
    }));

  return {
    currentPath: parsed.normalizedPath,
    serviceAccountEmail: clientEmail,
    folders,
    files,
  };
}

/**
 * Fetches an authenticated byte-range stream directly from Google Drive API v3 (`?alt=media`)
 * using the Service Account. Works on 100% private Google Drive folders with no public sharing.
 */
export async function fetchDriveStreamWithServiceAccount(
  fileId: string,
  rangeHeader: string | null,
  method: 'GET' | 'HEAD',
  env: DriveServiceAccountEnv
): Promise<Response> {
  const cleanId = fileId.trim();
  if (!isValidDriveFileId(cleanId)) {
    throw new DriveServiceAccountError('file_not_found', 400, 'Invalid Google Drive file ID.');
  }

  const { accessToken } = await getDriveServiceAccountAccessToken(env);
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(
    cleanId
  )}?alt=media&supportsAllDrives=true`;

  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: '*/*',
  });
  if (rangeHeader) {
    headers.set('Range', rangeHeader);
  }

  return fetch(url, {
    method,
    headers,
    redirect: 'follow',
  });
}
