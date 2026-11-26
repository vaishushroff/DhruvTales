import React from 'react';
import type { VideoAspectFormat } from '../services/media/portraitVideo';

interface PortraitVideoFrameProps {
  children: React.ReactNode;
  /** Output aspect ratio matching the creator/admin uploaded video ('9:16' or '16:9') */
  aspect?: VideoAspectFormat;
  /** Optional custom CSS class for the inner video frame */
  frameClassName?: string;
  /** Optional custom CSS class for the centering stage wrapper */
  hostClassName?: string;
  /** Optional test ID applied to the video frame box itself */
  frameTestId?: string;
  /** Optional CSS variable override for maximum height (e.g. '320px', 'calc(100dvh - 13rem)') */
  maxHeightCss?: string;
  /** Optional CSS variable override for maximum width (e.g. '440px', '860px') */
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
 * Shared adaptive video presentation container supporting both 9:16 portrait
 * and 16:9 landscape videos so playback always matches the creator's upload format.
 */
export const PortraitVideoFrame: React.FC<PortraitVideoFrameProps> = ({
  children,
  aspect = '9:16',
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
  const isLandscape = aspect === '16:9';
  const frameStyle = (
    isLandscape
      ? {
          ...(maxHeightCss ? { '--dt-landscape-max-h': maxHeightCss } : {}),
          ...(maxWidthCss ? { '--dt-landscape-max-w': maxWidthCss } : {}),
        }
      : {
          ...(maxHeightCss ? { '--dt-portrait-max-h': maxHeightCss } : {}),
          ...(maxWidthCss ? { '--dt-portrait-max-w': maxWidthCss } : {}),
        }
  ) as React.CSSProperties;

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
        data-video-aspect={aspect}
        style={frameStyle}
        className={`${
          isLandscape ? 'dt-landscape-video-frame' : 'dt-portrait-video-frame'
        } rounded-2xl ring-1 ring-white/10 shadow-2xl shadow-black/75 select-none ${frameClassName}`.trim()}
      >
        {children}
      </div>
    </div>
  );
};
