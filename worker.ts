import {
  browseDriveFolder,
  DriveServiceAccountError,
  fetchDriveStreamWithServiceAccount,
  getDriveFileMetadataWithServiceAccount,
  isDriveServiceAccountConfigured,
  resolveDriveFileByPath,
  type DriveServiceAccountEnv,
} from './api/_lib/driveServiceAccount';
import { verifyFirebaseIdTokenEdge } from './api/_lib/firebaseEdgeAuth';
import {
  buildDriveDownloadUrl,
  extractDriveIdStrict,
  isDirectBrowserDownloadRequest,
  isSafePublicMediaUrl,
  isValidDriveFileId,
  normalizeUpstreamMediaUrl,
  parseDriveConfirmFormUrl,
  sanitizeMediaContentType,
  validateRangeHeader,
} from './api/_lib/mediaProxySecurity';

interface WorkerEnv extends DriveServiceAccountEnv {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  MEDIA_SIGNING_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

interface WorkerProxyPayload {
  kind: 'drive' | 'url';
  target: string;
  format: 'audio' | 'video';
  exp: number;
}

const PROXY_TOKEN_TTL_MS = 10 * 60 * 1000;
const IV_BYTES = 12;

// Ephemeral per-isolate secret fallback when MEDIA_SIGNING_SECRET isn't bound as a Worker secret
const EPHEMERAL_SECRET_BYTES = (() => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
})();

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padLen = (4 - (input.length % 4)) % 4;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  try {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

async function importAesGcmKey(env: WorkerEnv): Promise<CryptoKey> {
  const secretRaw = env.MEDIA_SIGNING_SECRET?.trim();
  const keyMaterial =
    secretRaw && secretRaw.length >= 16
      ? await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(secretRaw))
      : EPHEMERAL_SECRET_BYTES;
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

async function signWorkerToken(
  payload: WorkerProxyPayload,
  env: WorkerEnv
): Promise<string> {
  const key = await importAesGcmKey(env);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    TEXT_ENCODER.encode(JSON.stringify(payload))
  );
  const ciphertext = new Uint8Array(ciphertextBuf);
  const packed = new Uint8Array(IV_BYTES + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, IV_BYTES);
  return `v1.${toBase64Url(packed)}`;
}

