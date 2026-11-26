import type { Episode, MediaRef, UserProfile } from '../../types';
import { sanitizeSafeUrl } from '../../utils/validation';
import type {
  MediaPlaybackResolution,
  MediaProvider,
  MediaUploadMetadata,
} from './MediaProvider';

/**
 * DemoMediaProvider
 * -----------------
 * SIMULATED / DEMO storage adapter.
 * 1. For audio (`mediaRef.type === 'audio'`): generates deterministic, pleasant atmospheric
 *    40-second PCM WAV audio blobs in-browser so playback, seeking, speed control, and
 *    MediaSession work reliably offline without locking into external storage.
 * 2. For video (`mediaRef.type === 'video'`): resolves deterministic 40-second sample
 *    video streams (`/demo-media/*.mp4` or `.webm` based on browser codec support) so
 *    HTML5 video playback, Audio ⇄ Video switching, fullscreen, and Picture-in-Picture
 *    work smoothly across Chrome, Safari, Firefox, mobile, and headless Chromium while
 *    keeping external cloud storage undecided.
 * 3. Also supports browser-local audio/video files uploaded via `upload(file)` using
 *    `URL.createObjectURL(file)`.
 *
 * NOTE: Demo content protection is NOT production DRM. Real signed URLs / tokenized
 * streaming belong in a backend-backed production MediaProvider (e.g., GcsProvider).
 */

const localFileRegistry = new Map<string, { url: string; mimeType: string; name: string }>();
const generatedTrackCache = new Map<string, string>();

const SAMPLE_VIDEO_CLIPS: ReadonlyArray<{ base: string; label: string }> = [
  {
    base: '/demo-media/kaalchakra-chapter',
    label: 'Demo Video Chapter · Celestial Motion Stream (DemoMediaProvider)',
  },
  {
    base: '/demo-media/indiranagar-chapter',
    label: 'Demo Video Chapter · Noir Motion Stream (DemoMediaProvider)',
  },
];

function pickSupportedVideoFormat(): { ext: 'mp4' | 'webm'; mimeType: string } {
  if (typeof document !== 'undefined') {
    const probe = document.createElement('video');
    if (probe.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')) {
      return { ext: 'mp4', mimeType: 'video/mp4' };
    }
    if (probe.canPlayType('video/webm; codecs="vp8, opus"') || probe.canPlayType('video/webm')) {
      return { ext: 'webm', mimeType: 'video/webm' };
    }
  }
  return { ext: 'mp4', mimeType: 'video/mp4' };
}

const CHORD_PALETTES: number[][] = [
  [146.83, 220.0, 261.63, 329.63], // D minor 7 (cinematic mythology)
  [130.81, 196.0, 246.94, 293.66], // C major 9 (warm romance)
  [110.0, 164.81, 207.65, 261.63], // A minor suspense (thriller)
  [98.0, 146.83, 185.0, 233.08], // G moody (horror/mystery)
  [174.61, 220.0, 261.63, 349.23], // F major warm (kids/motivation)
  [164.81, 246.94, 293.66, 392.0], // E minor 7 (crime noir)
];

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Generates a smooth, rich 40-second ambient soundtrack WAV Blob URL
 * with gentle breathing chord swells and soft narrative chime accents.
 */
