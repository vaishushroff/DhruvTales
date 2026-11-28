import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Film,
  Folder,
  FolderOpen,
  Loader2,
  Music,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  browseDriveFolderWithServiceAccount,
  formatBytesReadable,
  type DriveBrowseFileItem,
  type DriveBrowseResponse,
} from '../../services/media/drivePathClient';
import { formatRealDuration } from '../../services/media/mediaFormats';

interface DriveFolderPickerProps {
  slot: 'audio' | 'video';
  initialPath?: string;
  onSelectFile: (file: DriveBrowseFileItem) => void;
  onClose: () => void;
}

export const DriveFolderPicker: React.FC<DriveFolderPickerProps> = ({
  slot,
  initialPath = '',
  onSelectFile,
  onClose,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [data, setData] = useState<DriveBrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolder = useCallback(async (targetPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseDriveFolderWithServiceAccount(targetPath);
      setData(res);
      setCurrentPath(res.currentPath);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to browse your Google Drive folder right now.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFolder(initialPath);
  }, [initialPath, loadFolder]);

  const segments = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const matchingFiles = (data?.files ?? []).filter((f) =>
    slot === 'video' ? f.mediaKind === 'video' : true
  );

  return (
    <div
      data-testid={`drive-browser-${slot}`}
      className="rounded-xl bg-[#141418] border border-[#E5A93C]/35 p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-[#F5F3EE] truncate">
            Select {slot === 'video' ? 'Video' : 'Audio'} from Google Drive
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadFolder(currentPath)}
            disabled={loading}
            aria-label="Refresh Drive folder"
            className="min-w-[32px] min-h-[32px] rounded-lg border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] inline-flex items-center justify-center"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Drive browser"
            className="min-w-[32px] min-h-[32px] rounded-lg border border-white/10 text-[#A39E93] hover:text-[#F5F3EE] inline-flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <nav aria-label="Google Drive folder path" className="flex flex-wrap items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => void loadFolder('')}
          className={`px-2 py-1 rounded-md transition-colors ${
            segments.length === 0
              ? 'bg-[#E5A93C]/20 text-[#F3C669] font-medium'
              : 'text-[#A39E93] hover:text-[#F5F3EE] hover:bg-white/5'
          }`}
        >
          Drive Root
        </button>
        {segments.map((seg, idx) => {
          const target = segments.slice(0, idx + 1).join('/');
          const isCurrent = idx === segments.length - 1;
          return (
            <React.Fragment key={target}>
              <ChevronRight className="w-3 h-3 text-[#66625B]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => void loadFolder(target)}
                className={`px-2 py-1 rounded-md transition-colors ${
                  isCurrent
                    ? 'bg-[#E5A93C]/20 text-[#F3C669] font-medium'
                    : 'text-[#A39E93] hover:text-[#F5F3EE] hover:bg-white/5'
                }`}
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {loading && (
        <div className="py-5 flex items-center justify-center gap-2 text-xs text-[#A39E93]">
          <Loader2 className="w-4 h-4 text-[#E5A93C] animate-spin" aria-hidden="true" />
          Reading Google Drive via Service Account…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg bg-rose-950/40 border border-rose-500/35 px-3 py-2.5 text-[11px] text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-300" aria-hidden="true" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {!loading && !error && data && (
        <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
          {data.folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => void loadFolder(folder.path)}
              className="w-full min-h-[38px] px-2.5 py-1.5 rounded-lg bg-[#0B0B0E]/70 hover:bg-white/[0.06] border border-white/[0.06] flex items-center justify-between gap-2 text-left transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Folder className="w-4 h-4 text-[#E5A93C] shrink-0" aria-hidden="true" />
                <span className="text-xs text-[#F5F3EE] truncate">{folder.name}</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[#8A857B] shrink-0" aria-hidden="true" />
            </button>
          ))}

          {matchingFiles.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => onSelectFile(file)}
              className="w-full min-h-[40px] px-2.5 py-1.5 rounded-lg bg-[#0B0B0E] hover:bg-[#E5A93C]/12 border border-white/[0.08] hover:border-[#E5A93C]/45 flex items-center justify-between gap-2 text-left transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                {file.mediaKind === 'video' ? (
                  <Film className="w-4 h-4 text-[#F3C669] shrink-0" aria-hidden="true" />
                ) : (
                  <Music className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                )}
                <span className="text-xs text-[#F5F3EE] truncate">{file.name}</span>
              </span>
              <span className="text-[10px] font-mono-tabular text-[#A39E93] shrink-0">
                {[
                  file.durationSec ? formatRealDuration(file.durationSec) : '',
                  file.sizeBytes ? formatBytesReadable(file.sizeBytes) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}

          {data.folders.length === 0 && matchingFiles.length === 0 && (
            <p className="py-4 text-center text-[11px] text-[#8A857B]">
              No {slot === 'video' ? 'video' : 'audio/video'} files or subfolders found here.
              {data.serviceAccountEmail && (
                <span className="block mt-1 text-[#A39E93]">
                  Make sure your Drive folder is shared with {data.serviceAccountEmail} as Viewer.
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
