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
  importEpisodesFromGoogleDriveDirect,
  type DriveFolderImportResult,
} from './DriveProvider';
export {
  clearCachedDriveAccessToken,
  connectGoogleDriveAccount,
  getCachedDriveAccessToken,
  listGoogleDriveFolders,
} from './googleDriveClient';
export { extractDriveFolderId, type ClientDriveFolderItem } from './googleDriveParser';
export { parseBatchEpisodeLines } from './driveFallback';
export type { MediaProvider, MediaPlaybackResolution, MediaUploadMetadata } from './MediaProvider';
