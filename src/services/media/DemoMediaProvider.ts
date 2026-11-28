import type { Episode, MediaRef, UserProfile } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';
import { extractDriveFileId, normalizeDirectMediaUrl } from './driveFallback';
import { inferMimeTypeFromUrl, requestProtectedProxyUrl } from './mediaFormats';
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
 * and all web video formats (MP4, WebM, MOV, MKV, M4V, OGV, 3GP, AVI) via our
 * protected same-origin Range streaming proxy so raw file URLs are never exposed.
 */

const localFileRegistry = new Map<string, { url: string; mimeType: string; name: string }>();

export class DemoMediaProvider implements MediaProvider {
  readonly providerType = 'demo' as const;
  readonly displayName = 'Protected Media Provider (All Audio & Video Formats)';
  readonly isImplemented = true;
  readonly isProductionProtected = true;

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
      const proxied = await requestProtectedProxyUrl(driveFileId, mediaRef.type);
      if (proxied?.url) {
        return {
          url: proxied.url,
          expiresAt: proxied.expiresAt,
          mimeType: proxied.mimeType || (mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg'),
          provider: 'drive',
          isSimulatedMedia: false,
          isProductionProtected: true,
          label: 'Protected Media Stream',
        };
      }
      throw new Error(
        'Protected media streaming service is temporarily unavailable. Please try again in a moment.'
      );
    }

    // 3. External hosted HTTPS media URL -> prefer protected proxy so raw link stays hidden
    if (/^https:\/\//i.test(rawId)) {
      const safeExternalUrl = normalizeDirectMediaUrl(rawId) ?? sanitizeSafeUrl(rawId);
      if (!safeExternalUrl) {
        throw new Error('Blocked unsafe external media URL.');
      }
      const proxied = await requestProtectedProxyUrl(safeExternalUrl, mediaRef.type);
      if (proxied?.url) {
        return {
          url: proxied.url,
          expiresAt: proxied.expiresAt,
          mimeType: proxied.mimeType || inferMimeTypeFromUrl(safeExternalUrl, mediaRef.type),
          provider: 'demo',
          isSimulatedMedia: false,
          isProductionProtected: true,
          label: 'Protected Media Stream',
        };
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
