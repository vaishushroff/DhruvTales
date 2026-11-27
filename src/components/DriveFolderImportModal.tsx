import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderInput,
  Info,
  Link2,
  Loader2,
  SkipForward,
  X,
} from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import {
  DriveMediaError,
  importEpisodesFromDirectLinks,
  importEpisodesFromDriveFolder,
  type DriveFolderImportResult,
} from '../services/media';
import type { Episode, Story } from '../types';

type ImportMode = 'direct' | 'folder';

interface DriveFolderImportModalProps {
  open: boolean;
  story: Story | null;
  existingEpisodes?: Episode[];
  actorUid?: string;
  onClose: () => void;
  onImportComplete: (result: DriveFolderImportResult) => Promise<void>;
}

export const DriveFolderImportModal: React.FC<DriveFolderImportModalProps> = ({
  open,
  story,
  existingEpisodes = [],
  actorUid = '',
  onClose,
  onImportComplete,
}) => {
  const { lang, t } = useLanguage();
  const [mode, setMode] = useState<ImportMode>('direct');
  const [folderInput, setFolderInput] = useState('');
  const [directLinksInput, setDirectLinksInput] = useState('');
  const [defaultPriceCoins, setDefaultPriceCoins] = useState('0');
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DriveFolderImportResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, importing, onClose]);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setInfoNotice(null);
      setResult(null);
    }
  }, [open, story?.id]);

  if (!open || !story) return null;

  const storyTitle = lang === 'hi' ? story.titleHi : story.title;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoNotice(null);
    setResult(null);

    if (mode === 'direct') {
      const trimmed = directLinksInput.trim();
      if (!trimmed) {
        setErrorMsg('Paste at least one Google Drive share link/ID or direct HTTPS media URL.');
        return;
      }

      setImporting(true);
      try {
        const importRes = await importEpisodesFromDirectLinks({
          story,
          existingEpisodes,
          actorUid: actorUid || story.creatorOwnerUid,
          rawLines: trimmed,
          defaultPriceCoins: Math.max(0, Math.floor(Number(defaultPriceCoins) || 0)),
        });
        setResult(importRes);
        if (importRes.created.length > 0) {
          setDirectLinksInput('');
          await onImportComplete(importRes);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : t('studio.driveImportGenericError'));
      } finally {
        setImporting(false);
      }
      return;
    }

    const trimmed = folderInput.trim();
    if (!trimmed) {
      setErrorMsg(t('studio.driveFolderRequired'));
      return;
    }

    setImporting(true);
    try {
      const importRes = await importEpisodesFromDriveFolder(story.id, trimmed);
      setResult(importRes);
      if (importRes.created.length > 0) {
        await onImportComplete(importRes);
      }
    } catch (err) {
      if (err instanceof DriveMediaError && err.code === 'server_not_configured') {
        setMode('direct');
        setInfoNotice(
          'Automatic Drive folder scanning requires a Node API server, which is not active on this static host. Switched to Direct Batch Links so you can import episodes directly into Firestore right now.'
        );
      } else if (err instanceof DriveMediaError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : t('studio.driveImportGenericError'));
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('studio.driveImportTitle')}
      data-testid="drive-import-modal"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-xl rounded-2xl bg-[#141418] border border-white/15 p-6 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#E5A93C]">{storyTitle}</p>
            <h2 className="font-display text-2xl font-semibold text-[#F5F3EE]">
              {t('studio.driveImportTitle')}
            </h2>
          </div>
          <button
            type="button"
            disabled={importing}
            aria-label={t('common.close')}
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-lg bg-[#0B0B0E] border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div
          role="tablist"
          aria-label="Episode import mode"
          className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#0B0B0E] border border-white/10"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'direct'}
            data-testid="import-mode-direct"
            disabled={importing}
            onClick={() => {
              setMode('direct');
              setErrorMsg(null);
            }}
            className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'direct'
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#A39E93] hover:text-[#F5F3EE]'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
            Direct Batch Links
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'folder'}
            data-testid="import-mode-folder"
            disabled={importing}
            onClick={() => {
              setMode('folder');
              setErrorMsg(null);
              setInfoNotice(null);
            }}
            className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'folder'
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#A39E93] hover:text-[#F5F3EE]'
            }`}
          >
            <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />
            Drive Folder Scan
          </button>
        </div>

        {infoNotice && (
          <div
            role="status"
            className="rounded-xl bg-amber-950/35 border border-amber-500/35 p-3.5 flex items-start gap-2.5 text-xs text-[#F3C669]"
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="leading-relaxed">{infoNotice}</p>
          </div>
        )}

        {mode === 'direct' ? (
          <div className="rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4 space-y-2 text-xs text-[#D6D2C9]">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-[#E5A93C] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="font-medium text-[#F5F3EE]">
                  Works on any hosting (no backend server needed)
                </p>
                <p className="text-[#A39E93] leading-relaxed">
                  Paste one link per line using shared Google Drive file links (&ldquo;Anyone with the link can view&rdquo;), Drive file IDs, or direct HTTPS MP3/MP4 URLs.
                </p>
                <p className="font-mono-tabular text-[11px] text-[#F3C669] leading-relaxed">
                  EP01 | The First Star | https://drive.google.com/file/d/FILE_ID/view
                  <br />
                  EP01_video | https://drive.google.com/file/d/VIDEO_ID/view
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-4 space-y-2 text-xs text-[#D6D2C9]">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-[#E5A93C] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1.5">
                <p className="font-medium text-[#F5F3EE]">{t('studio.driveNamingHeading')}</p>
                <p className="text-[#A39E93] leading-relaxed">{t('studio.driveNamingBody')}</p>
                <p className="font-mono-tabular text-[11px] text-[#F3C669]">
                  EP01_audio.mp3 · EP01_video.mp4 · EP02_audio.mp3
                </p>
                <p className="text-[11px] text-[#8A857B] leading-relaxed">
                  {t('studio.driveLimitsNotice')}
                </p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'direct' ? (
            <>
              <div className="space-y-1.5">
                <label
                  htmlFor="direct-links-textarea"
                  className="text-xs font-medium text-[#A39E93] block"
                >
                  Episode Links (one per line)
                </label>
                <textarea
                  id="direct-links-textarea"
                  data-testid="direct-links-textarea"
                  rows={5}
                  value={directLinksInput}
                  onChange={(e) => setDirectLinksInput(e.target.value)}
                  placeholder={`EP01 | Episode Title | https://drive.google.com/file/d/...\nEP02 | Next Chapter | https://cdn.yourdomain.com/ep02.mp3`}
                  disabled={importing}
                  className="w-full p-3.5 rounded-xl bg-[#0B0B0E] border border-white/15 text-xs font-mono text-[#F5F3EE] placeholder:text-[#66625B] focus:outline-none focus:border-[#E5A93C]"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="direct-default-price"
                  className="text-xs font-medium text-[#A39E93] block"
                >
                  Default Coin Price per Imported Episode (0 = Free)
                </label>
                <input
                  id="direct-default-price"
                  type="number"
                  min={0}
                  max={100000}
                  value={defaultPriceCoins}
                  onChange={(e) => setDefaultPriceCoins(e.target.value)}
                  disabled={importing}
                  className="w-36 h-10 px-3 rounded-xl bg-[#0B0B0E] border border-white/15 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="drive-folder-input"
                className="text-xs font-medium text-[#A39E93] block"
              >
                {t('studio.driveFolderLabel')}
              </label>
              <input
                id="drive-folder-input"
                data-testid="drive-folder-input"
                type="text"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz or https://drive.google.com/drive/folders/..."
                disabled={importing}
                className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/15 text-sm text-[#F5F3EE] placeholder:text-[#66625B] focus:outline-none focus:border-[#E5A93C]"
              />
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              data-testid="drive-import-error"
              className="rounded-xl bg-rose-950/50 border border-rose-500/35 p-3.5 flex items-start gap-2.5 text-xs text-rose-200"
            >
              <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {result && (
            <div
              data-testid="drive-import-summary"
              className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-4 text-xs"
            >
              <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/25 p-2.5">
                  <p className="text-lg font-semibold text-emerald-300">{result.created.length}</p>
                  <p className="text-[11px] text-emerald-200/80">{t('studio.driveCreatedLabel')}</p>
                </div>
                <div className="rounded-lg bg-amber-950/35 border border-amber-500/25 p-2.5">
                  <p className="text-lg font-semibold text-[#F3C669]">{result.skipped.length}</p>
                  <p className="text-[11px] text-[#D6D2C9]">{t('studio.driveSkippedLabel')}</p>
                </div>
                <div className="rounded-lg bg-rose-950/35 border border-rose-500/25 p-2.5">
                  <p className="text-lg font-semibold text-rose-300">{result.invalid.length}</p>
                  <p className="text-[11px] text-rose-200/80">{t('studio.driveInvalidLabel')}</p>
                </div>
              </div>

              {result.created.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-medium text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('studio.driveCreatedHeading')}
                  </p>
                  <ul className="space-y-1 text-[#D6D2C9]">
                    {result.created.map((item) => (
                      <li
                        key={item.episodeId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#141418] px-3 py-2"
                      >
                        <span>
                          Ep {item.episodeNumber}: {item.files.join(' + ')}
                        </span>
                        <span className="text-[11px] text-[#E5A93C] font-mono-tabular">
                          {[item.hasAudio ? 'Audio' : null, item.hasVideo ? 'Video' : null]
                            .filter(Boolean)
                            .join(' + ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-medium text-[#F3C669] flex items-center gap-1.5">
                    <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('studio.driveSkippedHeading')}
                  </p>
                  <ul className="space-y-1 text-[#A39E93]">
                    {result.skipped.map((item) => (
                      <li key={item.fileId} className="rounded-lg bg-[#141418] px-3 py-2">
                        <span className="text-[#F5F3EE]">{item.fileName}</span> — {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.invalid.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-medium text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('studio.driveInvalidHeading')}
                  </p>
                  <ul className="space-y-1 text-rose-200/85">
                    {result.invalid.map((item) => (
                      <li key={item.fileId} className="rounded-lg bg-[#141418] px-3 py-2">
                        <span className="text-[#F5F3EE]">{item.fileName}</span> — {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={importing}
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
            >
              {t('common.close')}
            </button>
            <button
              type="submit"
              data-testid="drive-import-submit-btn"
              disabled={importing}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-50 inline-flex items-center gap-2"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : mode === 'direct' ? (
                <Link2 className="w-4 h-4" aria-hidden="true" />
              ) : (
                <FolderInput className="w-4 h-4" aria-hidden="true" />
              )}
              {importing
                ? t('studio.driveImporting')
                : mode === 'direct'
                  ? 'Import Episodes'
                  : t('studio.driveImportRunBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
