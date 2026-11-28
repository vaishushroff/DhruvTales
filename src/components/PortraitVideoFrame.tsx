import React from 'react';
import type { VideoAspectFormat } from '../services/media/portraitVideo';

interface PortraitVideoFrameProps {
  children: React.ReactNode;
  /** Coarse orientation fallback when natural dimensions are not yet loaded */
  aspect?: VideoAspectFormat;
  /** Exact natural aspect ratio (videoWidth / videoHeight) so original video shape is never cropped or trimmed */
  naturalAspectRatio?: number | null;
  /** Optional custom CSS class for the inner video frame */
  frameClassName?: string;
  /** Optional custom CSS class for the centering stage wrapper */
  hostClassName?: string;
  /** Optional test ID applied to the video frame box itself */
  frameTestId?: string;
  /** Optional CSS variable override for maximum height */
  maxHeightCss?: string;
  /** Optional CSS variable override for maximum width */
  maxWidthCss?: string;
  /** Optional ref attached to the fullscreen host container */
  hostRef?: React.Ref<HTMLDivElement>;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * Adaptive video presentation container that preserves the exact original size and
 * natural aspect ratio of any uploaded video (9:16, 16:9, 1:1, 4:3, 4:5, 21:9, etc.)
 * with zero cropping or trimming.
 */
export const PortraitVideoFrame: React.FC<PortraitVideoFrameProps> = ({
  children,
  aspect = '16:9',
  naturalAspectRatio = null,
  frameClassName = '',
  hostClassName = '',
  frameTestId = 'portrait-video-frame',
  maxHeightCss,
  maxWidthCss,
  hostRef,
  onMouseMove,
  onTouchStart,
  onFocus,
  onMouseLeave,
  onClick,
}) => {
  const hasNaturalRatio =
    typeof naturalAspectRatio === 'number' &&
    Number.isFinite(naturalAspectRatio) &&
    naturalAspectRatio > 0.1 &&
    naturalAspectRatio < 10;

  const isLandscape = hasNaturalRatio ? naturalAspectRatio >= 1 : aspect === '16:9';

  const frameStyle = (
    hasNaturalRatio
      ? {
          '--dt-natural-aspect': `${naturalAspectRatio}`,
          '--dt-natural-aspect-num': `${naturalAspectRatio}`,
          ...(maxHeightCss ? { '--dt-natural-max-h': maxHeightCss } : {}),
          ...(maxWidthCss ? { '--dt-natural-max-w': maxWidthCss } : {}),
        }
      : isLandscape
        ? {
            ...(maxHeightCss ? { '--dt-landscape-max-h': maxHeightCss } : {}),
            ...(maxWidthCss ? { '--dt-landscape-max-w': maxWidthCss } : {}),
          }
        : {
            ...(maxHeightCss ? { '--dt-portrait-max-h': maxHeightCss } : {}),
            ...(maxWidthCss ? { '--dt-portrait-max-w': maxWidthCss } : {}),
          }
  ) as React.CSSProperties;

  const frameClass = hasNaturalRatio
    ? 'dt-natural-video-frame'
    : isLandscape
      ? 'dt-landscape-video-frame'
      : 'dt-portrait-video-frame';

  return (
    <div
      ref={hostRef}
      onMouseMove={onMouseMove}
      onTouchStart={onTouchStart}
      onFocus={onFocus}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={`dt-portrait-fullscreen-host w-full flex items-center justify-center ${hostClassName}`.trim()}
    >
      <div
        data-testid={frameTestId}
        data-video-aspect={hasNaturalRatio ? `${naturalAspectRatio.toFixed(3)}` : aspect}
        style={frameStyle}
        className={`${frameClass} rounded-2xl ring-1 ring-white/10 shadow-2xl shadow-black/75 select-none ${frameClassName}`.trim()}
      >
        {children}
      </div>
    </div>
  );
};
