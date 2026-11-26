import type { Episode, MediaProviderType, MediaRef, UserProfile } from '../../types';

export interface MediaPlaybackResolution {
  url: string;
  mimeType: string;
  provider: MediaProviderType;
  isSimulatedMedia: boolean;
  /**
   * Explicitly indicates whether playback URLs are protected by production-grade
   * server-minted signed URLs / DRM. DemoMediaProvider ALWAYS sets this to false.
   */
  isProductionProtected?: boolean;
  /** Optional Unix epoch ms when a short-lived signed playback URL expires */
  expiresAt?: number;
  label: string;
}

export interface MediaUploadMetadata {
  storyId?: string;
  episodeId?: string;
  title?: string;
}

/**
 * Provider-agnostic MediaProvider contract.
 * Episodes store only `mediaRef: { provider, id, type }` — never hardcoded cloud URLs.
 *
 * PLAYBACK AUTHORIZATION BOUNDARY:
 * - `checkAccess(mediaRef, user, episode)` is the dedicated authorization interface.
 * - In `DemoMediaProvider`, checks run client-side only for demo UX and are NOT
 *   production-grade media protection (no DRM, no expiring signed URLs).
 * - Before public launch, implement a production adapter (e.g., GcsProvider /
 *   Cloudflare Stream) whose `getPlaybackUrl()` exchanges a Firebase ID token on a
 *   trusted backend for a short-lived signed playback URL after verifying entitlement.
 */
export interface MediaProvider {
  readonly providerType: MediaProviderType;
  readonly displayName: string;
  readonly isImplemented: boolean;
  readonly isProductionProtected?: boolean;

  checkAccess(mediaRef: MediaRef, user: UserProfile | null, episode?: Episode): Promise<boolean>;

  getPlaybackUrl(
    mediaRef: MediaRef,
    user: UserProfile | null,
    episode?: Episode
  ): Promise<MediaPlaybackResolution>;

  upload(file: File, metadata?: MediaUploadMetadata): Promise<MediaRef>;
}
