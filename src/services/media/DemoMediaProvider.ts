import type { Episode, MediaRef, UserProfile } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';
import {
  buildDrivePreviewEmbedUrl,
  extractDriveFileId,
  normalizeDirectMediaUrl,
} from './driveFallback';
import { buildDriveCandidateUrls, inferMimeTypeFromUrl } from './mediaFormats';
import type {
  MediaPlaybackResolution,
  MediaProvider,
  MediaUploadMetadata,
} from './MediaProvider';

/**
 * Direct MediaProvider adapter (registered under legacy key `'demo'` for
 * backwards compatibility with existing Firestore documents).
 *
 * Supports all web audio formats (MP3, M4A, AAC, WAV, OGG, OPUS, FLAC, WebM, etc.)
 * and all web video formats (MP4, WebM, MOV, MKV, M4V, OGV, 3GP, AVI) via direct
 * HTTPS URLs (Cloudflare R2, Dropbox, GitHub raw, Firebase Storage, CDNs) as well
 * as automatic recovery for Google Drive links stored under `provider: 'demo'`.
 */

const localFileRegistry = new Map<string, { url: string; mimeType: string; name: string }>();

export class DemoMediaProvider implements MediaProvider {
  readonly providerType = 'demo' as const;
  readonly displayName = 'Direct Media Provider (All Audio & Video Formats)';
  readonly isImplemented = true;
  readonly isProductionProtected = false;

  async checkAccess(
    mediaRef: MediaRef,
    user: UserProfile | null,
    _episode?: Episode
  ): Promise<boolean> {
    if (user?.isDisabled || user?.banned) {
      return false;
    }
    return mediaRef.provider === 'demo' && mediaRef.id.trim().length > 0;
  }

  async getPlaybackUrl(
    mediaRef: MediaRef,
    user: UserProfile | null,
    episode?: Episode
  ): Promise<MediaPlaybackResolution> {
    const allowed = await this.checkAccess(mediaRef, user, episode);
    if (!allowed) {
      throw new Error('Playback authorization denied.');
    }

    const rawId = mediaRef.id.trim();

    // 1. Active session local file if explicitly provided
    const localFile = localFileRegistry.get(rawId);
    if (localFile) {
      return {
        url: localFile.url,
        mimeType: localFile.mimeType,
        provider: 'demo',
        isSimulatedMedia: false,
        isProductionProtected: false,
        label: `Local file: ${localFile.name}`,
      };
    }

    // 2. Auto-detect Google Drive links/IDs even if saved under legacy 'demo' provider
    const driveFileId = extractDriveFileId(rawId);
    if (driveFileId) {
      const [primaryUrl, ...fallbackUrls] = buildDriveCandidateUrls(driveFileId);
      return {
        url: primaryUrl,
        fallbackUrls,
        embedFallbackUrl: buildDrivePreviewEmbedUrl(driveFileId),
        mimeType: mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg',
        provider: 'drive',
        isSimulatedMedia: false,
        isProductionProtected: false,
        label: 'Google Drive (Direct shared playback)',
      };
    }

    // 3. Direct validated HTTPS hosted media URL (all audio & video formats)
    if (/^https:\/\//i.test(rawId)) {
      const safeExternalUrl = normalizeDirectMediaUrl(rawId) ?? sanitizeSafeUrl(rawId);
      if (!safeExternalUrl) {
        throw new Error('Blocked unsafe external media URL.');
      }
      return {
        url: safeExternalUrl,
        mimeType: inferMimeTypeFromUrl(safeExternalUrl, mediaRef.type),
        provider: 'demo',
        isSimulatedMedia: false,
        isProductionProtected: false,
        label: mediaRef.type === 'video' ? 'Direct HTTPS Video Stream' : 'Direct HTTPS Audio Stream',
      };
    }

    throw new Error(
      'No audio or video link is attached to this episode yet. Open Creator Studio → Edit Episode and paste a valid audio or video link.'
    );
  }

  async upload(file: File, metadata?: MediaUploadMetadata): Promise<MediaRef> {
    const id = `local-${metadata?.episodeId ?? 'file'}-${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    localFileRegistry.set(id, {
      url: objectUrl,
      mimeType: file.type || inferMimeTypeFromUrl(file.name, 'audio'),
      name: file.name,
    });
    return {
      provider: 'demo',
      id,
      type: file.type.startsWith('video/') ? 'video' : 'audio',
    };
  }
}
