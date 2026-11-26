/**
 * Adaptive 9:16 portrait and 16:9 landscape video helpers for Dhruv Tales.
 *
 * Videos render in the exact format uploaded or provided by the creator/admin:
 * - Portrait 9:16 (reference 1080 × 1920, ratio 0.5625) -> 9:16 output frame
 * - Landscape 16:9 (reference 1920 × 1080, ratio 1.7778) -> 16:9 output frame
 *
 * Pure dimension validation & geometry helpers are decoupled from DOM APIs
 * so they can be verified deterministically under node:test.
 */

export type VideoAspectFormat = '9:16' | '16:9';

export const PORTRAIT_ASPECT_WIDTH = 9;
export const PORTRAIT_ASPECT_HEIGHT = 16;
export const PORTRAIT_ASPECT_RATIO = PORTRAIT_ASPECT_WIDTH / PORTRAIT_ASPECT_HEIGHT; // 0.5625

export const LANDSCAPE_ASPECT_WIDTH = 16;
export const LANDSCAPE_ASPECT_HEIGHT = 9;
export const LANDSCAPE_ASPECT_RATIO = LANDSCAPE_ASPECT_WIDTH / LANDSCAPE_ASPECT_HEIGHT; // 1.7778

/**
 * Tight aspect-ratio tolerances allowing slight encoder macroblock rounding
 * (e.g. 540×960, 720×1280, 1080×1920, 1080×1916 for 9:16; 1280×720, 1920×1080,
 * 1376×768 for 16:9) while rejecting unsupported shapes like 1:1, 4:3, 3:4, 4:5, 2:3.
 */
export const PORTRAIT_ASPECT_TOLERANCE = 0.025;
export const LANDSCAPE_ASPECT_TOLERANCE = 0.05;

export interface VideoDimensions {
  width: number;
  height: number;
}

export type PortraitValidationResult =
  | {
      valid: true;
      width: number;
      height: number;
      aspectRatio: number;
      format: VideoAspectFormat;
    }
  | {
      valid: false;
      reason: 'invalid_metadata' | 'wrong_aspect_ratio';
      width: number;
      height: number;
      aspectRatio: number | null;
    };

export interface FrameBox {
  width: number;
  height: number;
  aspectRatio: number;
}

export interface ContainedVideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fillsFrameEdgeToEdge: boolean;
  hasLetterboxBars: boolean;
  hasPillarboxBars: boolean;
}

export class VideoMetadataError extends Error {
  readonly code: 'unreadable_metadata' | 'timeout';

  constructor(code: 'unreadable_metadata' | 'timeout', message: string) {
    super(message);
    this.name = 'VideoMetadataError';
    this.code = code;
  }
}

export function formatVideoDimensions(width: number, height: number): string {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

export function formatPortraitRejectionMessage(
  template: string,
  width: number,
  height: number
): string {
  return template
    .replace('{width}', String(Math.round(width)))
    .replace('{height}', String(Math.round(height)));
}

/**
 * Detects whether a video's native frame is landscape (16:9) or portrait (9:16).
 */
export function detectVideoAspectFormat(width: number, height: number): VideoAspectFormat {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '9:16';
  }
  return width > height ? '16:9' : '9:16';
}

/**
 * Validates that a creator/admin video upload matches either standard vertical 9:16
 * OR standard horizontal 16:9. Returns the detected output format ('9:16' | '16:9').
 */
export function validateSupportedVideoDimensions(
  width: number,
  height: number,
  portraitTolerance = PORTRAIT_ASPECT_TOLERANCE,
  landscapeTolerance = LANDSCAPE_ASPECT_TOLERANCE
): PortraitValidationResult {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {
      valid: false,
      reason: 'invalid_metadata',
      width: 0,
      height: 0,
      aspectRatio: null,
    };
  }

  const roundedW = Math.round(width);
  const roundedH = Math.round(height);
  const ratio = roundedW / roundedH;

  if (roundedH > roundedW && Math.abs(ratio - PORTRAIT_ASPECT_RATIO) <= portraitTolerance) {
    return {
      valid: true,
      width: roundedW,
      height: roundedH,
      aspectRatio: ratio,
      format: '9:16',
    };
  }

  if (roundedW > roundedH && Math.abs(ratio - LANDSCAPE_ASPECT_RATIO) <= landscapeTolerance) {
    return {
      valid: true,
      width: roundedW,
      height: roundedH,
      aspectRatio: ratio,
      format: '16:9',
    };
  }

  return {
    valid: false,
    reason: 'wrong_aspect_ratio',
    width: roundedW,
    height: roundedH,
    aspectRatio: ratio,
  };
}

/**
 * Strict 9:16 portrait-only validator (kept for callers checking portrait orientation).
 */
export function validatePortraitVideoDimensions(
  width: number,
  height: number,
  tolerance = PORTRAIT_ASPECT_TOLERANCE
): PortraitValidationResult {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {
      valid: false,
      reason: 'invalid_metadata',
      width: 0,
      height: 0,
      aspectRatio: null,
    };
  }

  const roundedW = Math.round(width);
  const roundedH = Math.round(height);
  const ratio = roundedW / roundedH;
  const isVertical = roundedH > roundedW;
  const isNineBySixteen = Math.abs(ratio - PORTRAIT_ASPECT_RATIO) <= tolerance;

  if (!isVertical || !isNineBySixteen) {
    return {
      valid: false,
      reason: 'wrong_aspect_ratio',
      width: roundedW,
      height: roundedH,
      aspectRatio: ratio,
    };
  }

  return {
    valid: true,
    width: roundedW,
    height: roundedH,
    aspectRatio: ratio,
    format: '9:16',
  };
}