async function verifyWorkerToken(
  token: string | null,
  env: WorkerEnv
): Promise<{ valid: true; payload: WorkerProxyPayload } | { valid: false; code: string; message: string }> {
  if (!token) {
    return { valid: false, code: 'invalid_token', message: 'Missing media stream token.' };
  }
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] !== 'v1') {
    return { valid: false, code: 'invalid_token', message: 'Malformed media stream token.' };
  }
  const packed = fromBase64Url(parts[1]);
  if (!packed || packed.length <= IV_BYTES + 16) {
    return { valid: false, code: 'invalid_token', message: 'Invalid media token payload.' };
  }

  const iv = packed.slice(0, IV_BYTES);
  const ciphertext = packed.slice(IV_BYTES);

  let plaintextBuf: ArrayBuffer;
  try {
    const key = await importAesGcmKey(env);
    plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    return { valid: false, code: 'invalid_token', message: 'Media stream token verification failed.' };
  }

  try {
    const parsed = JSON.parse(TEXT_DECODER.decode(plaintextBuf)) as Partial<WorkerProxyPayload>;
    if (
      (parsed.kind !== 'drive' && parsed.kind !== 'url') ||
      typeof parsed.target !== 'string' ||
      !parsed.target.trim() ||
      (parsed.format !== 'audio' && parsed.format !== 'video') ||
      typeof parsed.exp !== 'number'
    ) {
      return { valid: false, code: 'invalid_token', message: 'Incomplete token payload.' };
    }
    if (Date.now() > parsed.exp) {
      return { valid: false, code: 'expired_token', message: 'Media stream session expired.' };
    }
    return {
      valid: true,
      payload: {
        kind: parsed.kind,
        target: parsed.target.trim(),
        format: parsed.format,
        exp: parsed.exp,
      },
    };
  } catch {
    return { valid: false, code: 'invalid_token', message: 'Corrupt token payload.' };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function fetchUpstreamSafe(
  initialUrl: string,
  rangeHeader: string | null,
  method: 'GET' | 'HEAD',
  driveFileId?: string
): Promise<Response> {
  let currentUrl = initialUrl;
  let confirmTried = false;

  for (let hop = 0; hop < 6; hop += 1) {
    const safeCheck = isSafePublicMediaUrl(currentUrl);
    if (!safeCheck.ok) {
      throw new Error('Blocked unsafe upstream redirect.');
    }

    const headers = new Headers({
      'User-Agent': 'Mozilla/5.0 (compatible; DhruvTalesMediaProxy/1.0)',
      Accept: '*/*',
    });
    if (rangeHeader) {
      headers.set('Range', rangeHeader);
    }

    const upstream = await fetch(safeCheck.url, {
      method,
      headers,
      redirect: 'manual',
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) return upstream;
      currentUrl = new URL(location, safeCheck.url).toString();
      continue;
    }

    const ct = (upstream.headers.get('content-type') ?? '').toLowerCase();
    if (driveFileId && !confirmTried && method === 'GET' && ct.includes('text/html')) {
      confirmTried = true;
      const html = await upstream.text();
      const confirmUrl = parseDriveConfirmFormUrl(html, driveFileId);
      if (confirmUrl) {
        currentUrl = confirmUrl;
        continue;
      }
    }

    return upstream;
  }

  throw new Error('Too many redirects while streaming media.');
}

async function handleDriveResolvePath(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed', error: 'Use POST /api/drive/resolve-path.' }, 405);
  }

  const authCheck = await verifyFirebaseIdTokenEdge(request.headers.get('authorization'));
  if (!authCheck.ok) {
    return jsonResponse({ code: 'unauthenticated', error: authCheck.message }, authCheck.status);
  }

  let body: { path?: unknown; fileId?: unknown; slot?: unknown };
  try {
    body = (await request.json()) as { path?: unknown; fileId?: unknown; slot?: unknown };
  } catch {
    return jsonResponse({ code: 'invalid_body', error: 'Invalid JSON request body.' }, 400);
  }

  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  const rawFileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
  const slot: 'audio' | 'video' | 'any' =
    body.slot === 'video' ? 'video' : body.slot === 'audio' ? 'audio' : 'any';

  if (!rawPath && !rawFileId) {
    return jsonResponse(
      { code: 'invalid_path', error: 'Provide a Google Drive file path (for example: Trinetra/EP_1.wav).' },
      400
    );
  }

  try {
    const expiresAt = Date.now() + PROXY_TOKEN_TTL_MS;

    if (rawFileId && !rawPath) {
      if (!isValidDriveFileId(rawFileId)) {
        return jsonResponse({ code: 'invalid_drive_id', error: 'Invalid Google Drive file ID.' }, 400);
      }
      const meta = await getDriveFileMetadataWithServiceAccount(rawFileId, env);
      if (!meta.mediaKind) {
        return jsonResponse(
          { code: 'not_media_file', error: `"${meta.name}" is not a supported audio or video file.` },
          400
        );
      }
      const streamFormat = slot === 'video' ? 'video' : meta.mediaKind;
      const token = await signWorkerToken(
        { kind: 'drive', target: meta.id, format: streamFormat, exp: expiresAt },
        env
      );
      return jsonResponse({
        fileId: meta.id,
        name: meta.name,
        normalizedPath: meta.name,
        mimeType: meta.mimeType,
        mediaKind: meta.mediaKind,
        sizeBytes: meta.sizeBytes,
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        previewProxyUrl: `/api/media/proxy?token=${encodeURIComponent(token)}`,
        expiresAt,
      });
    }

    const resolved = await resolveDriveFileByPath(rawPath, slot, env);
    const streamFormat = slot === 'video' ? 'video' : resolved.mediaKind;
    const token = await signWorkerToken(
      { kind: 'drive', target: resolved.fileId, format: streamFormat, exp: expiresAt },
      env
    );

    return jsonResponse({
      ...resolved,
      previewProxyUrl: `/api/media/proxy?token=${encodeURIComponent(token)}`,
      expiresAt,
    });
  } catch (err) {
    if (err instanceof DriveServiceAccountError) {
      return jsonResponse({ code: err.code, error: err.message }, err.status);
    }
    return jsonResponse(
      { code: 'drive_api_error', error: 'Unable to locate this file in Google Drive right now.' },
      502
    );
  }
}

async function handleDriveBrowse(request: Request, url: URL, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ code: 'method_not_allowed', error: 'Use GET /api/drive/browse.' }, 405);
  }

  const authCheck = await verifyFirebaseIdTokenEdge(request.headers.get('authorization'));
  if (!authCheck.ok) {
    return jsonResponse({ code: 'unauthenticated', error: authCheck.message }, authCheck.status);
  }

  try {
    const result = await browseDriveFolder(url.searchParams.get('path') ?? '', env);
    return jsonResponse(result);
  } catch (err) {
    if (err instanceof DriveServiceAccountError) {
      return jsonResponse({ code: err.code, error: err.message }, err.status);
    }
    return jsonResponse(
      { code: 'drive_api_error', error: 'Unable to list files from your Google Drive folder right now.' },
      502
    );
  }
}

