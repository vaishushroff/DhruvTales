import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Image,
  LayoutList,
  Palette,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  HeroBannerItem,
  HomepageSectionConfig,
  HomepageSectionSource,
  LegalPageSlug,
  SiteSettings,
  Story,
  UserProfile,
} from '../../types';
import { adminSaveSiteSettings } from '../../services/firebase/adminCmsService';
import { adminUpdateStoryModeration } from '../../services/firebase/adminService';

interface AdminSiteSettingsPanelProps {
  firebaseUser: User | null;
  actor: UserProfile;
  siteSettings: SiteSettings;
  stories: Story[];
  onSavedSiteSettings: (next: SiteSettings) => void;
  onRefreshDashboard: () => Promise<void>;
}

type SettingsSubTab = 'branding' | 'banners' | 'sections' | 'languages' | 'legal';

export const AdminSiteSettingsPanel: React.FC<AdminSiteSettingsPanelProps> = ({
  firebaseUser,
  actor,
  siteSettings,
  stories,
  onSavedSiteSettings,
  onRefreshDashboard,
}) => {
  const [subTab, setSubTab] = useState<SettingsSubTab>('branding');
  const [draft, setDraft] = useState<SiteSettings>(siteSettings);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [legalSlug, setLegalSlug] = useState<LegalPageSlug>('terms');

  useEffect(() => {
    setDraft(siteSettings);
  }, [siteSettings]);

  const activeStories = stories.filter((s) => !s.isDeleted);

  const handleSave = async (summary: string) => {
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const { saved } = await adminSaveSiteSettings(firebaseUser, actor, draft, summary);
      onSavedSiteSettings(saved);
      setStatusMsg('Saved live to Firestore (reflected immediately without redeploying) and logged to auditLogs.');
      await onRefreshDashboard();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save site settings.');
    } finally {
      setSaving(false);
    }
  };

  // Hero Banners helpers
  const addBanner = () => {
    const next: HeroBannerItem = {
      id: `banner-${Date.now().toString(36)}`,
      titleEn: 'New Featured Spotlight',
      titleHi: 'नई विशेष कहानी',
      subtitleEn: 'Describe why listeners should dive into this story.',
      subtitleHi: 'इस कहानी के बारे में संक्षिप्त विवरण लिखें।',
      badgeEn: 'SPOTLIGHT',
      badgeHi: 'विशेष',
      ctaLabelEn: 'Start Listening',
      ctaLabelHi: 'सुनना शुरू करें',
      storyId: activeStories[0]?.id ?? '',
      imageUrl: '',
      active: true,
      sortOrder: draft.heroBanners.length,
    };
    setDraft((prev) => ({ ...prev, heroBanners: [...prev.heroBanners, next] }));
  };

  const moveBanner = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.heroBanners.length) return;
    const copy = [...draft.heroBanners];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setDraft((prev) => ({
      ...prev,
      heroBanners: copy.map((b, i) => ({ ...b, sortOrder: i })),
    }));
  };

  // Homepage Sections helpers
  const addSection = () => {
    const next: HomepageSectionConfig = {
      id: `sec-${Date.now().toString(36)}`,
      titleEn: 'Curated Collection',
      titleHi: 'चुनिंदा संग्रह',
      subtitleEn: '',
      subtitleHi: '',
      source: 'manual_stories',
      storyIds: activeStories.slice(0, 4).map((s) => s.id),
      visible: true,
      sortOrder: draft.homepageSections.length,
      maxItems: 10,
    };
    setDraft((prev) => ({
      ...prev,
      homepageSections: [...prev.homepageSections, next],
    }));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= draft.homepageSections.length) return;
    const copy = [...draft.homepageSections];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setDraft((prev) => ({
      ...prev,
      homepageSections: copy.map((s, i) => ({ ...s, sortOrder: i })),
    }));
  };

  const toggleStoryInSection = (secIdx: number, storyId: string) => {
    setDraft((prev) => {
      const sections = [...prev.homepageSections];
      const sec = sections[secIdx];
      const exists = sec.storyIds.includes(storyId);
      sections[secIdx] = {
        ...sec,
        storyIds: exists
          ? sec.storyIds.filter((id) => id !== storyId)
          : [...sec.storyIds, storyId],
      };
      return { ...prev, homepageSections: sections };
    });
  };

  const handleToggleEditorsPick = async (story: Story) => {
    setErrorMsg(null);
    try {
      const nextVal = !story.isEditorsPick;
      await adminUpdateStoryModeration(
        actor,
        story,
        { isEditorsPick: nextVal },
        `${nextVal ? 'Added' : 'Removed'} "${story.title}" ${nextVal ? 'to' : 'from'} Editor's Picks`
      );
      await onRefreshDashboard();
      setStatusMsg(`Updated Editor's Pick for "${story.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not update Editor's Pick.");
    }
  };

  const currentLegal = draft.legalPages[legalSlug];

  return (
    <div data-testid="admin-site-settings-panel" className="space-y-6">
      {/* Sub-navigation + Live Save Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#141418] border border-white/10 p-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['branding', 'Branding, Colors & Footer', Palette],
              ['banners', 'Hero Banners', Image],
              ['sections', "Homepage Sections & Editor's Picks", LayoutList],
              ['languages', 'Languages', Globe],
              ['legal', 'Legal Pages', FileText],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                subTab === key
                  ? 'bg-[#E5A93C] text-[#0B0B0E]'
                  : 'bg-[#0B0B0E] text-[#A39E93] border border-white/10 hover:text-[#F5F3EE]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="save-site-settings-btn"
          disabled={saving}
          onClick={() => void handleSave(`Updated Site Settings (${subTab})`)}
          className="min-h-[40px] px-4 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-60 inline-flex items-center gap-1.5"
        >
          <Save className="w-4 h-4" aria-hidden="true" />
          {saving ? 'Saving...' : 'Publish Live Changes'}
        </button>
      </div>

      {statusMsg && (
        <div role="status" className="rounded-xl bg-[#6BAE8E]/15 border border-[#6BAE8E]/35 px-4 py-3 text-xs text-[#D6F2E4] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#6BAE8E] shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-xl bg-[#B85D43]/15 border border-[#B85D43]/35 px-4 py-3 text-xs text-[#F5C2B4]">
          {errorMsg}
        </div>
      )}

      {/* 1. Branding, Colors & Footer */}
      {subTab === 'branding' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <h3 className="text-base font-semibold text-[#F5F3EE]">Site Identity &amp; Text</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">App Name (English)</span>
                <input
                  type="text"
                  value={draft.branding.appNameEn}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, branding: { ...p.branding, appNameEn: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">App Name (Hindi)</span>
                <input
                  type="text"
                  value={draft.branding.appNameHi}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, branding: { ...p.branding, appNameHi: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">Tagline (English)</span>
                <input
                  type="text"
                  value={draft.branding.taglineEn}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, branding: { ...p.branding, taglineEn: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">Tagline (Hindi)</span>
                <input
                  type="text"
                  value={draft.branding.taglineHi}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, branding: { ...p.branding, taglineHi: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-[#A39E93]">Logo Image URL (https:// or /path — leave blank for wordmark)</span>
              <input
                type="url"
                value={draft.branding.logoUrl}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, branding: { ...p.branding, logoUrl: e.target.value } }))
                }
                placeholder="https://example.com/logo.png"
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-[#A39E93]">Support Email</span>
              <input
                type="email"
                value={draft.branding.supportEmail}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, branding: { ...p.branding, supportEmail: e.target.value } }))
                }
                className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
          </div>

          <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
            <h3 className="text-base font-semibold text-[#F5F3EE]">Theme Colors &amp; Footer Copy</h3>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['accentHex', 'Primary Accent'],
                  ['accentHoverHex', 'Accent Hover'],
                  ['bgCanvasHex', 'Canvas Background'],
                  ['bgSurfaceHex', 'Surface Card'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="space-y-1 text-xs">
                  <span className="text-[#A39E93]">{label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.branding[field]}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, branding: { ...p.branding, [field]: e.target.value } }))
                      }
                      className="w-10 h-10 rounded-lg bg-transparent border border-white/15 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={draft.branding[field]}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, branding: { ...p.branding, [field]: e.target.value } }))
                      }
                      className="flex-1 min-h-[40px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE] font-mono text-xs"
                    />
                  </div>
                </label>
              ))}
            </div>

            <label className="block space-y-1 text-xs">
              <span className="text-[#A39E93]">Footer About (English)</span>
              <textarea
                rows={2}
                value={draft.footer.aboutEn}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, footer: { ...p.footer, aboutEn: e.target.value } }))
                }
                className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-[#A39E93]">Footer About (Hindi)</span>
              <textarea
                rows={2}
                value={draft.footer.aboutHi}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, footer: { ...p.footer, aboutHi: e.target.value } }))
                }
                className="w-full p-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">Copyright (EN)</span>
                <input
                  type="text"
                  value={draft.footer.copyrightEn}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, footer: { ...p.footer, copyrightEn: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[#A39E93]">Copyright (HI)</span>
                <input
                  type="text"
                  value={draft.footer.copyrightHi}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, footer: { ...p.footer, copyrightHi: e.target.value } }))
                  }
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 2. Hero Banners */}
      {subTab === 'banners' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-[#F5F3EE]">
              Hero Banners / Featured Slides ({draft.heroBanners.length})
            </h3>
            <button
              type="button"
              onClick={addBanner}
              className="min-h-[38px] px-3.5 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F3C669] hover:border-[#E5A93C] inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add Hero Banner
            </button>
          </div>

          {draft.heroBanners.map((b, idx) => (
            <div key={b.id} className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#F3C669]">
                  Slide #{idx + 1} · {b.active ? 'Active' : 'Hidden'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => moveBanner(idx, -1)}
                    className="p-2 rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => moveBanner(idx, 1)}
                    className="p-2 rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((p) => {
                        const copy = [...p.heroBanners];
                        copy[idx] = { ...copy[idx], active: !copy[idx].active };
                        return { ...p, heroBanners: copy };
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#D6D2C9]"
                  >
                    {b.active ? 'Hide' : 'Show'}
                  </button>
                  {draft.heroBanners.length > 1 && (
                    <button
                      type="button"
                      aria-label="Delete banner"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          heroBanners: p.heroBanners.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-2 rounded-lg bg-[#B85D43]/15 text-[#F5C2B4]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <input
                  type="text"
                  placeholder="Title (EN)"
                  value={b.titleEn}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], titleEn: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
                <input
                  type="text"
                  placeholder="Title (HI)"
                  value={b.titleHi}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], titleHi: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
                <input
                  type="text"
                  placeholder="Subtitle (EN)"
                  value={b.subtitleEn}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], subtitleEn: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
                <input
                  type="text"
                  placeholder="Subtitle (HI)"
                  value={b.subtitleHi}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], subtitleHi: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
                <select
                  value={b.storyId ?? ''}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], storyId: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                >
                  <option value="">Auto Featured Story</option>
                  {activeStories.map((st) => (
                    <option key={st.id} value={st.id}>
                      Story: {st.title}
                    </option>
                  ))}
                </select>
                <input
                  type="url"
                  placeholder="Optional Backdrop Image URL (https://...)"
                  value={b.imageUrl ?? ''}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.heroBanners];
                      copy[idx] = { ...copy[idx], imageUrl: e.target.value };
                      return { ...p, heroBanners: copy };
                    })
                  }
                  className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Homepage Sections & Editor's Picks */}
      {subTab === 'sections' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#F5F3EE]">
                Homepage Sections Order, Titles &amp; Story Selection
              </h3>
              <button
                type="button"
                onClick={addSection}
                className="min-h-[38px] px-3.5 rounded-lg bg-[#1C1C22] border border-white/15 text-xs font-medium text-[#F3C669] hover:border-[#E5A93C] inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Section
              </button>
            </div>

            {draft.homepageSections.map((sec, idx) => (
              <div key={sec.id} className="rounded-2xl bg-[#141418] border border-white/10 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F3C669]">
                    #{idx + 1} · {sec.titleEn} ({sec.visible ? 'Visible' : 'Hidden'})
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => moveSection(idx, -1)}
                      className="p-1.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(idx, 1)}
                      className="p-1.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE]"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => {
                          const copy = [...p.homepageSections];
                          copy[idx] = { ...copy[idx], visible: !copy[idx].visible };
                          return { ...p, homepageSections: copy };
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#0B0B0E] border border-white/10 text-xs text-[#D6D2C9] inline-flex items-center gap-1"
                    >
                      {sec.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {sec.visible ? 'Visible' : 'Hidden'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((p) => ({
                          ...p,
                          homepageSections: p.homepageSections.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-1.5 rounded-lg bg-[#B85D43]/15 text-[#F5C2B4]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <input
                    type="text"
                    value={sec.titleEn}
                    placeholder="Title (EN)"
                    onChange={(e) =>
                      setDraft((p) => {
                        const copy = [...p.homepageSections];
                        copy[idx] = { ...copy[idx], titleEn: e.target.value };
                        return { ...p, homepageSections: copy };
                      })
                    }
                    className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                  />
                  <input
                    type="text"
                    value={sec.titleHi}
                    placeholder="Title (HI)"
                    onChange={(e) =>
                      setDraft((p) => {
                        const copy = [...p.homepageSections];
                        copy[idx] = { ...copy[idx], titleHi: e.target.value };
                        return { ...p, homepageSections: copy };
                      })
                    }
                    className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                  />
                  <select
                    value={sec.source}
                    onChange={(e) =>
                      setDraft((p) => {
                        const copy = [...p.homepageSections];
                        copy[idx] = {
                          ...copy[idx],
                          source: e.target.value as HomepageSectionSource,
                        };
                        return { ...p, homepageSections: copy };
                      })
                    }
                    className="min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
                  >
                    <option value="auto_continue">Continue Listening (Auto)</option>
                    <option value="auto_trending">Trending Stories (Auto + Pinned)</option>
                    <option value="auto_editors_pick">Editor&apos;s Picks (Auto + Pinned)</option>
                    <option value="auto_popular">Popular Series (Auto + Pinned)</option>
                    <option value="auto_recent">Recently Added (Auto + Pinned)</option>
                    <option value="manual_stories">Manual Curated Stories Only</option>
                  </select>
                </div>

                {sec.source !== 'auto_continue' && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-[#9B968B]">
                      {sec.source === 'manual_stories'
                        ? 'Select stories to display in this section:'
                        : 'Optional: pin stories to appear first in this section:'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeStories.map((st) => {
                        const selected = sec.storyIds.includes(st.id);
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => toggleStoryInSection(idx, st.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                              selected
                                ? 'bg-[#E5A93C]/20 border-[#E5A93C] text-[#F3C669]'
                                : 'bg-[#0B0B0E] border-white/10 text-[#A39E93] hover:text-[#F5F3EE]'
                            }`}
                          >
                            {selected ? '✓ ' : '+ '}
                            {st.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Dedicated Editor's Picks Quick Curation */}
          <div className="rounded-2xl bg-[#141418] border border-[#E5A93C]/25 p-5 space-y-3">
            <h3 className="text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#E5A93C]" aria-hidden="true" />
              Editor&apos;s Picks Curation ({activeStories.filter((s) => s.isEditorsPick).length} selected)
            </h3>
            <p className="text-xs text-[#A39E93]">
              Toggle which published stories appear in the Editor&apos;s Picks showcase (each change is saved immediately and logged to auditLogs).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {activeStories.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => void handleToggleEditorsPick(st)}
                  className={`p-3 rounded-xl border text-left text-xs transition-colors flex items-center justify-between gap-2 ${
                    st.isEditorsPick
                      ? 'bg-[#E5A93C]/15 border-[#E5A93C]/60 text-[#F5F3EE]'
                      : 'bg-[#0B0B0E] border-white/10 text-[#A39E93] hover:text-[#F5F3EE]'
                  }`}
                >
                  <span className="truncate font-medium">{st.title}</span>
                  <span className="text-[11px] font-semibold shrink-0 text-[#F3C669]">
                    {st.isEditorsPick ? '★ Pick' : '+ Add'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. Languages */}
      {subTab === 'languages' && (
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-[#F5F3EE]">Supported Platform Languages</h3>
            <label className="flex items-center gap-2 text-xs text-[#A39E93]">
              Default Language:
              <select
                value={draft.defaultLanguage}
                onChange={(e) => setDraft((p) => ({ ...p, defaultLanguage: e.target.value }))}
                className="min-h-[36px] px-2.5 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              >
                {draft.languages
                  .filter((l) => l.enabled)
                  .map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.labelEn} ({l.code})
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="space-y-2.5">
            {draft.languages.map((langItem, idx) => (
              <div
                key={langItem.code}
                className="rounded-xl bg-[#0B0B0E] border border-white/10 p-3 grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-center text-xs"
              >
                <span className="font-mono text-[#F3C669] uppercase">{langItem.code}</span>
                <input
                  type="text"
                  value={langItem.labelEn}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.languages];
                      copy[idx] = { ...copy[idx], labelEn: e.target.value };
                      return { ...p, languages: copy };
                    })
                  }
                  className="min-h-[36px] px-2.5 rounded-lg bg-[#141418] border border-white/10 text-[#F5F3EE]"
                />
                <input
                  type="text"
                  value={langItem.labelNative}
                  onChange={(e) =>
                    setDraft((p) => {
                      const copy = [...p.languages];
                      copy[idx] = { ...copy[idx], labelNative: e.target.value };
                      return { ...p, languages: copy };
                    })
                  }
                  className="min-h-[36px] px-2.5 rounded-lg bg-[#141418] border border-white/10 text-[#F5F3EE]"
                />
                <label className="inline-flex items-center gap-2 justify-end cursor-pointer">
                  <input
                    type="checkbox"
                    checked={langItem.enabled}
                    onChange={(e) =>
                      setDraft((p) => {
                        const copy = [...p.languages];
                        copy[idx] = { ...copy[idx], enabled: e.target.checked };
                        return { ...p, languages: copy };
                      })
                    }
                    className="accent-[#E5A93C]"
                  />
                  <span className="text-[#D6D2C9]">{langItem.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Legal Pages Editor */}
      {subTab === 'legal' && (
        <div className="rounded-2xl bg-[#141418] border border-white/10 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-[#F5F3EE]">
              Legal Page Content (live at /legal/{legalSlug})
            </h3>
            <div className="flex gap-1.5">
              {(['terms', 'privacy', 'refund'] as LegalPageSlug[]).map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setLegalSlug(slug)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                    legalSlug === slug
                      ? 'bg-[#E5A93C] text-[#0B0B0E]'
                      : 'bg-[#0B0B0E] text-[#A39E93] border border-white/10'
                  }`}
                >
                  {slug}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-[#A39E93]">Title (English)</span>
              <input
                type="text"
                value={currentLegal.titleEn}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    legalPages: {
                      ...p.legalPages,
                      [legalSlug]: { ...p.legalPages[legalSlug], titleEn: e.target.value },
                    },
                  }))
                }
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[#A39E93]">Title (Hindi)</span>
              <input
                type="text"
                value={currentLegal.titleHi}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    legalPages: {
                      ...p.legalPages,
                      [legalSlug]: { ...p.legalPages[legalSlug], titleHi: e.target.value },
                    },
                  }))
                }
                className="w-full min-h-[38px] px-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
              />
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-[#A39E93]">Body Content (English)</span>
            <textarea
              rows={6}
              value={currentLegal.bodyEn}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  legalPages: {
                    ...p.legalPages,
                    [legalSlug]: {
                      ...p.legalPages[legalSlug],
                      bodyEn: e.target.value,
                      updatedAt: new Date().toISOString().slice(0, 10),
                    },
                  },
                }))
              }
              className="w-full p-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <span className="text-[#A39E93]">Body Content (Hindi)</span>
            <textarea
              rows={6}
              value={currentLegal.bodyHi}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  legalPages: {
                    ...p.legalPages,
                    [legalSlug]: {
                      ...p.legalPages[legalSlug],
                      bodyHi: e.target.value,
                      updatedAt: new Date().toISOString().slice(0, 10),
                    },
                  },
                }))
              }
              className="w-full p-3 rounded-lg bg-[#0B0B0E] border border-white/12 text-[#F5F3EE]"
            />
          </label>
        </div>
      )}
    </div>
  );
};
