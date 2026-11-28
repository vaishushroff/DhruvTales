import type { MediaRef } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';

const RAW_DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{20,120}$/;

const VIDEO_EXT_REGEX = /\.(mp4|webm|mov|m4v|mkv)(\?.*)?$/i;
const AUDIO_EXT_REGEX = /\.(mp3|m4a|wav|ogg|aac|flac|opus)(\?.*)?$/i;
const EP_PREFIX_REGEX = /^(?:ep|episode)[\s_-]*0*(\d{1,4})(?:[\s_-]*(audio|video))?$/i;

export const MAX_MEDIA_REF_ID_LENGTH = 1024;

export interface ParsedDirectMediaLine {
  lineNumber: number;
  rawLine: string;
  episodeNumber: number;
  title?: string;
  provider: 'drive' | 'demo';
  id: string;
  type: 'audio' | 'video';
  displaySource: string;
}

export interface BatchDirectEpisodeGroup {
  episodeNumber: number;
  title: string;
  audioRef: { provider: 'drive' | 'demo'; id: string; type: 'audio' };
  videoMediaRef?: { provider: 'drive' | 'demo'; id: string; type: 'video' };
  sources: string[];
}

export interface BatchDirectImportPlan {
  groups: BatchDirectEpisodeGroup[];
  skipped: Array<{ lineNumber: number; rawLine: string; episodeNumber: number; reason: string }>;
  invalid: Array<{ lineNumber: number; rawLine: string; reason: string }>;
  totalLines: number;
}

/**
 * Returns true when an API response indicates a static-only host (such as Cloudflare
 * Workers Static Assets or Netlify) where `/api/*` serverless routes are not mounted.
 */
export function isStaticHostApiUnavailable(
  status: number,
  hasJsonPayload: boolean
): boolean {
  if (!hasJsonPayload) {
    return status === 0 || status === 404 || status === 405 || status === 501 || status === 502;
  }
  return status === 404 || status === 405;
}

/**
 * Returns true if the input is a Google Drive folder share link (not a single file).
 */
export function isGoogleDriveFolderUrl(input: string): boolean {
  return /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\//i.test(input.trim());
}

/**
 * Extracts a Google Drive file ID from common share links or accepts a raw Drive file ID.
 */
export function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isGoogleDriveFolderUrl(trimmed)) {
    return null;
  }

  if (RAW_DRIVE_ID_REGEX.test(trimmed) && /[A-Z0-9]/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('google.com') && !host.endsWith('googleusercontent.com')) {
      return null;
    }

    // /file/d/<FILE_ID>/view or /d/<FILE_ID>
    const pathMatch = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,120})/);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    // ?id=<FILE_ID>
    const queryId = url.searchParams.get('id')?.trim();
    if (queryId && /^[a-zA-Z0-9_-]{10,120}$/.test(queryId)) {
      return queryId;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Builds a direct stream URL for a publicly shared Google Drive file
 * ("Anyone with the link can view").
 */
export function buildDirectDrivePlaybackUrl(fileId: string): string {
  const cleanId = extractDriveFileId(fileId) ?? fileId.trim();
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(cleanId)}&export=download&confirm=t`;
}

/**
 * Builds Google Drive's official embedded `/preview` player URL.
 * Works reliably on all mobile & desktop browsers without OAuth or a backend server
 * whenever Google Drive blocks direct `<audio>` / `<video>` cross-origin downloads.
 */
export function buildDrivePreviewEmbedUrl(fileId: string): string {
  const cleanId = extractDriveFileId(fileId) ?? fileId.trim();
  return `https://drive.google.com/file/d/${encodeURIComponent(cleanId)}/preview`;
}

/**
 * Validates and normalizes direct HTTPS media URLs so common cloud share links
 * (Dropbox, GitHub blob links, Cloudflare R2, Firebase Storage, CDNs) stream
 * directly inside native HTML5 `<audio>` and `<video>` elements.
 */
export function normalizeDirectMediaUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;

  const safe = sanitizeSafeUrl(trimmed);
  if (!safe) return null;

  try {
    const url = new URL(safe);
    const host = url.hostname.toLowerCase();

    // Dropbox share links -> force raw=1 direct audio/video stream
    if (host === 'www.dropbox.com' || host === 'dropbox.com') {
      url.searchParams.delete('dl');
      url.searchParams.set('raw', '1');
      const normalized = url.toString();
      return normalized.length <= MAX_MEDIA_REF_ID_LENGTH ? normalized : null;
    }

    // GitHub blob links -> raw.githubusercontent.com direct media stream
    if (host === 'github.com') {
      const blobMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (blobMatch) {
        const rawGithub = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
        return rawGithub.length <= MAX_MEDIA_REF_ID_LENGTH ? rawGithub : null;
      }
    }

    return safe.length <= MAX_MEDIA_REF_ID_LENGTH ? safe : null;
  } catch {
    return null;
  }
}

