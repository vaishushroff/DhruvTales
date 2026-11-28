import type { MediaRef } from '../../types';
import { resolveApiUrl } from '../api/apiClient';
import {
  buildDirectDrivePlaybackUrl,
  extractDriveFileId,
  normalizeDirectMediaUrl,
} from './driveFallback';

export const ALL_AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  webm: 'audio/webm',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  wma: 'audio/x-ms-wma',
  mka: 'audio/x-matroska',
};

export const ALL_VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  flv: 'video/x-flv',
  m3u8: 'application/vnd.apple.mpegurl',
};

export const SUPPORTED_AUDIO_FORMAT_LABEL =
  'MP3, M4A, AAC, WAV, OGG, OPUS, FLAC, WebM, AIFF, 3GP';

export const SUPPORTED_VIDEO_FORMAT_LABEL =
  'MP4, WebM, MOV, MKV, M4V, OGV, 3GP, AVI';

export function extractFileExtension(urlOrPath: string): string {
  const cleaned = urlOrPath.trim().split('#')[0]?.split('?')[0] ?? '';
  const lastSegment = cleaned.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot < 0 || dot === lastSegment.length - 1) return '';
  return lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * Infers the exact audio or video MIME type from any URL or filename extension
 * across all modern web audio and video formats.
 */
export function inferMimeTypeFromUrl(
  urlOrPath: string,
  slot: 'audio' | 'video'
): string {
  const ext = extractFileExtension(urlOrPath);
  if (slot === 'video') {
    return ALL_VIDEO_MIME_BY_EXT[ext] ?? ALL_AUDIO_MIME_BY_EXT[ext] ?? 'video/mp4';
  }
  return ALL_AUDIO_MIME_BY_EXT[ext] ?? ALL_VIDEO_MIME_BY_EXT[ext] ?? 'audio/mpeg';
}

/**
 * Returns an ordered list of direct stream URLs to attempt for a Google Drive file ID
 * before falling back to Google Drive's universal embedded `/preview` player.
 */
export function buildDriveCandidateUrls(fileId: string): string[] {
  const cleanId = extractDriveFileId(fileId) ?? fileId.trim();
  const encoded = encodeURIComponent(cleanId);
  return [
    buildDirectDrivePlaybackUrl(cleanId),
    `https://drive.google.com/uc?export=open&id=${encoded}`,
    `https://docs.google.com/uc?export=open&id=${encoded}`,
  ];
}

/**
 * Returns true if the MediaRef is an unattached placeholder or expired temporary local preview.
 */
export function isPlaceholderMediaRef(ref: MediaRef | null | undefined): boolean {
  if (!ref || !ref.id.trim()) return true;
  const id = ref.id.trim();
  if (ref.provider === 'demo') {
    if (id.startsWith('demo-audio-') || id.startsWith('demo-video-') || id.startsWith('local-')) {
      return true;
    }
    return !/^https:\/\//i.test(id) && !extractDriveFileId(id);
  }
  return false;
}

/**
 * Formats seconds into human-readable m:ss or h:mm:ss without truncating or capping duration.
 */
