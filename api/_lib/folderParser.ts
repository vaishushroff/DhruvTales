/**
 * Google Drive folder file naming parser and episode grouping logic.
 *
 * Naming convention:
 *   EP01_audio.mp3   (audio track for Episode 1)
 *   EP01_video.mp4   (video track for Episode 1)
 *
 * Audio and video files sharing the same episode number are merged into ONE
 * episode document with both `audioRef` and `videoMediaRef`.
 */

export interface DriveFolderFileItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
}

export interface ParsedEpisodeFile {
  episodeNumber: number;
  slot: 'audio' | 'video';
  extension: string;
}

export interface PlannedEpisodeImport {
  episodeNumber: number;
  audioFile?: DriveFolderFileItem;
  videoFile?: DriveFolderFileItem;
  estimatedDurationSec: number;
}

export interface SkippedImportItem {
  fileId: string;
  fileName: string;
  episodeNumber: number;
  reason: string;
}

export interface InvalidImportItem {
  fileId: string;
  fileName: string;
  reason: string;
}

export interface FolderImportPlan {
  toCreate: PlannedEpisodeImport[];
  skipped: SkippedImportItem[];
  invalid: InvalidImportItem[];
}

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'wav',
  'ogg',
  'aac',
  'flac',
  'opus',
  'webm',
]);

const ALLOWED_VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
]);

const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;

/**
 * Extracts a validated Google Drive folder ID from either a raw folder ID
 * or a standard Google Drive folder URL.
 */
export function extractDriveFolderId(rawInput: string): string | null {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return null;

  if (DRIVE_ID_REGEX.test(trimmed)) {
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
    if (DRIVE_ID_REGEX.test(queryId)) {
      return queryId;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Parses a single filename against `EP01_audio.mp3` / `EP01_video.mp4`.
 */
export function parseEpisodeMediaFilename(
  filename: string
): { ok: true; parsed: ParsedEpisodeFile } | { ok: false; reason: string } {
  const trimmed = filename.trim();
  const match = /^ep(\d{1,4})_(audio|video)\.([a-z0-9]{2,5})$/i.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      reason: 'Expected naming format EP01_audio.mp3 or EP01_video.mp4',
    };
  }

  const episodeNumber = Number.parseInt(match[1], 10);
  const slot = match[2].toLowerCase() as 'audio' | 'video';
  const extension = match[3].toLowerCase();

  if (!Number.isFinite(episodeNumber) || episodeNumber < 1 || episodeNumber > 1000) {
    return {
      ok: false,
      reason: 'Episode number must be between 1 and 1000',
    };
  }

  if (slot === 'audio' && !ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      reason: `Unsupported audio extension .${extension} (use mp3, m4a, wav, ogg, aac, flac, opus, webm)`,
    };
  }

  if (slot === 'video' && !ALLOWED_VIDEO_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      reason: `Unsupported video extension .${extension} (use mp4, webm, mov, m4v)`,
    };
  }

  return {
    ok: true,
    parsed: {
      episodeNumber,
      slot,
      extension,
    },
  };
}

/**
 * Groups Drive folder files by episode number, merging audio + video for the same
 * episode number into a single draft episode, skipping episode numbers that already
 * exist on the story, and reporting invalid filenames clearly.
 */
export function planFolderImport(
  files: DriveFolderFileItem[],
  existingEpisodeNumbers: Set<number>
): FolderImportPlan {
  const grouped = new Map<
    number,
    { audioFile?: DriveFolderFileItem; videoFile?: DriveFolderFileItem }
  >();
  const skipped: SkippedImportItem[] = [];
  const invalid: InvalidImportItem[] = [];

  for (const file of files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      continue;
    }

    const parsedResult = parseEpisodeMediaFilename(file.name);
    if (!parsedResult.ok) {
      invalid.push({
        fileId: file.id,
        fileName: file.name,
        reason: parsedResult.reason,
      });
      continue;
    }

    const { episodeNumber, slot } = parsedResult.parsed;

    if (existingEpisodeNumbers.has(episodeNumber)) {
      skipped.push({
        fileId: file.id,
        fileName: file.name,
        episodeNumber,
        reason: `Episode ${episodeNumber} already exists in this story`,
      });
      continue;
    }

    const bucket = grouped.get(episodeNumber) ?? {};
    if (slot === 'audio') {
      if (bucket.audioFile) {
        invalid.push({
          fileId: file.id,
          fileName: file.name,
          reason: `Duplicate audio file for Episode ${episodeNumber} (already matched ${bucket.audioFile.name})`,
        });
        continue;
      }
      bucket.audioFile = file;
    } else {
      if (bucket.videoFile) {
        invalid.push({
          fileId: file.id,
          fileName: file.name,
          reason: `Duplicate video file for Episode ${episodeNumber} (already matched ${bucket.videoFile.name})`,
        });
        continue;
      }
      bucket.videoFile = file;
    }

    grouped.set(episodeNumber, bucket);
  }

  const toCreate: PlannedEpisodeImport[] = Array.from(grouped.entries())
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
        audioFile: bucket.audioFile,
        videoFile: bucket.videoFile,
        estimatedDurationSec,
      };
    });

  return {
    toCreate,
    skipped,
    invalid,
  };
}