/**
 * Parses a single pasted media link inside Creator Studio's Episode Editor
 * (Google Drive file share link/ID, Dropbox share link, GitHub link, or direct HTTPS MP3/MP4 URL).
 */
export function resolveCreatorMediaInput(
  rawInput: string,
  slot: 'audio' | 'video'
): { ok: true; mediaRef: MediaRef; label: string } | { ok: false; reason: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'Paste a direct HTTPS media URL (MP3/MP4, Dropbox, Cloudflare R2) or a Google Drive file share link.',
    };
  }

  if (isGoogleDriveFolderUrl(trimmed)) {
    return {
      ok: false,
      reason:
        'That is a Google Drive folder link. Open the folder, right-click the specific audio/video file → Share → "Anyone with the link" → Copy link.',
    };
  }

  const driveId = extractDriveFileId(trimmed);
  if (driveId) {
    return {
      ok: true,
      mediaRef: { provider: 'drive', id: driveId, type: slot },
      label: `Google Drive file (${driveId.slice(0, 12)}…)`,
    };
  }

  const normalizedUrl = normalizeDirectMediaUrl(trimmed);
  if (normalizedUrl) {
    const fileLabel = normalizedUrl.split('/').pop()?.split('?')[0] || 'Direct HTTPS link';
    return {
      ok: true,
      mediaRef: { provider: 'demo', id: normalizedUrl, type: slot },
      label: `Direct HTTPS stream (${fileLabel.slice(0, 32)})`,
    };
  }

  if (/^https:\/\//i.test(trimmed) && trimmed.length > MAX_MEDIA_REF_ID_LENGTH) {
    return {
      ok: false,
      reason: `URL is longer than ${MAX_MEDIA_REF_ID_LENGTH} characters. Use a shorter CDN, Dropbox, or Google Drive file link.`,
    };
  }

  return {
    ok: false,
    reason: 'Enter a valid https:// audio/video URL (MP3, MP4, Dropbox, R2) or a Google Drive file share link.',
  };
}

function inferMediaType(hint: string | undefined, urlOrId: string): 'audio' | 'video' {
  const lowerHint = (hint ?? '').toLowerCase();
  if (lowerHint.includes('video') || lowerHint.includes('mp4') || lowerHint.includes('webm')) {
    return 'video';
  }
  if (lowerHint.includes('audio') || lowerHint.includes('mp3') || lowerHint.includes('wav')) {
    return 'audio';
  }
  if (VIDEO_EXT_REGEX.test(urlOrId)) {
    return 'video';
  }
  if (AUDIO_EXT_REGEX.test(urlOrId)) {
    return 'audio';
  }
  return 'audio';
}

/**
 * Parses a multi-line list of Google Drive file share links, Drive file IDs, Dropbox links,
 * or direct HTTPS audio/video URLs into grouped episode payloads saved directly to Firestore.
 */
