import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Folder,
  FolderInput,
  Info,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  SkipForward,
  X,
} from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import {
  clearCachedDriveAccessToken,
  connectGoogleDriveAccount,
  DriveMediaError,
  extractDriveFolderId,
  getCachedDriveAccessToken,
  importEpisodesFromDirectLinks,
  importEpisodesFromDriveFolder,
  importEpisodesFromGoogleDriveDirect,
  listGoogleDriveFolders,
  parseBatchEpisodeLines,
  type ClientDriveFolderItem,
  type DriveFolderImportResult,
} from '../services/media';
import type { Episode, Story } from '../types';

type ImportMode = 'drive' | 'direct';

interface DriveFolderImportModalProps {
  open: boolean;
  story: Story | null;
  existingEpisodes?: Episode[];
  actorUid?: string;
  onClose: () => void;
  onImportComplete: (result: DriveFolderImportResult) => Promise<void>;
}

const GoogleGLogo: React.FC = () => (
  <svg
    className="w-[18px] h-[18px] shrink-0"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#34A853"
      d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
    />
  </svg>
);

export const DriveFolderImportModal: React.FC<DriveFolderImportModalProps> = ({
  open,
  story,
  existingEpisodes = [],
  actorUid = '',
  onClose,
  onImportComplete,
}) => {
  const { lang, t } = useLanguage();
  const [mode, setMode] = useState<ImportMode>('drive');
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [folders, setFolders] = useState<ClientDriveFolderItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderSearch, setFolderSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [directLinksInput, setDirectLinksInput] = useState('');
  const [defaultPriceCoins, setDefaultPriceCoins] = useState('0');
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DriveFolderImportResult | null>(null);
  const directTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadDriveFolders = useCallback(async (token: string, search = '') => {
    setLoadingFolders(true);
    try {
      const items = await listGoogleDriveFolders(token, search);
      setFolders(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load Google Drive folders.';
      setErrorMsg(msg);
      if (!getCachedDriveAccessToken()) {
        setDriveAccessToken(null);
        setFolders([]);
      }
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing && !connectingDrive) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, importing, connectingDrive, onClose]);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setInfoNotice(null);
    setResult(null);
    const cached = getCachedDriveAccessToken();
    setDriveAccessToken(cached);
    if (cached) {
      void loadDriveFolders(cached, '');
    } else {
      setFolders([]);
    }
  }, [open, story?.id, loadDriveFolders]);

  const existingNumbers = useMemo(
    () => existingEpisodes.filter((ep) => !ep.isDeleted).map((ep) => ep.episodeNumber),
    [existingEpisodes]
  );

  const detectedFolderUrlInDirect = useMemo(() => {
    const firstNonEmpty = directLinksInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (!firstNonEmpty) return null;
    if (/\/folders\/|[?&]id=[a-zA-Z0-9_-]+/i.test(firstNonEmpty)) {
      const folderId = extractDriveFolderId(firstNonEmpty);
      if (folderId && /\/folders\//i.test(firstNonEmpty)) {
        return firstNonEmpty;
      }
    }
    return null;
  }, [directLinksInput]);

  const liveDirectPlan = useMemo(() => {
    if (!directLinksInput.trim()) return null;
    return parseBatchEpisodeLines(directLinksInput, existingNumbers);
  }, [directLinksInput, existingNumbers]);

  if (!open || !story) return null;

  const storyTitle = lang === 'hi' ? story.titleHi : story.title;

  const handleConnectDrive = async () => {
    setErrorMsg(null);
    setInfoNotice(null);
    setConnectingDrive(true);
    try {
      const token = await connectGoogleDriveAccount();
      setDriveAccessToken(token);
      setFolderSearch('');
      await loadDriveFolders(token, '');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not connect Google Drive. Please try again.'
      );
    } finally {
      setConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = () => {
    clearCachedDriveAccessToken();
    setDriveAccessToken(null);
    setFolders([]);
    setSelectedFolderId(null);
    setErrorMsg(null);
  };

  const handleFolderSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!driveAccessToken) return;
    setErrorMsg(null);
    await loadDriveFolders(driveAccessToken, folderSearch);
  };

  const handleSelectFolder = (folder: ClientDriveFolderItem) => {
    setSelectedFolderId(folder.id);
    setFolderInput(folder.id);
    setErrorMsg(null);
    setInfoNotice(null);
  };

  const handleTransferFolderLinkToDriveTab = () => {
    if (!detectedFolderUrlInDirect) return;
    setFolderInput(detectedFolderUrlInDirect);
    setDirectLinksInput('');
    setMode('drive');
    setErrorMsg(null);
    setInfoNotice(
      driveAccessToken
        ? 'Moved your Google Drive folder link here. Click "Import Episodes from Folder" below.'
        : 'Moved your Google Drive folder link here. Click "Sign in with Google Drive" to scan and import every episode automatically.'
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoNotice(null);
    setResult(null);

    const parsedCoins = Math.max(0, Math.floor(Number(defaultPriceCoins) || 0));

    if (mode === 'direct') {
      const trimmed = directLinksInput.trim();
      if (!trimmed) return;

      setImporting(true);
      try {
        const importRes = await importEpisodesFromDirectLinks({
          story,
          existingEpisodes,
          actorUid: actorUid || story.creatorOwnerUid,
          rawLines: trimmed,
          defaultPriceCoins: parsedCoins,
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

    const trimmedFolder = folderInput.trim();
    if (!trimmedFolder) {
      setErrorMsg('Select a Google Drive folder above or paste a Google Drive folder link/ID.');
      return;
    }

    setImporting(true);
    try {
      const activeToken = driveAccessToken || getCachedDriveAccessToken();
      let importRes: DriveFolderImportResult;

      if (activeToken) {
        importRes = await importEpisodesFromGoogleDriveDirect({
          story,
          existingEpisodes,
          actorUid: actorUid || story.creatorOwnerUid,
          folderInput: trimmedFolder,
          accessToken: activeToken,
          defaultPriceCoins: parsedCoins,
        });
      } else {
        // Fallback: try server API if running on a full-stack host; otherwise prompt Google Drive connect
        importRes = await importEpisodesFromDriveFolder(story.id, trimmedFolder);
      }

      setResult(importRes);
      if (importRes.created.length > 0) {
        await onImportComplete(importRes);
      } else if (
        importRes.totalFilesScanned === 0 &&
        importRes.skipped.length === 0 &&
        importRes.invalid.length === 0
      ) {
        setInfoNotice(
          'This Google Drive folder is empty. Add audio (.mp3, .m4a, .wav) or video (.mp4, .webm) files to the folder and try again.'
        );
      }
    } catch (err) {
      if (err instanceof DriveMediaError && err.code === 'server_not_configured') {
        setInfoNotice(
          'Click "Sign in with Google Drive" above to scan this folder directly in your browser—no backend server required.'
        );
      } else if (err instanceof DriveMediaError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : t('studio.driveImportGenericError'));
        if (!getCachedDriveAccessToken()) {
          setDriveAccessToken(null);
        }
      }
    } finally {
      setImporting(false);
    }
  };

  const canSubmit =
    mode === 'drive'
      ? Boolean(folderInput.trim()) && !importing && !connectingDrive
      : Boolean(directLinksInput.trim()) &&
        Boolean(liveDirectPlan && liveDirectPlan.groups.length > 0) &&
        !importing;

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
            disabled={importing || connectingDrive}
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
            aria-selected={mode === 'drive'}
            data-testid="import-mode-folder"
            disabled={importing || connectingDrive}
            onClick={() => {
              setMode('drive');
              setErrorMsg(null);
            }}
            className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'drive'
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#A39E93] hover:text-[#F5F3EE]'
            }`}
          >
            <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />
            Google Drive Folder
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'direct'}
            data-testid="import-mode-direct"
            disabled={importing || connectingDrive}
            onClick={() => {
              setMode('direct');
              setErrorMsg(null);
              setInfoNotice(null);
            }}
            className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'direct'
                ? 'bg-[#E5A93C] text-[#0B0B0E]'
                : 'text-[#A39E93] hover:text-[#F5F3EE]'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
            Direct Links (Manual)
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'drive' ? (
            <div className="space-y-4">
              {!driveAccessToken ? (
                <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-3.5">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[#F5F3EE]">
                      Browse and import directly from Google Drive
                    </p>
                    <p className="text-xs text-[#A39E93] leading-relaxed">
                      Connect your Google Drive with read-only permission to pick any folder and automatically import all audio &amp; video episodes—works on any host without manually copying links.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="connect-google-drive-btn"
                    disabled={connectingDrive || importing}
                    onClick={handleConnectDrive}
                    className="min-h-[44px] px-4 rounded-xl bg-white text-[#1F1F1F] border border-[#747775]/40 hover:bg-[#F3F4F6] disabled:opacity-60 text-sm font-medium inline-flex items-center gap-2.5 shadow-sm transition-colors"
                  >
                    {connectingDrive ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" aria-hidden="true" />
                    ) : (
                      <GoogleGLogo />
                    )}
                    <span>
                      {connectingDrive ? 'Connecting Google Drive…' : 'Sign in with Google Drive'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl bg-[#0B0B0E] border border-white/10 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Google Drive connected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={loadingFolders || importing}
                        onClick={() => void handleFolderSearchSubmit()}
                        className="min-h-[32px] px-2.5 rounded-lg bg-[#141418] border border-white/10 text-[11px] text-[#D6D2C9] hover:text-[#F5F3EE] inline-flex items-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${loadingFolders ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        Refresh
                      </button>
                      <button
                        type="button"
                        disabled={importing}
                        onClick={handleDisconnectDrive}
                        className="min-h-[32px] px-2.5 rounded-lg bg-[#141418] border border-white/10 text-[11px] text-[#A39E93] hover:text-rose-300 inline-flex items-center gap-1.5"
                      >
                        <LogOut className="w-3 h-3" aria-hidden="true" />
                        Disconnect
                      </button>
                    </div>
                  </div>

                  {/* Folder search bar */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search
                        className="w-3.5 h-3.5 text-[#8A857B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={folderSearch}
                        onChange={(e) => setFolderSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleFolderSearchSubmit();
                          }
                        }}
                        placeholder="Search your Drive folders..."
                        disabled={loadingFolders || importing}
                        className="w-full h-9 pl-8 pr-3 rounded-lg bg-[#141418] border border-white/10 text-xs text-[#F5F3EE] placeholder:text-[#66625B] focus:outline-none focus:border-[#E5A93C]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={loadingFolders || importing}
                      onClick={() => void handleFolderSearchSubmit()}
                      className="h-9 px-3 rounded-lg bg-[#1C1C22] border border-white/10 text-xs font-medium text-[#F5F3EE] hover:border-white/25"
                    >
                      Search
                    </button>
                  </div>

                  {/* Folder picker list */}
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#141418] divide-y divide-white/[0.06]">
                    {loadingFolders ? (
                      <div className="p-4 flex items-center justify-center gap-2 text-xs text-[#A39E93]">
                        <Loader2 className="w-4 h-4 animate-spin text-[#E5A93C]" aria-hidden="true" />
                        Loading your Google Drive folders…
                      </div>
                    ) : folders.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[#8A857B]">
                        No matching folders found. Paste any shared Google Drive folder URL below.
                      </div>
                    ) : (
                      folders.map((folder) => {
                        const isSelected =
                          selectedFolderId === folder.id || folderInput.trim() === folder.id;
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            disabled={importing}
                            onClick={() => handleSelectFolder(folder)}
                            className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                              isSelected
                                ? 'bg-[#E5A93C]/15 text-[#F5F3EE]'
                                : 'text-[#D6D2C9] hover:bg-white/[0.04]'
                            }`}
                          >
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <Folder
                                className={`w-4 h-4 shrink-0 ${
                                  isSelected ? 'text-[#E5A93C]' : 'text-[#8A857B]'
                                }`}
                                aria-hidden="true"
                              />
                              <span className="truncate font-medium">{folder.name}</span>
                            </span>
                            {isSelected && (
                              <Check
                                className="w-4 h-4 text-[#E5A93C] shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Folder URL / ID input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="drive-folder-input"
                  className="text-xs font-medium text-[#A39E93] block"
                >
                  {driveAccessToken
                    ? 'Selected Folder ID (or paste any Drive folder URL)'
                    : t('studio.driveFolderLabel')}
                </label>
                <input
                  id="drive-folder-input"
                  data-testid="drive-folder-input"
                  type="text"
                  value={folderInput}
                  onChange={(e) => {
                    setFolderInput(e.target.value);
                    setSelectedFolderId(null);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="https://drive.google.com/drive/folders/..."
                  disabled={importing}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#0B0B0E] border border-white/15 text-sm text-[#F5F3EE] placeholder:text-[#66625B] focus:outline-none focus:border-[#E5A93C]"
                />
                <p className="text-[11px] text-[#8A857B] leading-relaxed">
                  Supports <span className="font-mono-tabular text-[#D6D2C9]">EP01_audio.mp3</span> /{' '}
                  <span className="font-mono-tabular text-[#D6D2C9]">EP01_video.mp4</span> or any audio/video filenames (e.g.{' '}
                  <span className="font-mono-tabular text-[#D6D2C9]">Episode 1 - Awakening.mp3</span>).
                  For public listener playback on static hosts, share the folder as <span className="text-[#D6D2C9]">Anyone with the link</span>.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-[#0B0B0E] border border-white/[0.08] p-3.5 space-y-1.5 text-xs text-[#A39E93]">
                <p className="font-medium text-[#F5F3EE]">
                  Paste individual Google Drive file share links or direct HTTPS audio/video URLs
                </p>
                <p className="leading-relaxed">
                  One link per line. Optionally prefix with episode number and title using <code className="text-[#F3C669]">|</code>:
                </p>
                <p className="font-mono-tabular text-[11px] text-[#F3C669] leading-relaxed">
                  https://drive.google.com/file/d/FILE_ID/view
                  <br />
                  EP01 | The First Star | https://cdn.yourdomain.com/ep01.mp3
                </p>
              </div>

              {detectedFolderUrlInDirect && (
                <div
                  role="status"
                  className="rounded-xl bg-amber-950/40 border border-amber-500/40 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#F3C669]"
                >
                  <p className="leading-relaxed flex-1 min-w-[200px]">
                    That looks like a Google Drive <strong>folder</strong> link. Use Google Drive Folder import to scan every file inside it automatically.
                  </p>
                  <button
                    type="button"
                    onClick={handleTransferFolderLinkToDriveTab}
                    className="min-h-[36px] px-3 rounded-lg bg-[#E5A93C] text-[#0B0B0E] font-semibold inline-flex items-center gap-1.5 shrink-0"
                  >
                    Switch to Folder Import
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="direct-links-textarea"
                  className="text-xs font-medium text-[#A39E93] block"
                >
                  Episode Links (one per line)
                </label>
                <textarea
                  ref={directTextareaRef}
                  id="direct-links-textarea"
                  data-testid="direct-links-textarea"
                  rows={5}
                  value={directLinksInput}
                  onChange={(e) => {
                    setDirectLinksInput(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder={`https://drive.google.com/file/d/YOUR_FILE_ID/view\nEP02 | Next Chapter | https://cdn.yourdomain.com/ep02.mp3`}
                  disabled={importing}
                  className="w-full p-3.5 rounded-xl bg-[#0B0B0E] border border-white/15 text-xs font-mono text-[#F5F3EE] placeholder:text-[#66625B] focus:outline-none focus:border-[#E5A93C]"
                />
                {liveDirectPlan && (
                  <p className="text-[11px] text-[#A39E93] tabular-nums">
                    <span className="text-emerald-300 font-medium">
                      {liveDirectPlan.groups.length} episode
                      {liveDirectPlan.groups.length === 1 ? '' : 's'} ready
                    </span>
                    {liveDirectPlan.skipped.length > 0 && (
                      <span> · {liveDirectPlan.skipped.length} skipped</span>
                    )}
                    {liveDirectPlan.invalid.length > 0 && (
                      <span className="text-rose-300">
                        {' '}
                        · {liveDirectPlan.invalid.length} invalid line
                        {liveDirectPlan.invalid.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Shared Default Coin Price Input */}
          <div className="space-y-1.5">
            <label
              htmlFor="import-default-price"
              className="text-xs font-medium text-[#A39E93] block"
            >
              Default Coin Price per Imported Episode (0 = Free)
            </label>
            <input
              id="import-default-price"
              type="number"
              min={0}
              max={100000}
              value={defaultPriceCoins}
              onChange={(e) => setDefaultPriceCoins(e.target.value)}
              disabled={importing}
              className="w-36 h-10 px-3 rounded-xl bg-[#0B0B0E] border border-white/15 text-sm text-[#F5F3EE] focus:outline-none focus:border-[#E5A93C]"
            />
          </div>

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
                          Ep {item.episodeNumber}: {item.title} ({item.files.join(' + ')})
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
              disabled={importing || connectingDrive}
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl bg-[#1C1C22] text-xs font-medium text-[#F5F3EE]"
            >
              {t('common.close')}
            </button>
            <button
              type="submit"
              data-testid="drive-import-submit-btn"
              disabled={!canSubmit}
              className="min-h-[44px] px-5 rounded-xl bg-[#E5A93C] text-[#0B0B0E] text-xs font-semibold hover:bg-[#F3C669] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
                  ? liveDirectPlan && liveDirectPlan.groups.length > 0
                    ? `Import ${liveDirectPlan.groups.length} Episode${liveDirectPlan.groups.length === 1 ? '' : 's'}`
                    : 'Import Episodes'
                  : 'Import Episodes from Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