function buildAmbientWavBlobUrl(trackId: string): string {
  const cached = generatedTrackCache.get(trackId);
  if (cached) return cached;

  const sampleRate = 16000;
  const durationSeconds = 40;
  const totalSamples = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // Standard RIFF/WAVE PCM header (mono 16-bit)
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  const seed = hashString(trackId);
  const baseChord = CHORD_PALETTES[seed % CHORD_PALETTES.length];
  const altChord = CHORD_PALETTES[(seed + 2) % CHORD_PALETTES.length];
  const tempoCycle = 6; // 6-second chord phrases

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const phraseIndex = Math.floor(t / tempoCycle);
    const phrasePos = (t % tempoCycle) / tempoCycle;
    const chord = phraseIndex % 2 === 0 ? baseChord : altChord;

    // Gentle swell envelope per phrase
    const swell = Math.sin(Math.PI * phrasePos) * 0.72 + 0.28;
    // Fade in / out at track edges
    const edgeFade =
      t < 0.8 ? t / 0.8 : t > durationSeconds - 1.2 ? (durationSeconds - t) / 1.2 : 1;

    let sample = 0;
    for (let n = 0; n < chord.length; n++) {
      const freq = chord[n];
      const weight = n === 0 ? 0.34 : 0.2;
      sample += Math.sin(2 * Math.PI * freq * t) * weight;
      // Subtle warm harmonic overtone
      sample += Math.sin(2 * Math.PI * (freq * 2) * t) * (weight * 0.14);
    }

    // Soft pluck accent at phrase start
    const pluckEnv = Math.exp(-phrasePos * 9);
    const melodyFreq = chord[(phraseIndex + 1) % chord.length] * 2;
    sample += Math.sin(2 * Math.PI * melodyFreq * t) * pluckEnv * 0.16;

    const clamped = Math.max(-0.92, Math.min(0.92, sample * swell * edgeFade * 0.42));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  generatedTrackCache.set(trackId, url);
  return url;
}

export class DemoMediaProvider implements MediaProvider {
  readonly providerType = 'demo' as const;
  readonly displayName = 'DemoMediaProvider (Local / Sample Streams)';
  readonly isImplemented = true;
  /** Demo media playback is NOT protected by DRM or backend signed URLs. */
  readonly isProductionProtected = false;

  async checkAccess(
    mediaRef: MediaRef,
    user: UserProfile | null,
    _episode?: Episode
  ): Promise<boolean> {
    // Reject disabled accounts even in demo mode; full paid DRM requires a backend provider.
    if (user?.isDisabled) {
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
      throw new Error('Playback authorization denied by MediaProvider.');
    }

    // 1. Check browser-local uploaded files first
    const localFile = localFileRegistry.get(mediaRef.id);
    if (localFile) {
      return {
        url: localFile.url,
        mimeType: localFile.mimeType,
        provider: 'demo',
        isSimulatedMedia: true,
        isProductionProtected: false,
        label: `Local file: ${localFile.name} (Demo — unprotected local preview)`,
      };
    }

    // 2. Support explicit https demo sample if encoded in mediaRef.id (strictly validated)
    if (mediaRef.id.startsWith('https://')) {
      const safeExternalUrl = sanitizeSafeUrl(mediaRef.id);
      if (!safeExternalUrl) {
        throw new Error('Blocked unsafe external media URL.');
      }
      return {
        url: safeExternalUrl,
        mimeType: mediaRef.type === 'video' ? 'video/mp4' : 'audio/mpeg',
        provider: 'demo',
        isSimulatedMedia: true,
        isProductionProtected: false,
        label: 'Public sample media stream (Demo — not production DRM)',
      };
    }

    // 3. Video refs resolve deterministically to codec-matched 40s sample video streams
    if (mediaRef.type === 'video') {
      const { ext, mimeType } = pickSupportedVideoFormat();
      const clip = mediaRef.id.includes('kaalchakra')
        ? SAMPLE_VIDEO_CLIPS[0]
        : mediaRef.id.includes('indiranagar')
          ? SAMPLE_VIDEO_CLIPS[1]
          : SAMPLE_VIDEO_CLIPS[hashString(mediaRef.id) % SAMPLE_VIDEO_CLIPS.length];
      return {
        url: `${clip.base}.${ext}`,
        mimeType,
        provider: 'demo',
        isSimulatedMedia: true,
        isProductionProtected: false,
        label: `${clip.label} (${ext.toUpperCase()} · Demo only, not DRM-protected)`,
      };
    }

    // 4. Default deterministic in-browser atmospheric audio track
    const wavUrl = buildAmbientWavBlobUrl(mediaRef.id);
    return {
      url: wavUrl,
      mimeType: 'audio/wav',
      provider: 'demo',
      isSimulatedMedia: true,
      isProductionProtected: false,
      label: `Demo Audio Bed (${mediaRef.id} · Not production DRM)`,
    };
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