export function parseBatchEpisodeLines(
  rawText: string,
  existingEpisodeNumbers: number[]
): BatchDirectImportPlan {
  const existingSet = new Set(existingEpisodeNumbers.filter((n) => Number.isInteger(n) && n > 0));
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const parsedItems: ParsedDirectMediaLine[] = [];
  const invalid: BatchDirectImportPlan['invalid'] = [];
  const skipped: BatchDirectImportPlan['skipped'] = [];

  let nextAutoEpisode =
    existingEpisodeNumbers.length > 0 ? Math.max(...existingEpisodeNumbers) + 1 : 1;

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const parts = rawLine.split('|').map((p) => p.trim()).filter(Boolean);

    let explicitEp: number | null = null;
    let explicitTypeHint: string | undefined;
    let title: string | undefined;
    let sourceToken = '';

    if (parts.length === 1) {
      sourceToken = parts[0];
    } else if (parts.length === 2) {
      const epMatch = parts[0].match(EP_PREFIX_REGEX);
      if (epMatch) {
        explicitEp = Number.parseInt(epMatch[1], 10);
        explicitTypeHint = epMatch[2];
      } else {
        title = parts[0].slice(0, 140);
      }
      sourceToken = parts[1];
    } else {
      const epMatch = parts[0].match(EP_PREFIX_REGEX);
      if (epMatch) {
        explicitEp = Number.parseInt(epMatch[1], 10);
        explicitTypeHint = epMatch[2];
        title = parts[1].slice(0, 140);
      } else {
        title = parts[0].slice(0, 140);
        explicitTypeHint = parts[1];
      }
      sourceToken = parts[parts.length - 1];
    }

    const driveId = extractDriveFileId(sourceToken);
    let provider: 'drive' | 'demo' | null = null;
    let mediaId = '';
    let displaySource = '';

    if (driveId) {
      provider = 'drive';
      mediaId = driveId;
      displaySource = `Drive (${driveId.slice(0, 10)}...)`;
    } else if (isGoogleDriveFolderUrl(sourceToken)) {
      invalid.push({
        lineNumber,
        rawLine,
        reason:
          'This is a Google Drive folder link, not a single audio/video file link. Open the folder in Google Drive, right-click each file → Share → "Anyone with the link" → Copy link, and paste one file link per line.',
      });
      return;
    } else if (/^https:\/\//i.test(sourceToken)) {
      const normalized = normalizeDirectMediaUrl(sourceToken);
      if (!normalized) {
        invalid.push({
          lineNumber,
          rawLine,
          reason:
            sourceToken.length > MAX_MEDIA_REF_ID_LENGTH
              ? `Direct HTTPS URL exceeds ${MAX_MEDIA_REF_ID_LENGTH} characters. Use a shorter CDN, Dropbox, or Google Drive file link.`
              : 'Invalid or unsafe HTTPS URL.',
        });
        return;
      }
      provider = 'demo';
      mediaId = normalized;
      displaySource = normalized.split('/').pop()?.split('?')[0] || 'Direct URL';
    } else {
      invalid.push({
        lineNumber,
        rawLine,
        reason: 'Provide a valid Google Drive file share link/ID, Dropbox link, or direct https:// media URL.',
      });
      return;
    }

    const episodeNumber = explicitEp ?? nextAutoEpisode++;
    if (episodeNumber < 1 || episodeNumber > 1000) {
      invalid.push({
        lineNumber,
        rawLine,
        reason: 'Episode number must be between 1 and 1000.',
      });
      return;
    }

    if (existingSet.has(episodeNumber)) {
      skipped.push({
        lineNumber,
        rawLine,
        episodeNumber,
        reason: `Episode ${episodeNumber} already exists in this story.`,
      });
      return;
    }

    const type = inferMediaType(explicitTypeHint ?? title, sourceToken);
    parsedItems.push({
      lineNumber,
      rawLine,
      episodeNumber,
      title,
      provider,
      id: mediaId,
      type,
      displaySource,
    });
  });

  // Group parsed audio + video items by episodeNumber
  const byEpisode = new Map<
    number,
    {
      title?: string;
      audio?: ParsedDirectMediaLine;
      video?: ParsedDirectMediaLine;
      sources: string[];
    }
  >();

  for (const item of parsedItems) {
    const entry = byEpisode.get(item.episodeNumber) ?? { sources: [] };
    if (item.title && !entry.title) {
      entry.title = item.title;
    }
    if (item.type === 'video') {
      if (!entry.video) {
        entry.video = item;
        entry.sources.push(`${item.displaySource} (video)`);
      } else {
        skipped.push({
          lineNumber: item.lineNumber,
          rawLine: item.rawLine,
          episodeNumber: item.episodeNumber,
          reason: `Duplicate video entry for Episode ${item.episodeNumber}.`,
        });
      }
    } else if (!entry.audio) {
      entry.audio = item;
      entry.sources.push(`${item.displaySource} (audio)`);
    } else {
      skipped.push({
        lineNumber: item.lineNumber,
        rawLine: item.rawLine,
        episodeNumber: item.episodeNumber,
        reason: `Duplicate audio entry for Episode ${item.episodeNumber}.`,
      });
    }
    byEpisode.set(item.episodeNumber, entry);
  }

  const groups: BatchDirectEpisodeGroup[] = [];
  for (const [episodeNumber, entry] of [...byEpisode.entries()].sort((a, b) => a[0] - b[0])) {
    const primary = entry.audio ?? entry.video;
    if (!primary) continue;

    // Firestore schema requires audioRef (type: 'audio'); if video-only, mirror primary id as audio track fallback
    const audioRef: { provider: 'drive' | 'demo'; id: string; type: 'audio' } = entry.audio
      ? { provider: entry.audio.provider, id: entry.audio.id, type: 'audio' }
      : { provider: primary.provider, id: primary.id, type: 'audio' };

    const videoMediaRef: { provider: 'drive' | 'demo'; id: string; type: 'video' } | undefined =
      entry.video
        ? { provider: entry.video.provider, id: entry.video.id, type: 'video' }
        : undefined;

    groups.push({
      episodeNumber,
      title: entry.title?.trim() || `Episode ${episodeNumber}`,
      audioRef,
      videoMediaRef,
      sources: entry.sources,
    });
  }

  return {
    groups,
    skipped,
    invalid,
    totalLines: lines.length,
  };
}