export function formatRealDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.max(1, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export interface ProtectedProxyStreamInfo {
  url: string;
  expiresAt?: number;
  mimeType?: string;
}

/**
 * Exchanges a Google Drive ID/link or external HTTPS media URL for a short-lived,
 * HMAC-signed same-origin `/api/media/proxy?token=...` stream URL.
 * Works on both Node/Vercel/Cloud Run (`server.ts`) and Cloudflare Workers (`worker.ts`).
 */
export async function requestProtectedProxyUrl(
  mediaId: string,
  format: 'audio' | 'video'
): Promise<ProtectedProxyStreamInfo | null> {
  const trimmed = mediaId.trim();
  if (!trimmed) return null;

  try {
    const res = await fetch(resolveApiUrl('/api/media/proxy-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId: trimmed, format }),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    const data = (await res.json()) as {
      url?: string;
      expiresAt?: number;
      mimeType?: string;
    };
    if (!data.url || !data.url.startsWith('/api/media/proxy')) return null;
    return {
      url: resolveApiUrl(data.url),
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : undefined,
      mimeType: data.mimeType,
    };
  } catch {
    return null;
  }
}

export type MediaProbeResult =
  | {
      status: 'verified';
      durationSec: number;
      width?: number;
      height?: number;
      resolvedUrl: string;
    }
  | {
      status: 'unverified';
      reason: string;
    };

function probeSingleUrlInBrowser(
  url: string,
  slot: 'audio' | 'video',
  timeoutMs: number
): Promise<{ durationSec: number; width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Browser environment required to inspect media.'));
      return;
    }

    const el = document.createElement(slot === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    if (slot === 'video') {
      (el as HTMLVideoElement).playsInline = true;
    }

    let settled = false;
    let timerId: number | null = null;

    const cleanup = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onError);
      el.pause();
      el.removeAttribute('src');
      el.load();
    };

    const onLoaded = () => {
      if (settled) return;
      const rawDuration = el.duration;
      const durationSec =
        Number.isFinite(rawDuration) && rawDuration > 0
          ? Math.max(1, Math.min(86400, Math.round(rawDuration)))
          : 0;

      if (slot === 'video') {
        const videoEl = el as HTMLVideoElement;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (durationSec <= 0 && (w <= 0 || h <= 0)) {
          settled = true;
          cleanup();
          reject(new Error('No readable video metadata found at this link.'));
          return;
        }
        settled = true;
        cleanup();
        resolve({
          durationSec: Math.max(1, durationSec),
          ...(w > 0 && h > 0 ? { width: w, height: h } : {}),
        });
        return;
      }

      if (durationSec <= 0) {
        settled = true;
        cleanup();
        reject(new Error('No readable audio duration found at this link.'));
        return;
      }

      settled = true;
      cleanup();
      resolve({ durationSec });
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Browser could not decode this media URL directly.'));
    };

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('error', onError);

    timerId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out while detecting real media duration.'));
    }, timeoutMs);

    try {
      el.src = url;
      el.load();
    } catch {
      onError();
    }
  });
}

/**
 * Probes a pasted Audio or Video link in the browser to verify that it is a real
 * media file and automatically detect its exact duration (and original video dimensions
 * without cropping or rejecting any size/aspect ratio).
 */
export async function probeMediaMetadata(
  mediaRef: MediaRef,
  timeoutPerCandidateMs = 9000
): Promise<MediaProbeResult> {
  const driveId =
    mediaRef.provider === 'drive'
      ? extractDriveFileId(mediaRef.id) ?? mediaRef.id.trim()
      : extractDriveFileId(mediaRef.id);

  // 1. Prefer probing through our protected same-origin Range proxy (reads real duration & dimensions for Drive & external URLs!)
  const proxied = await requestProtectedProxyUrl(driveId ?? mediaRef.id, mediaRef.type);
  if (proxied?.url) {
    try {
      const meta = await probeSingleUrlInBrowser(
        proxied.url,
        mediaRef.type,
        timeoutPerCandidateMs
      );
      return {
        status: 'verified',
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        resolvedUrl: proxied.url,
      };
    } catch {
      if (driveId) {
        return {
          status: 'unverified',
          reason:
            'Could not read audio/video metadata from this Google Drive file. Make sure sharing is set to "Anyone with the link" (Viewer) and that it is a real audio or video file.',
        };
      }
    }
  }

  if (driveId) {
    return {
      status: 'unverified',
      reason:
        'Could not inspect this Google Drive file. Confirm the file is shared as "Anyone with the link" and is a valid audio or video file.',
    };
  }

  const normalizedUrl = normalizeDirectMediaUrl(mediaRef.id);
  if (!normalizedUrl) {
    return {
      status: 'unverified',
      reason: 'Enter a valid https:// audio/video URL or shared Google Drive file link.',
    };
  }

  try {
    const meta = await probeSingleUrlInBrowser(
      normalizedUrl,
      mediaRef.type,
      timeoutPerCandidateMs
    );
    return {
      status: 'verified',
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      resolvedUrl: normalizedUrl,
    };
  } catch {
    return {
      status: 'unverified',
      reason:
        'Could not read audio/video metadata from this link. Make sure it points directly to a public audio/video file (not a webpage or private link).',
    };
  }
}
