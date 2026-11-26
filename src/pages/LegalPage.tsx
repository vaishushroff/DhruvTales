import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Mail } from 'lucide-react';
import type { LegalPageSlug } from '../types';
import { useAppData } from '../hooks/useAuthAndActivity';
import { useLanguage } from '../hooks/useLanguage';

const VALID_SLUGS: LegalPageSlug[] = ['terms', 'privacy', 'refund'];

export const LegalPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { lang, t } = useLanguage();
  const { siteSettings } = useAppData();

  const resolvedSlug: LegalPageSlug = VALID_SLUGS.includes(slug as LegalPageSlug)
    ? (slug as LegalPageSlug)
    : 'terms';
  const docItem = siteSettings.legalPages[resolvedSlug];
  const title = lang === 'hi' && docItem.titleHi ? docItem.titleHi : docItem.titleEn;
  const body = lang === 'hi' && docItem.bodyHi ? docItem.bodyHi : docItem.bodyEn;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <Link
        to="/"
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-[#F3C669] hover:text-[#F5F3EE] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('nav.home')}
      </Link>

      {/* Legal page quick switcher */}
      <nav aria-label="Legal documents" className="flex flex-wrap gap-2">
        {VALID_SLUGS.map((itemSlug) => {
          const item = siteSettings.legalPages[itemSlug];
          const active = itemSlug === resolvedSlug;
          return (
            <Link
              key={itemSlug}
              to={`/legal/${itemSlug}`}
              className={`min-h-[40px] px-3.5 rounded-lg text-xs font-medium inline-flex items-center transition-colors ${
                active
                  ? 'bg-[#E5A93C] text-[#0B0B0E]'
                  : 'bg-[#141418] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
              }`}
            >
              {lang === 'hi' ? item.titleHi : item.titleEn}
            </Link>
          );
        })}
      </nav>

      <article
        data-testid="legal-page-article"
        className="rounded-2xl bg-[#141418] border border-white/10 p-6 sm:p-10 space-y-6"
      >
        <header className="space-y-2 border-b border-white/8 pb-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[#E5A93C] flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            {lang === 'hi' ? siteSettings.branding.appNameHi : siteSettings.branding.appNameEn}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F5F3EE]">
            {title}
          </h1>
          {docItem.updatedAt && (
            <p className="text-xs text-[#9B968B]">
              {lang === 'hi' ? 'अंतिम अपडेट:' : 'Last updated:'} {docItem.updatedAt}
            </p>
          )}
        </header>

        <div className="space-y-4 text-sm sm:text-base text-[#D6D2C9] leading-relaxed whitespace-pre-line">
          {paragraphs.map((para, idx) => (
            <p key={idx}>{para}</p>
          ))}
        </div>

        {siteSettings.branding.supportEmail && (
          <div className="pt-5 border-t border-white/8 flex items-center gap-2 text-xs text-[#A39E93]">
            <Mail className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
            <span>
              {lang === 'hi' ? 'सहायता संपर्क:' : 'Support contact:'}{' '}
              <strong className="text-[#F5F3EE]">{siteSettings.branding.supportEmail}</strong>
            </span>
          </div>
        )}
      </article>
    </div>
  );
};
