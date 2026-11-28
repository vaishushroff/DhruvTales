import type { MediaProviderType } from '../../types';
import { DemoMediaProvider } from './DemoMediaProvider';
import { DriveProvider } from './DriveProvider';
import { GcsProvider } from './GcsProvider';
import type { MediaProvider } from './MediaProvider';
import { YouTubeProvider } from './YouTubeProvider';

const providerRegistry: Record<MediaProviderType, MediaProvider> = {
  demo: new DemoMediaProvider(),
  drive: new DriveProvider(),
  youtube: new YouTubeProvider(),
  gcs: new GcsProvider(),
};

export function getMediaProvider(type: MediaProviderType): MediaProvider {
  return providerRegistry[type];
}

export function listMediaProviders(): MediaProvider[] {
  return Object.values(providerRegistry);
}

export {
  DriveMediaError,
  DriveMediaProvider,
  importEpisodesFromDirectLinks,
  importEpisodesFromDriveFolder,
  type DriveFolderImportResult,
} from './DriveProvider';
export {
  buildDirectDrivePlaybackUrl,
  buildDrivePreviewEmbedUrl,
  extractDriveFileId,
  isGoogleDriveFolderUrl,
  normalizeDirectMediaUrl,
  parseBatchEpisodeLines,
  resolveCreatorMediaInput,
} from './driveFallback';
export {
  buildDriveCandidateUrls,
  formatRealDuration,
  inferMimeTypeFromUrl,
  isPlaceholderMediaRef,
  probeMediaMetadata,
  SUPPORTED_AUDIO_FORMAT_LABEL,
  SUPPORTED_VIDEO_FORMAT_LABEL,
  type MediaProbeResult,
} from './mediaFormats';
export type { MediaProvider, MediaPlaybackResolution, MediaUploadMetadata } from './MediaProvider';
