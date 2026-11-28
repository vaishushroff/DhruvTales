const DRIVE_FOLDER_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;

/**
 * Extracts a validated Google Drive folder ID from either a raw folder ID
 * or a standard Google Drive folder URL.
 */
export function extractDriveFolderId(rawInput: string): string | null {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return null;

  if (DRIVE_FOLDER_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.hostname !== 'drive.google.com' &&
      parsed.hostname !== 'www.drive.google.com'
    ) {
      return null;
    }

    const folderMatch = /\/folders\/([a-zA-Z0-9_-]{10,120})/.exec(parsed.pathname);
    if (folderMatch?.[1]) {
      return folderMatch[1];
    }

    const queryId = parsed.searchParams.get('id')?.trim() ?? '';
    if (DRIVE_FOLDER_ID_REGEX.test(queryId)) {
      return queryId;
    }
  } catch {
    return null;
  }

  return null;
}

export interface ClientDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
}

export interface ClientDriveFolderItem {
  id: string;
  name: string;
  modifiedTime?: string;
}

export interface PlannedClientEpisode {
  episodeNumber: number;
  title: string;
  audioFile?: ClientDriveFileItem;
  videoFile?: ClientDriveFileItem;
  estimatedDurationSec: number;
}

export interface PlannedClientImportResult {
  toCreate: PlannedClientEpisode[];
  skipped: Array<{
    fileId: string;
    fileName: string;
    episodeNumber: number;
    reason: string;
  }>;
  invalid: Array<{
    fileId: string;
    fileName: string;
    reason: string;
  }>;
}

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv']);

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).trim().toLowerCase();
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot > 0 ? filename.slice(0, dot) : filename).trim();
}

function cleanTitle(raw: string, fallbackEpisodeNumber: number): string {
  const cleaned = raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 140) : `Episode ${fallbackEpisodeNumber}`;
}

export function detectDriveFileMediaSlot(
  file: Pick<ClientDriveFileItem, 'name' | 'mimeType'>
): 'audio' | 'video' | null {
  const ext = getExtension(file.name);
  const mime = (file.mimeType || '').toLowerCase();
  const baseLower = stripExtension(file.name).toLowerCase();

  // Explicit _audio / _video naming convention takes priority (e.g. EP01_audio.webm)
  if (/_audio$/i.test(baseLower) || /\baudio\b/i.test(baseLower)) {
    if (AUDIO_EXTS.has(ext) || ext === 'webm' || mime.startsWith('audio/')) {
      return 'audio';
    }
  }
  if (/_video$/i.test(baseLower) || /\bvideo\b/i.test(baseLower)) {
    if (VIDEO_EXTS.has(ext) || mime.startsWith('video/')) {
      return 'video';
    }
  }

  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) {
    return 'audio';
  }
  return null;
}

export function parseFlexibleDriveFilename(file: ClientDriveFileItem): {
  slot: 'audio' | 'video' | null;
  explicitEpisodeNumber: number | null;
  inferredTitle: string | null;
} {
  const slot = detectDriveFileMediaSlot(file);
  if (!slot) {
    return { slot: null, explicitEpisodeNumber: null, inferredTitle: null };
  }

  const base = stripExtension(file.name);

  // 1. Canonical format: EP01_audio.mp3 or EP01_video.mp4
  const canonical = /^ep[\s_-]*0*(\d{1,4})(?:[\s_-]*(?:audio|video))$/i.exec(base);
  if (canonical) {
    const epNum = Number.parseInt(canonical[1], 10);
    return {
      slot,
      explicitEpisodeNumber: epNum >= 1 && epNum <= 1000 ? epNum : null,
      inferredTitle: null,
    };
  }

  // 2. Named episode prefix: "EP01 - First Dawn", "Episode 2: The Storm", "03_Moonlight"
  const epPrefixed = /^(?:episode|ep)[\s._-]*0*(\d{1,4})(?:[\s._:\-–—]+(.*))?$/i.exec(base);
  if (epPrefixed) {
    const epNum = Number.parseInt(epPrefixed[1], 10);
    const rest = (epPrefixed[2] ?? '')
      .replace(/^(?:audio|video)[\s._\-–—]*/i, '')
      .replace(/[\s._\-–—]*(?:audio|video)$/i, '')
      .trim();
    return {
      slot,
      explicitEpisodeNumber: epNum >= 1 && epNum <= 1000 ? epNum : null,
      inferredTitle: rest ? cleanTitle(rest, epNum) : null,
    };
  }

  // 3. Numeric leading prefix: "01 - Opening Chapter" or "2. Whisper"
  const numericPrefix = /^0*(\d{1,4})[\s._:\-–—]+(.+)$/.exec(base);
  if (numericPrefix) {
    const epNum = Number.parseInt(numericPrefix[1], 10);
    const rest = numericPrefix[2]
      .replace(/[\s._\-–—]*(?:audio|video)$/i, '')
      .trim();
    return {
      slot,
      explicitEpisodeNumber: epNum >= 1 && epNum <= 1000 ? epNum : null,
      inferredTitle: rest ? cleanTitle(rest, epNum) : null,
    };
  }

  // 4. Plain filename without episode number (auto-numbered sequentially)
  const plainTitle = base
    .replace(/[\s._\-–—]*(?:audio|video)$/i, '')
    .trim();
  return {
    slot,
    explicitEpisodeNumber: null,
    inferredTitle: plainTitle ? plainTitle.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : null,
  };
}

