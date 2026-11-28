import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders, parseAllowedOrigins } from '../_lib/cors';
import {
  DriveServiceAccountError,
  fetchDriveStreamWithServiceAccount,
  isDriveServiceAccountConfigured,
} from '../_lib/driveServiceAccount';
import {
  buildDriveDownloadUrl,
  isDirectBrowserDownloadRequest,
  isSafePublicMediaUrl,
  isValidDriveFileId,
  parseDriveConfirmFormUrl,
  sanitizeMediaContentType,
  validateRangeHeader,
} from '../_lib/mediaProxySecurity';
import { verifyProxyStreamToken } from '../_lib/proxyToken';

function getFirstHeader(val: string | string[] | undefined): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return undefined;
}

function resolveQueryToken(req: VercelRequest): string | null {
  const raw = req.query.token;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

async function fetchUpstreamWithSafeRedirects(
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

    const reqHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (compatible; DhruvTalesMediaProxy/1.0)',
      Accept: '*/*',
    });
    if (rangeHeader) {
      reqHeaders.set('Range', rangeHeader);
    }

    const upstream = await fetch(safeCheck.url, {
      method,
      headers: reqHeaders,
      redirect: 'manual',
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) {
        return upstream;
      }
      currentUrl = new URL(location, safeCheck.url).toString();
      continue;
    }

    // Handle Google Drive large-file HTML virus-scan confirmation page transparently
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

  throw new Error('Too many upstream redirects while loading media.');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/media/proxy.' });
    return;
  }

  // Block direct tab navigation, right-click "Open in new tab", or external hotlinking
  const isBlockedDownload = isDirectBrowserDownloadRequest({
    secFetchDest: getFirstHeader(req.headers['sec-fetch-dest']),
    secFetchMode: getFirstHeader(req.headers['sec-fetch-mode']),
    referer: getFirstHeader(req.headers.referer),
    host: getFirstHeader(req.headers.host),
    forwardedHost: getFirstHeader(req.headers['x-forwarded-host']),
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  });

  if (isBlockedDownload) {
    res.status(403).json({
      code: 'direct_download_blocked',
      error: 'Direct download or external embedding is disabled for protected media.',
    });
    return;
  }

  const token = resolveQueryToken(req);
  const verification = verifyProxyStreamToken(token);
  if (!verification.valid) {
    res.status(401).json({
      code: verification.code,
      error: verification.message,
    });
    return;
  }

  const { kind, target, format } = verification.payload;
  const rangeHeader = validateRangeHeader(getFirstHeader(req.headers.range));
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';

  let upstreamUrl = '';
  let driveFileId: string | undefined;

  if (kind === 'drive') {
    if (!isValidDriveFileId(target)) {
      res.status(400).json({ code: 'invalid_drive_id', error: 'Invalid Drive file ID.' });
      return;
    }
    driveFileId = target;
    upstreamUrl = buildDriveDownloadUrl(target);
  } else {
    const safeCheck = isSafePublicMediaUrl(target);
    if (!safeCheck.ok) {
      res.status(400).json({ code: 'invalid_media_url', error: safeCheck.reason });
      return;
    }
    upstreamUrl = safeCheck.url;
  }

  try {
    let upstream: Response;
    if (driveFileId && isDriveServiceAccountConfigured(process.env)) {
      // Private Service Account Google Drive API v3 streaming (no public link needed!)
      upstream = await fetchDriveStreamWithServiceAccount(
        driveFileId,
        rangeHeader,
        method,
        process.env
      );
    } else {
      upstream = await fetchUpstreamWithSafeRedirects(
        upstreamUrl,
        rangeHeader,
        method,
        driveFileId
      );
    }

    const upstreamContentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status === 404 ? 404 : upstream.status === 403 ? 403 : 502).json({
        code: 'upstream_media_error',
        error: driveFileId
          ? 'Unable to load media from Google Drive. Verify the folder is shared with your Service Account as Viewer.'
          : 'Unable to load media from source.',
      });
      return;
    }

    if (upstreamContentType.includes('text/html') || upstreamContentType.includes('application/json')) {
      res.status(502).json({
        code: 'not_media_file',
        error: 'The Google Drive file could not be read as audio or video. Check Service Account sharing permissions.',
      });
      return;
    }

    const contentType = sanitizeMediaContentType(upstreamContentType, format, target);
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

    res.setHeader('Content-Type', contentType);
    // Force inline streaming with no attachment filename leak
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Accept-Ranges', acceptRanges);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const responseStatus = upstream.status === 206 ? 206 : 200;
    res.status(responseStatus);

    if (method === 'HEAD') {
      res.end();
      return;
    }

    if (!upstream.body) {
      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
      return;
    }

    const reader = upstream.body.getReader();
    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
      void reader.cancel().catch(() => undefined);
    });

    try {
      while (!clientClosed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          const ok = res.write(Buffer.from(value));
          if (!ok && !clientClosed) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      }
    } finally {
      reader.releaseLock();
      if (!res.writableEnded) {
        res.end();
      }
    }
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (err instanceof DriveServiceAccountError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/media/proxy] Streaming error:', err);
    res.status(502).json({
      code: 'proxy_stream_error',
      error: 'Unable to stream this media file right now.',
    });
  }
}
