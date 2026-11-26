import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import type { Category, ListeningHistoryEntry, Story } from '../types';
import { useLanguage } from '../hooks/useLanguage';
import { formatPlayCount } from '../services/access/episodeAccess';
import { StoryArtwork } from './StoryArtwork';

interface StoryCardProps {
  story: Story;
  category?: Category;
  progress?: ListeningHistoryEntry;
  compact?: boolean;
}

export const StoryCard: React.FC<StoryCardProps> = memo(
  ({
    story,
    category,
    progress,
    compact = false,
  }) => {
  const { lang, t } = useLanguage();
  const title = lang === 'hi' ? story.titleHi : story.title;
  const genreLabel = category
    ? lang === 'hi'
      ? category.nameHi
      : category.nameEn
    : story.genreId;
  const langLabel =
    story.language === 'hi'
      ? t('common.hindi')
      : story.language === 'en'
        ? t('common.english')
        : t('common.bilingual');

  const pct =
    progress && progress.durationSec > 0
      ? Math.min(100, Math.round((progress.positionSec / progress.durationSec) * 100))
      : null;

  return (
    <Link
      to={`/story/${story.id}`}
      className={`group block shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93C] rounded-xl transition-transform duration-200 hover:-translate-y-0.5 ${
        compact ? 'w-[164px] sm:w-[190px]' : 'w-full'
      }`}
    >
      <div className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-[#141418]">
        <StoryArtwork story={story} aspect="poster" />

        {/* Subtle play affordance on hover */}
        <div className="absolute right-3 bottom-3 w-10 h-10 rounded-full bg-[#0B0B0E]/85 border border-[#E5A93C]/40 text-[#E5A93C] flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200">
          <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
        </div>

        {/* Resume progress bar at bottom edge when listening history exists */}
        {pct !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className="h-full bg-[#E5A93C]"
              style={{ width: `${Math.max(6, pct)}%` }}
            />
          </div>
        )}
      </div>

      {/* Unboxed editorial metadata (zero static pills) */}
      <div className="mt-3 space-y-1">
        <h3 className="font-display text-[15px] font-semibold text-[#F5F3EE] leading-snug line-clamp-1 group-hover:text-[#F3C669] transition-colors">
          {title}
        </h3>
        <p className="text-xs text-[#A39E93] truncate">{story.creatorName}</p>
        <div className="flex items-center gap-1.5 text-[11px] text-[#9B968B] tabular-nums truncate">
          <span>{genreLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{langLabel}</span>
          <span aria-hidden="true">·</span>
          <span>
            {story.episodeCount} {t('common.episodes')}
          </span>
        </div>
        {progress ? (
          <p className="text-[11px] text-[#E5A93C] tabular-nums">
            {t('common.episode')} {progress.episodeNumber} · {pct}%
          </p>
        ) : (
          <p className="text-[11px] text-[#9B968B] tabular-nums">
            ★ {story.rating.toFixed(1)} · {formatPlayCount(story.totalPlays)} {t('common.plays')}
          </p>
        )}
      </div>
    </Link>
  );
});

StoryCard.displayName = 'StoryCard';
