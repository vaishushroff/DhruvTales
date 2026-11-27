import type { Episode, MediaRef, UserProfile } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';
import type {
  MediaPlaybackResolution,
  MediaProvider,
  MediaUploadMetadata,
} from './MediaProvider';

/**
 * Direct / Local MediaProvider adapter (registered under legacy key `'demo'` for
 * backwards compatibility with existing Firestore documents).
 *
 * - Supports real browser-local uploaded files during an active Creator Studio session
 *   (`URL.createObjectURL(file)`).
 * - Supports real direct HTTPS hosted audio/video URLs (e.g., CDN / Cloudflare R2 /
 *   Firebase Storage / S3 links stored in `mediaRef.id`).
 * - Does NOT synthesize fake WAV audio or play placeholder demo videos.
 */

const localFileRegistry = new Map<string, { url: string; mimeType: string; name: string }>();

export class DemoMediaProvider implements MediaProvider {
  readonly providerType = 'demo' as const;
  readonly displayName = 'Direct Media Provider (HTTPS / Studio Local Preview)';
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

    // 1. Browser-local uploaded file from active Creator Studio session
    const localFile = localFileRegistry.get(mediaRef.id);
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

    // 2. Direct validated HTTPS hosted media URL (CDN / R2 / Firebase Storage / S3)
    if (/^https:\/\//i.test(mediaRef.id.trim())) {
      const safeExternalUrl = sanitizeSafeUrl(mediaRef.id.trim());
      if (!safeExternalUrl) {
        throw new Error('Blocked unsafe external media URL.');
      }
      return {
        url: safeExternalUrl,
        mimeType: mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg',
        provider: 'demo',
        isSimulatedMedia: false,
        isProductionProtected: false,
        label: mediaRef.type === 'video' ? 'Direct HTTPS Video Stream' : 'Direct HTTPS Audio Stream',
      };
    }

    // 3. No synthesized/demo fallback — require real uploaded media
    throw new Error(
      'Audio or video media has not been uploaded for this episode yet. Attach a Google Drive file or direct HTTPS media URL in Creator Studio.'
    );
  }

  async upload(file: File, metadata?: MediaUploadMetadata): Promise<MediaRef> {
    const id = `local-${metadata?.episodeId ?? 'file'}-${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    localFileRegistry.set(id, {
      url: objectUrl,
      mimeType: file.type || 'audio/mpeg',
      name: file.name,
    });
    return {
      provider: 'demo',
      id,
      type: file.type.startsWith('video/') ? 'video' : 'audio',
    };
  }
}
