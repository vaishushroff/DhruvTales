const DRIVE_FILE_ID_REGEX = /^[a-zA-Z0-9_-]{10,120}$/;

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  webm: 'audio/webm',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  wma: 'audio/x-ms-wma',
  mka: 'audio/x-matroska',
};

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  flv: 'video/x-flv',
  m3u8: 'application/vnd.apple.mpegurl',
};

export function isValidDriveFileId(rawId: string | null | undefined): boolean {
  if (!rawId || typeof rawId !== 'string') return false;
  return DRIVE_FILE_ID_REGEX.test(rawId.trim());
}

export function extractDriveIdStrict(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isValidDriveFileId(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host !== 'drive.google.com' &&
    host !== 'docs.google.com' &&
    host !== 'drive.usercontent.google.com'
  ) {
    return null;
  }

  if (parsed.pathname.includes('/folders/')) {
    return null;
  }

  const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,120})(?:\/|$)/);
  if (fileMatch?.[1] && isValidDriveFileId(fileMatch[1])) {
    return fileMatch[1];
  }

  const qId = parsed.searchParams.get('id')?.trim();
  if (qId && isValidDriveFileId(qId)) {
    return qId;
  }

  return null;
}

function isPrivateOrBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1'
  ) {
    return true;
  }

  // Block IPv4 loopback, private, link-local, CGNAT, and reserved ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const c = Number(ipv4Match[3]);
    const d = Number(ipv4Match[4]);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  // Block IPv6 private/link-local/loopback/mapped-v4 literals
  if (host.includes(':')) {
    const lower = host.toLowerCase();
    if (
      lower === '::1' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('::ffff:')
    ) {
      return true;
    }
  }

  // Block decimal / octal / hex integer IP obfuscation (e.g. 2130706433, 0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    return true;
  }

  return false;
}

/**
 * Validates that an external media URL is strictly HTTPS and points to a public internet host
 * (blocking localhost, cloud metadata endpoints, and private RFC-1918 / IPv6 ranges).
 */
export function isSafePublicMediaUrl(
  rawUrl: string | null | undefined
): { ok: true; url: string } | { ok: false; reason: string } {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'Media URL is required.' };
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) {
    return { ok: false, reason: 'Media URL is invalid or exceeds maximum length.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Enter a valid https:// media URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only https:// media URLs are supported.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Embedded credentials in media URLs are not allowed.' };
  }

  if (isPrivateOrBlockedHostname(parsed.hostname)) {
    return { ok: false, reason: 'Private or internal network URLs are not allowed.' };
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * Normalizes Dropbox and GitHub blob links to direct raw download endpoints.
 */
export function normalizeUpstreamMediaUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host === 'www.dropbox.com' || host === 'dropbox.com') {
      parsed.searchParams.delete('dl');
      parsed.searchParams.set('raw', '1');
      return parsed.toString();
    }
    if (host === 'github.com' && parsed.pathname.includes('/blob/')) {
      parsed.hostname = 'raw.githubusercontent.com';
      parsed.pathname = parsed.pathname.replace('/blob/', '/');
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function buildDriveDownloadUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

/**
 * If Google Drive returns a large-file HTML virus-scan confirmation page instead of raw bytes,
 * extracts the confirmation action URL + hidden inputs so the proxy can follow it server-side.
 */
export function parseDriveConfirmFormUrl(html: string, fallbackFileId: string): string | null {
  if (!html || !/<form/i.test(html)) return null;

  const actionMatch = html.match(/<form[^>]+action=["']([^"']+)["']/i);
  const rawAction = actionMatch?.[1]?.replace(/&amp;/g, '&');
  const baseUrl = rawAction
    ? rawAction.startsWith('http')
      ? rawAction
      : `https://drive.usercontent.google.com${rawAction.startsWith('/') ? '' : '/'}${rawAction}`
    : 'https://drive.usercontent.google.com/download';

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }

  if (
    url.protocol !== 'https:' ||
    (!url.hostname.endsWith('.google.com') && url.hostname !== 'google.com')
  ) {
    return null;
  }

  const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let foundParams = false;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valMatch = tag.match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) {
      url.searchParams.set(nameMatch[1], valMatch?.[1] ?? '');
      foundParams = true;
    }
  }

  if (!url.searchParams.has('id')) {
    url.searchParams.set('id', fallbackFileId);
  }
  if (!url.searchParams.has('export')) {
    url.searchParams.set('export', 'download');
  }
  if (!url.searchParams.has('confirm')) {
    url.searchParams.set('confirm', 't');
  }

  return foundParams || rawAction ? url.toString() : null;
}