export function isPortraitNineBySixteen(width: number, height: number): boolean {
  return validatePortraitVideoDimensions(width, height).valid;
}

export function isLandscapeSixteenByNine(width: number, height: number): boolean {
  const res = validateSupportedVideoDimensions(width, height);
  return res.valid && res.format === '16:9';
}

/**
 * Computes the largest exact 9:16 or 16:9 frame box that fits within the available
 * width and height (used for phone, laptop, tablet, and fullscreen verification).
 */
export function computeVideoFrameBox(
  availableWidth: number,
  availableHeight: number,
  format: VideoAspectFormat = '9:16'
): FrameBox {
  const aspectW = format === '16:9' ? LANDSCAPE_ASPECT_WIDTH : PORTRAIT_ASPECT_WIDTH;
  const aspectH = format === '16:9' ? LANDSCAPE_ASPECT_HEIGHT : PORTRAIT_ASPECT_HEIGHT;
  const targetRatio = aspectW / aspectH;

  const safeW = Math.max(0, availableWidth);
  const safeH = Math.max(0, availableHeight);
  if (safeW === 0 || safeH === 0) {
    return { width: 0, height: 0, aspectRatio: targetRatio };
  }

  const heightIfFullWidth = safeW * (aspectH / aspectW);
  if (heightIfFullWidth <= safeH) {
    return {
      width: safeW,
      height: heightIfFullWidth,
      aspectRatio: safeW / heightIfFullWidth,
    };
  }

  const widthIfFullHeight = safeH * (aspectW / aspectH);
  return {
    width: widthIfFullHeight,
    height: safeH,
    aspectRatio: widthIfFullHeight / safeH,
  };
}

export function computePortraitFrameBox(
  availableWidth: number,
  availableHeight: number
): FrameBox {
  return computeVideoFrameBox(availableWidth, availableHeight, '9:16');
}

/**
 * Computes the rendered video content rectangle inside a frame using
 * `object-fit: contain` (preserves full picture on black background with zero crop).
 */
export function computeContainedVideoRect(
  frameWidth: number,
  frameHeight: number,
  videoWidth: number,
  videoHeight: number
): ContainedVideoRect {
  if (frameWidth <= 0 || frameHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      fillsFrameEdgeToEdge: false,
      hasLetterboxBars: false,
      hasPillarboxBars: false,
    };
  }

  const frameRatio = frameWidth / frameHeight;
  const videoRatio = videoWidth / videoHeight;

  let width: number;
  let height: number;
  if (videoRatio > frameRatio) {
    width = frameWidth;
    height = frameWidth / videoRatio;
  } else {
    height = frameHeight;
    width = frameHeight * videoRatio;
  }

  const x = (frameWidth - width) / 2;
  const y = (frameHeight - height) / 2;
  const eps = 1; // 1px rounding tolerance

  const hasLetterboxBars = frameHeight - height > eps;
  const hasPillarboxBars = frameWidth - width > eps;
  const fillsFrameEdgeToEdge = !hasLetterboxBars && !hasPillarboxBars;

  return {
    x,
    y,
    width,
    height,
    fillsFrameEdgeToEdge,
    hasLetterboxBars,
    hasPillarboxBars,
  };
}

/**
 * Pure state-transition helper for Creator Studio video upload replacement.
 * Guarantees that a rejected replacement keeps the previous videoMediaRef and
 * all unsaved episode text fields completely intact.
 */
export function applyVideoSelectionToEpisodeForm<
  TForm extends { videoMediaRef: unknown },
>(
  form: TForm,
  validation: PortraitValidationResult,
  uploadedVideoRef: TForm['videoMediaRef']
): {
  nextForm: TForm;
  accepted: boolean;
} {
  if (!validation.valid || !uploadedVideoRef) {
    return {
      nextForm: form,
      accepted: false,
    };
  }
  return {
    nextForm: {
      ...form,
      videoMediaRef: uploadedVideoRef,
    },
    accepted: true,
  };
}

/**
 * Reads display-oriented video dimensions from a user-selected File using an
 * offscreen HTML5 <video> element. Modern browsers expose `videoWidth` and
 * `videoHeight` after applying container rotation metadata.
 */
export function readVideoFileDimensions(
  file: File,
  timeoutMs = 10000
): Promise<VideoDimensions> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      reject(
        new VideoMetadataError(
          'unreadable_metadata',
          'Video metadata cannot be inspected outside a browser environment.'
        )
      );
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let objectUrl: string | null = null;
    let settled = false;
    let timerId: number | null = null;

    const cleanup = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const fail = (code: 'unreadable_metadata' | 'timeout', message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new VideoMetadataError(code, message));
    };

    const handleLoadedMetadata = () => {
      if (settled) return;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        fail('unreadable_metadata', 'Could not read valid video dimensions from file metadata.');
        return;
      }
      settled = true;
      cleanup();
      resolve({ width, height });
    };

    const handleError = () => {
      fail('unreadable_metadata', 'Browser could not decode metadata for the selected video file.');
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);

    timerId = window.setTimeout(() => {
      fail('timeout', 'Timed out while reading video dimensions.');
    }, timeoutMs);

    try {
      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
      video.load();
    } catch {
      fail('unreadable_metadata', 'Unable to open the selected video file for inspection.');
    }
  });
}
