import React, { memo, useState } from 'react';
import type { CoverTheme, Story } from '../types';
import { sanitizeSafeUrl } from '../utils/validation';

interface ThemePalette {
  bg: string;
  accent: string;
  secondary: string;
  motif: 'astrolabe' | 'window' | 'rails' | 'arch' | 'skyline' | 'lantern' | 'dawn' | 'waves' | 'compass' | 'lotus' | 'constellation' | 'teacup';
}

const COVER_THEMES: Record<CoverTheme, ThemePalette> = {
  'mythology-gold': {
    bg: 'from-[#1D160B] via-[#121015] to-[#0B0B0E]',
    accent: '#E5A93C',
    secondary: '#7C5A21',
    motif: 'astrolabe',
  },
  'romance-mist': {
    bg: 'from-[#1C161D] via-[#14151C] to-[#0B0B0E]',
    accent: '#D47B86',
    secondary: '#E5A93C',
    motif: 'window',
  },
  'thriller-noir': {
    bg: 'from-[#18181D] via-[#101014] to-[#08080A]',
    accent: '#D97742',
    secondary: '#F3C669',
    motif: 'rails',
  },
  'horror-amber': {
    bg: 'from-[#1D1210] via-[#120E0E] to-[#09080A]',
    accent: '#C4633E',
    secondary: '#E5A93C',
    motif: 'arch',
  },
  'crime-deco': {
    bg: 'from-[#111722] via-[#10131A] to-[#090B10]',
    accent: '#8EA5C4',
    secondary: '#E5A93C',
    motif: 'skyline',
  },
  'kids-lantern': {
    bg: 'from-[#10201C] via-[#10181B] to-[#0B0D10]',
    accent: '#6BAE8E',
    secondary: '#F3C669',
    motif: 'lantern',
  },
  'motivation-dawn': {
    bg: 'from-[#221A10] via-[#151314] to-[#0B0B0E]',
    accent: '#E5A93C',
    secondary: '#C98A4B',
    motif: 'dawn',
  },
  'comedy-bazaar': {
    bg: 'from-[#231910] via-[#181312] to-[#0C0B0E]',
    accent: '#E09A43',
    secondary: '#D47B86',
    motif: 'waves',
  },
  'mystery-emerald': {
    bg: 'from-[#0F1E1D] via-[#0F1519] to-[#0A0C0F]',
    accent: '#59A698',
    secondary: '#E5A93C',
    motif: 'compass',
  },
  'folklore-crimson': {
    bg: 'from-[#241214] via-[#150E12] to-[#0B0A0D]',
    accent: '#D66756',
    secondary: '#E5A93C',
    motif: 'lotus',
  },
  'scifi-indigo': {
    bg: 'from-[#141729] via-[#10121D] to-[#0A0B10]',
    accent: '#8B9AE0',
    secondary: '#E5A93C',
    motif: 'constellation',
  },
  'drama-sepia': {
    bg: 'from-[#211A14] via-[#151212] to-[#0B0B0E]',
    accent: '#CCA36E',
    secondary: '#9E7854',
    motif: 'teacup',
  },
};