/**
 * Flexible Google Drive folder planner that handles BOTH strict naming
 * (`EP01_audio.mp3`, `EP01_video.mp4`) AND natural creator filenames
 * (`Episode 1 - Awakening.mp3`, `Chapter One.mp4`), grouping matching episode
 * numbers into hybrid audio+video episodes and skipping duplicates cleanly.
 */
export function planClientDriveFolderImport(
  files: ClientDriveFileItem[],
  existingEpisodeNumbers: Set<number>
): PlannedClientImportResult {
  const skipped: PlannedClientImportResult['skipped'] = [];
  const invalid: PlannedClientImportResult['invalid'] = [];
  const grouped = new Map<
    number,
    {
      title?: string;
      audioFile?: ClientDriveFileItem;
      videoFile?: ClientDriveFileItem;
    }
  >();

  // Sort deterministically by name so auto-numbered files get a stable order
  const sortedFiles = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  const usedNumbers = new Set<number>(existingEpisodeNumbers);
  const unnumbered: Array<{
    file: ClientDriveFileItem;
    slot: 'audio' | 'video';
    inferredTitle: string | null;
  }> = [];

  for (const file of sortedFiles) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      continue;
    }

    const parsed = parseFlexibleDriveFilename(file);
    if (!parsed.slot) {
      invalid.push({
        fileId: file.id,
        fileName: file.name,
        reason: 'Unsupported file type (upload MP3, M4A, WAV, OGG, AAC, MP4, WEBM, or MOV audio/video files).',
      });
      continue;
    }

    if (parsed.explicitEpisodeNumber === null) {
      unnumbered.push({
        file,
        slot: parsed.slot,
        inferredTitle: parsed.inferredTitle,
      });
      continue;
    }

    const epNum = parsed.explicitEpisodeNumber;
    if (existingEpisodeNumbers.has(epNum)) {
      skipped.push({
        fileId: file.id,
        fileName: file.name,
        episodeNumber: epNum,
        reason: `Episode ${epNum} already exists in this story.`,
      });
      continue;
    }

    usedNumbers.add(epNum);
    const bucket = grouped.get(epNum) ?? {};
    if (parsed.inferredTitle && !bucket.title) {
      bucket.title = parsed.inferredTitle;
    }

    if (parsed.slot === 'audio') {
      if (bucket.audioFile) {
        skipped.push({
          fileId: file.id,
          fileName: file.name,
          episodeNumber: epNum,
          reason: `Duplicate audio file for Episode ${epNum} (already matched ${bucket.audioFile.name}).`,
        });
      } else {
        bucket.audioFile = file;
      }
    } else if (bucket.videoFile) {
      skipped.push({
        fileId: file.id,
        fileName: file.name,
        episodeNumber: epNum,
        reason: `Duplicate video file for Episode ${epNum} (already matched ${bucket.videoFile.name}).`,
      });
    } else {
      bucket.videoFile = file;
    }

    grouped.set(epNum, bucket);
  }

  // Auto-assign sequential episode numbers for unnumbered audio/video files
  let nextAuto =
    usedNumbers.size > 0 ? Math.max(...Array.from(usedNumbers)) + 1 : 1;

  for (const item of unnumbered) {
    while (usedNumbers.has(nextAuto)) {
      nextAuto += 1;
    }
    if (nextAuto > 1000) {
      invalid.push({
        fileId: item.file.id,
        fileName: item.file.name,
        reason: 'Maximum limit of 1000 episodes per story reached.',
      });
      continue;
    }
    const epNum = nextAuto;
    usedNumbers.add(epNum);
    nextAuto += 1;

    grouped.set(epNum, {
      title: item.inferredTitle || `Episode ${epNum}`,
      audioFile: item.slot === 'audio' ? item.file : undefined,
      videoFile: item.slot === 'video' ? item.file : undefined,
    });
  }

  const toCreate: PlannedClientEpisode[] = Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([episodeNumber, bucket]) => {
      const videoDur = bucket.videoFile?.durationSec;
      const audioDur = bucket.audioFile?.durationSec;
      const estimatedDurationSec =
        typeof videoDur === 'number' && videoDur >= 1
          ? Math.min(86400, Math.round(videoDur))
          : typeof audioDur === 'number' && audioDur >= 1
            ? Math.min(86400, Math.round(audioDur))
            : 180;

      return {
        episodeNumber,
        title: bucket.title?.trim() || `Episode ${episodeNumber}`,
        audioFile: bucket.audioFile,
        videoFile: bucket.videoFile,
        estimatedDurationSec,
      };
    });

  return { toCreate, skipped, invalid };
}