/**
 * Blocks direct browser navigation / "Open in new tab" / "Save link as" download attempts
 * against the streaming proxy endpoint while allowing in-page `<audio>` and `<video>` requests.
 */
export function isDirectBrowserDownloadRequest(params: {
  secFetchDest?: string | undefined;
  secFetchMode?: string | undefined;
  referer?: string | undefined;
  host?: string | undefined;
  forwardedHost?: string | undefined;
  allowedOrigins?: string[];
}): boolean {
  const dest = (params.secFetchDest ?? '').trim().toLowerCase();
  const mode = (params.secFetchMode ?? '').trim().toLowerCase();

  // Direct tab navigation or clicking a copied stream link
  if (dest === 'document' || dest === 'iframe' || mode === 'navigate') {
    return true;
  }

  // If a Referer is present, ensure it comes from our own host or an explicitly allowlisted origin
  const rawReferer = (params.referer ?? '').trim();
  if (rawReferer) {
    try {
      const refUrl = new URL(rawReferer);
      const refHost = refUrl.host.toLowerCase();
      const expectedHosts = [params.forwardedHost, params.host]
        .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
        .flatMap((h) => h.split(',').map((s) => s.trim().toLowerCase()));

      const allowedHosts = (params.allowedOrigins ?? [])
        .map((origin) => {
          try {
            return new URL(origin).host.toLowerCase();
          } catch {
            return '';
          }
        })
        .filter(Boolean);

      if (
        expectedHosts.length > 0 &&
        !expectedHosts.includes(refHost) &&
        !allowedHosts.includes(refHost)
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

export function validateRangeHeader(rawRange: string | undefined): string | null {
  if (!rawRange || typeof rawRange !== 'string') return null;
  const trimmed = rawRange.trim();
  if (/^bytes=\d*-\d*$/i.test(trimmed) && trimmed !== 'bytes=-') {
    return trimmed;
  }
  return null;
}

export function sanitizeMediaContentType(
  rawContentType: string | null | undefined,
  format: 'audio' | 'video',
  sourceHint?: string
): string {
  const cleaned = (rawContentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (
    cleaned.startsWith('audio/') ||
    cleaned.startsWith('video/') ||
    cleaned === 'application/ogg' ||
    cleaned === 'application/vnd.apple.mpegurl'
  ) {
    return cleaned;
  }

  if (sourceHint) {
    const cleanPath = sourceHint.split('#')[0]?.split('?')[0] ?? '';
    const ext = cleanPath.split('.').pop()?.toLowerCase() ?? '';
    if (format === 'video') {
      if (VIDEO_MIME_BY_EXT[ext]) return VIDEO_MIME_BY_EXT[ext];
      if (AUDIO_MIME_BY_EXT[ext]) return AUDIO_MIME_BY_EXT[ext];
    } else {
      if (AUDIO_MIME_BY_EXT[ext]) return AUDIO_MIME_BY_EXT[ext];
      if (VIDEO_MIME_BY_EXT[ext]) return VIDEO_MIME_BY_EXT[ext];
    }
  }

  return format === 'video' ? 'video/mp4' : 'audio/mpeg';
}