async function handleProxyToken(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed', error: 'Use POST /api/media/proxy-token.' }, 405);
  }

  let body: { mediaId?: unknown; format?: unknown };
  try {
    body = (await request.json()) as { mediaId?: unknown; format?: unknown };
  } catch {
    return jsonResponse({ code: 'invalid_body', error: 'Invalid JSON request body.' }, 400);
  }

  const rawMediaId = typeof body.mediaId === 'string' ? body.mediaId.trim() : '';
  const format = body.format === 'video' ? 'video' : body.format === 'audio' ? 'audio' : null;
  if (!rawMediaId || !format) {
    return jsonResponse(
      { code: 'invalid_request', error: 'Provide valid mediaId and format ("audio" or "video").' },
      400
    );
  }

  const expiresAt = Date.now() + PROXY_TOKEN_TTL_MS;
  const driveId = extractDriveIdStrict(rawMediaId);
  if (driveId) {
    const token = await signWorkerToken(
      { kind: 'drive', target: driveId, format, exp: expiresAt },
      env
    );
    return jsonResponse({
      url: `/api/media/proxy?token=${encodeURIComponent(token)}`,
      expiresAt,
      format,
      mimeType: format === 'video' ? 'video/mp4' : 'audio/mpeg',
    });
  }

  const normalized = normalizeUpstreamMediaUrl(rawMediaId);
  const safeCheck = isSafePublicMediaUrl(normalized);
  if (!safeCheck.ok) {
    return jsonResponse({ code: 'invalid_media_url', error: safeCheck.reason }, 400);
  }

  const token = await signWorkerToken(
    { kind: 'url', target: safeCheck.url, format, exp: expiresAt },
    env
  );
  return jsonResponse({
    url: `/api/media/proxy?token=${encodeURIComponent(token)}`,
    expiresAt,
    format,
    mimeType: sanitizeMediaContentType(null, format, safeCheck.url),
  });
}

async function handleProxyStream(request: Request, url: URL, env: WorkerEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ code: 'method_not_allowed', error: 'Use GET /api/media/proxy.' }, 405);
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (
    isDirectBrowserDownloadRequest({
      secFetchDest: request.headers.get('sec-fetch-dest') ?? undefined,
      secFetchMode: request.headers.get('sec-fetch-mode') ?? undefined,
      referer: request.headers.get('referer') ?? undefined,
      host: url.host,
      allowedOrigins,
    })
  ) {
    return jsonResponse(
      {
        code: 'direct_download_blocked',
        error: 'Direct download or external embedding is disabled for protected media.',
      },
      403
    );
  }

  const verification = await verifyWorkerToken(url.searchParams.get('token'), env);
  if (!verification.valid) {
    return jsonResponse({ code: verification.code, error: verification.message }, 401);
  }

  const { kind, target, format } = verification.payload;
  const rangeHeader = validateRangeHeader(request.headers.get('range') ?? undefined);
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';

  let upstreamUrl = '';
  let driveFileId: string | undefined;
  if (kind === 'drive') {
    if (!isValidDriveFileId(target)) {
      return jsonResponse({ code: 'invalid_drive_id', error: 'Invalid Drive file ID.' }, 400);
    }
    driveFileId = target;
    upstreamUrl = buildDriveDownloadUrl(target);
  } else {
    const safeCheck = isSafePublicMediaUrl(target);
    if (!safeCheck.ok) {
      return jsonResponse({ code: 'invalid_media_url', error: safeCheck.reason }, 400);
    }
    upstreamUrl = safeCheck.url;
  }

  try {
    let upstream: Response;
    if (driveFileId && isDriveServiceAccountConfigured(env)) {
      upstream = await fetchDriveStreamWithServiceAccount(driveFileId, rangeHeader, method, env);
    } else {
      upstream = await fetchUpstreamSafe(upstreamUrl, rangeHeader, method, driveFileId);
    }

    const upstreamCt = (upstream.headers.get('content-type') ?? '').toLowerCase();

    if (!upstream.ok && upstream.status !== 206) {
      return jsonResponse(
        {
          code: 'upstream_media_error',
          error: driveFileId
            ? 'Unable to load media from Google Drive. Verify the folder is shared with your Service Account as Viewer.'
            : 'Unable to load media from source.',
        },
        upstream.status === 404 ? 404 : upstream.status === 403 ? 403 : 502
      );
    }

    if (upstreamCt.includes('text/html') || upstreamCt.includes('application/json')) {
      return jsonResponse(
        {
          code: 'not_media_file',
          error: 'The Google Drive file could not be read as audio or video. Check Service Account sharing permissions.',
        },
        502
      );
    }

    const outHeaders = new Headers({
      'Content-Type': sanitizeMediaContentType(upstreamCt, format, target),
      'Content-Disposition': 'inline',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Cache-Control': 'private, no-store, no-transform',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    });

    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) outHeaders.set('Content-Length', contentLength);
    if (contentRange) outHeaders.set('Content-Range', contentRange);

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers: outHeaders,
    });
  } catch (err) {
    if (err instanceof DriveServiceAccountError) {
      return jsonResponse({ code: err.code, error: err.message }, err.status);
    }
    return jsonResponse(
      { code: 'proxy_stream_error', error: 'Unable to stream this media file right now.' },
      502
    );
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/drive/resolve-path') {
      return handleDriveResolvePath(request, env);
    }
    if (path === '/api/drive/browse') {
      return handleDriveBrowse(request, url, env);
    }
    if (path === '/api/media/proxy-token') {
      return handleProxyToken(request, env);
    }
    if (path === '/api/media/proxy') {
      return handleProxyStream(request, url, env);
    }
    if (path === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'dhruv-tales-worker',
        proxy: true,
        driveServiceAccountConfigured: isDriveServiceAccountConfigured(env),
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
