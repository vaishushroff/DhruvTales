export interface NormalizedDrivePathResult {
  ok: true;
  segments: string[];
  normalizedPath: string;
}

export interface InvalidDrivePathResult {
  ok: false;
  reason: string;
}

export type DrivePathParseResult = NormalizedDrivePathResult | InvalidDrivePathResult;

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'flac',
  'webm',
  'aiff',
  'aif',
  'amr',
  '3gp',
  'wma',
  'mka',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mov',
  'mkv',
  'ogv',
  '3gp',
  'avi',
  'ts',
  'flv',
  'mpeg',
  'mpg',
]);

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  wma: 'audio/x-ms-wma',
  mka: 'audio/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  flv: 'video/x-flv',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
};

/**
 * Normalizes and validates a user-supplied Google Drive path such as:
 * "Trinetra/EP_1.wav", "/Stories/Trinetra/ep1.mp4", or "Trinetra\\EP_1.wav".
 * Blocks traversal segments ("..", ".") and control characters.
 */
export function normalizeDrivePath(rawInput: string): DrivePathParseResult {
  if (typeof rawInput !== 'string') {
    return { ok: false, reason: 'Enter a Google Drive file path (for example: Trinetra/EP_1.wav).' };
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Enter a Google Drive file path (for example: Trinetra/EP_1.wav).' };
  }

  if (trimmed.length > 512) {
    return { ok: false, reason: 'Drive path is too long (maximum 512 characters).' };
  }

  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { ok: false, reason: 'Drive path contains invalid control characters.' };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      reason: 'Do not paste a URL—enter the path inside your Google Drive folder (for example: Trinetra/EP_1.wav).',
    };
  }

  const unified = trimmed.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!unified) {
    return { ok: false, reason: 'Enter a Google Drive file path (for example: Trinetra/EP_1.wav).' };
  }

  const rawSegments = unified
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSegments.length === 0) {
    return { ok: false, reason: 'Enter a valid Google Drive file path.' };
  }

  if (rawSegments.length > 16) {
    return { ok: false, reason: 'Drive path is nested too deeply (maximum 16 folders).' };
  }

  for (const seg of rawSegments) {
    if (seg === '.' || seg === '..') {
      return { ok: false, reason: 'Drive path cannot contain "." or ".." traversal segments.' };
    }
    if (seg.length > 255) {
      return { ok: false, reason: 'A folder or file name in the Drive path is too long.' };
    }
  }

  return {
    ok: true,
    segments: rawSegments,
    normalizedPath: rawSegments.join('/'),
  };
}

/**
 * Normalizes an optional folder path for browsing Drive folders.
 * Empty string or "/" means root.
 */
export function normalizeDriveFolderPath(rawInput: string | null | undefined): {
  ok: true;
  segments: string[];
  normalizedPath: string;
} | InvalidDrivePathResult {
  const trimmed = (rawInput ?? '').trim();
  if (!trimmed || trimmed === '/' || trimmed === '\\') {
    return { ok: true, segments: [], normalizedPath: '' };
  }
  return normalizeDrivePath(trimmed);
}

/**
 * Safely escapes a string literal for Google Drive API v3 `q` search queries
 * to prevent Drive query injection when names contain quotes or backslashes.
 */
export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function extractExtLower(fileName: string): string {
  const clean = fileName.trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

export function stripFileExtension(fileName: string): string {
  const clean = fileName.trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0) return clean;
  return clean.slice(0, dot);
}

/**
 * Determines whether a Google Drive file is a real audio or video file (any web format),
 * falling back to filename extension when Drive reports application/octet-stream.
 */
export function classifyDriveMediaFile(
  mimeType: string | null | undefined,
  fileName: string
): { isMedia: boolean; kind: 'audio' | 'video' | null; resolvedMimeType: string } {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const ext = extractExtLower(fileName);

  if (mime === 'application/vnd.google-apps.folder' || mime.startsWith('application/vnd.google-apps.')) {
    return { isMedia: false, kind: null, resolvedMimeType: mime };
  }

  if (mime.startsWith('audio/')) {
    return { isMedia: true, kind: 'audio', resolvedMimeType: mime };
  }
  if (mime.startsWith('video/')) {
    // WebM or MP4 can also hold audio-only streams; extension clarifies audio vs video
    if (ext === 'm4a' || ext === 'mka') {
      return { isMedia: true, kind: 'audio', resolvedMimeType: MIME_BY_EXT[ext] ?? mime };
    }
    return { isMedia: true, kind: 'video', resolvedMimeType: mime };
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    return {
      isMedia: true,
      kind: 'audio',
      resolvedMimeType: MIME_BY_EXT[ext] ?? 'audio/mpeg',
    };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return {
      isMedia: true,
      kind: 'video',
      resolvedMimeType: MIME_BY_EXT[ext] ?? 'video/mp4',
    };
  }

  return { isMedia: false, kind: null, resolvedMimeType: mime || 'application/octet-stream' };
}

/**
 * Matches a candidate list of Drive entries against a target segment name:
 * 1. Exact case-sensitive match
 * 2. Exact case-insensitive match
 * 3. For files only: exact case-insensitive match ignoring file extension (if unambiguous)
 */
export function pickBestDriveNameMatch<T extends { name: string }>(
  candidates: T[],
  targetName: string,
  allowExtensionlessMatch: boolean
): T | null {
  const trimmed = targetName.trim();
  const lower = trimmed.toLowerCase();

  const exact = candidates.find((c) => c.name === trimmed);
  if (exact) return exact;

  const ciExact = candidates.find((c) => c.name.trim().toLowerCase() === lower);
  if (ciExact) return ciExact;

  if (allowExtensionlessMatch) {
    const extlessMatches = candidates.filter(
      (c) => stripFileExtension(c.name).trim().toLowerCase() === lower
    );
    if (extlessMatches.length === 1) {
      return extlessMatches[0];
    }
  }

  return null;
}
