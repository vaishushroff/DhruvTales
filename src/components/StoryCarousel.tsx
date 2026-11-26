import React, { memo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Category, ListeningHistoryEntry, Story } from '../types';
import { useLanguage } from '../hooks/useLanguage';
import { StoryCard } from './StoryCard';

interface StoryCarouselProps {
  title: string;
  stories: Story[];
  categoriesById: Record<string, Category>;
  progressByStoryId?: Record<string, ListeningHistoryEntry>;
  seeAllTo?: string;
}

export const StoryCarousel: React.FC<StoryCarouselProps> = memo(
  ({
    title,
    stories,
    categoriesById,
    progressByStoryId,
    seeAllTo,
  }) => {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (stories.length === 0) return null;

  const scrollByAmount = (direction: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: direction * 460, behavior: 'smooth' });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#F5F3EE]">
          {title}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {seeAllTo && (
            <Link
              to={seeAllTo}
              className="min-h-[44px] inline-flex items-center text-xs font-medium text-[#E5A93C] hover:text-[#F3C669] transition-colors whitespace-nowrap px-2"
            >
              {t('common.seeAll')}
            </Link>
          )}
          <div className="hidden md:flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => scrollByAmount(-1)}
              aria-label={`Scroll ${title} left`}
              className="min-w-[44px] min-h-[44px] rounded-lg border border-white/10 bg-[#141418] text-[#A39E93] hover:text-[#F5F3EE] hover:border-white/20 flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollByAmount(1)}
              aria-label={`Scroll ${title} right`}
              className="min-w-[44px] min-h-[44px] rounded-lg border border-white/10 bg-[#141418] text-[#A39E93] hover:text-[#F5F3EE] hover:border-white/20 flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="carousel-scroll flex gap-4 sm:gap-5 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {stories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            category={categoriesById[story.genreId]}
            progress={progressByStoryId?.[story.id]}
            compact
          />
        ))}
      </div>
    </section>
  );
});

StoryCarousel.displayName = 'StoryCarousel';