const IllustratedMotif: React.FC<{ palette: ThemePalette }> = ({ palette }) => {
  const { accent, secondary, motif } = palette;
  return (
    <svg
      viewBox="0 0 300 400"
      className="w-full h-full object-cover opacity-90"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id={`glow-${motif}`} cx="50%" cy="38%" r="55%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="65%" stopColor={secondary} stopOpacity="0.06" />
          <stop offset="100%" stopColor="#0B0B0E" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="300" height="400" fill={`url(#glow-${motif})`} />
      {/* Subtle architectural frame lines */}
      <rect
        x="18"
        y="18"
        width="264"
        height="364"
        rx="10"
        fill="none"
        stroke={accent}
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      {motif === 'lantern' && (
        <g stroke={accent} fill="none" strokeWidth="1.5">
          <line x1="150" y1="36" x2="150" y2="108" strokeOpacity="0.5" />
          <path d="M124 128 C124 108 176 108 176 128 L168 188 C168 202 132 202 132 188 Z" fill={secondary} fillOpacity="0.16" />
          <circle cx="150" cy="154" r="14" fill={secondary} fillOpacity="0.55" stroke="none" />
          <circle cx="96" cy="116" r="2.5" fill={secondary} stroke="none" />
          <circle cx="212" cy="142" r="2" fill={secondary} stroke="none" />
          <circle cx="194" cy="96" r="1.8" fill={accent} stroke="none" />
          <circle cx="108" cy="214" r="2" fill={accent} stroke="none" />
        </g>
      )}
      {motif === 'dawn' && (
        <g stroke={accent} fill="none" strokeWidth="1.4">
          <circle cx="150" cy="166" r="46" fill={accent} fillOpacity="0.15" />
          <circle cx="150" cy="166" r="76" strokeDasharray="3 6" strokeOpacity="0.45" />
          <line x1="42" y1="212" x2="258" y2="212" strokeOpacity="0.45" />
          <path d="M46 212 Q104 172 150 198 Q198 166 254 212" strokeOpacity="0.65" />
        </g>
      )}
      {motif === 'waves' && (
        <g stroke={accent} fill="none" strokeWidth="1.5">
          <circle cx="150" cy="148" r="22" fill={accent} fillOpacity="0.2" />
          <circle cx="150" cy="148" r="52" strokeOpacity="0.55" />
          <circle cx="150" cy="148" r="82" strokeOpacity="0.3" strokeDasharray="8 6" />
          <path d="M74 232 Q112 206 150 232 T226 232" stroke={secondary} strokeOpacity="0.7" />
          <path d="M74 248 Q112 222 150 248 T226 248" strokeOpacity="0.4" />
        </g>
      )}
      {motif === 'compass' && (
        <g stroke={accent} fill="none" strokeWidth="1.4">
          <circle cx="150" cy="156" r="68" strokeOpacity="0.55" />
          <circle cx="150" cy="156" r="46" strokeDasharray="4 4" strokeOpacity="0.35" />
          <polygon points="150,80 162,156 150,232 138,156" fill={accent} fillOpacity="0.22" />
          <polygon points="74,156 150,144 226,156 150,168" fill={secondary} fillOpacity="0.18" />
        </g>
      )}
      {motif === 'lotus' && (
        <g stroke={accent} fill="none" strokeWidth="1.4">
          <path d="M150 96 C174 134 174 176 150 206 C126 176 126 134 150 96 Z" fill={accent} fillOpacity="0.22" />
          <path d="M150 206 C188 186 208 156 200 120 C172 134 156 164 150 206 Z" fill={secondary} fillOpacity="0.14" />
          <path d="M150 206 C112 186 92 156 100 120 C128 134 144 164 150 206 Z" fill={secondary} fillOpacity="0.14" />
          <line x1="76" y1="224" x2="224" y2="224" strokeOpacity="0.4" />
        </g>
      )}
      {motif === 'constellation' && (
        <g stroke={accent} fill="none" strokeWidth="1.2">
          <polyline points="82,188 118,130 162,154 204,104 224,162" strokeOpacity="0.6" />
          <circle cx="82" cy="188" r="4" fill={secondary} />
          <circle cx="118" cy="130" r="5" fill={accent} />
          <circle cx="162" cy="154" r="4" fill={secondary} />
          <circle cx="204" cy="104" r="6" fill={secondary} />
          <circle cx="224" cy="162" r="3.5" fill={accent} />
          <circle cx="150" cy="154" r="78" strokeDasharray="2 7" strokeOpacity="0.3" />
        </g>
      )}
      {motif === 'teacup' && (
        <g stroke={accent} fill="none" strokeWidth="1.5">
          <path d="M104 166 H196 C196 206 176 226 150 226 C124 226 104 206 104 166 Z" fill={accent} fillOpacity="0.16" />
          <path d="M196 176 C216 176 216 206 192 206" />
          <path d="M132 146 Q124 128 136 112" strokeOpacity="0.55" />
          <path d="M154 142 Q146 120 158 102" strokeOpacity="0.7" />
          <path d="M174 146 Q168 128 178 114" strokeOpacity="0.5" />
          <line x1="88" y1="234" x2="212" y2="234" strokeOpacity="0.45" />
        </g>
      )}
      {(motif === 'astrolabe' || motif === 'window' || motif === 'rails' || motif === 'arch' || motif === 'skyline') && (
        <g stroke={accent} fill="none" strokeWidth="1.5">
          <circle cx="150" cy="158" r="66" strokeOpacity="0.55" />
          <circle cx="150" cy="158" r="42" strokeOpacity="0.35" strokeDasharray="5 5" />
          <path d="M150 76 L150 240 M68 158 L232 158" strokeOpacity="0.25" />
          <circle cx="150" cy="158" r="10" fill={accent} fillOpacity="0.4" />
        </g>
      )}
    </svg>
  );
};

interface StoryArtworkProps {
  story: Story;
  aspect?: 'poster' | 'landscape' | 'square';
  useBackdrop?: boolean;
  showTitleOverlay?: boolean;
  className?: string;
}

export const StoryArtwork: React.FC<StoryArtworkProps> = memo(
  ({
    story,
    aspect = 'poster',
    useBackdrop = false,
    showTitleOverlay = false,
    className = '',
  }) => {
    const [imgFailed, setImgFailed] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);
    const rawSrc = useBackdrop ? story.backdropUrl || story.coverUrl : story.coverUrl;
    const src = sanitizeSafeUrl(rawSrc);
    const palette = COVER_THEMES[story.coverTheme] ?? COVER_THEMES['mythology-gold'];

    const aspectClass =
      aspect === 'landscape'
        ? 'aspect-[16/9]'
        : aspect === 'square'
          ? 'aspect-square'
          : 'aspect-[3/4]';

    const hasPhoto = Boolean(src) && !imgFailed;

    return (
      <div
        className={`relative overflow-hidden bg-gradient-to-br ${palette.bg} ${aspectClass} ${className}`}
      >
        {hasPhoto ? (
          <>
            {!imgLoaded && (
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[#18181F] animate-pulse"
              />
            )}
            <img
              src={src}
              alt={story.title}
              referrerPolicy="no-referrer"
              decoding="async"
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgFailed(true)}
              className={`w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-[1.03] ${
                imgLoaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        ) : (
          <div className="w-full h-full relative">
            <IllustratedMotif palette={palette} />
            <div className="absolute inset-x-4 bottom-5 text-left pointer-events-none">
              <p className="font-display text-lg leading-snug font-semibold text-[#F5F3EE] line-clamp-2 drop-shadow">
                {story.title}
              </p>
              <p className="text-[11px] text-[#B2ADA2] mt-1 truncate">{story.creatorName}</p>
            </div>
          </div>
        )}

        {showTitleOverlay && hasPhoto && (
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0E]/85 via-[#0B0B0E]/20 to-transparent pointer-events-none" />
        )}
      </div>
    );
  }
);

StoryArtwork.displayName = 'StoryArtwork';
