import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';
import {
  extractDriveIdStrict,
  isSafePublicMediaUrl,
  normalizeUpstreamMediaUrl,
  sanitizeMediaContentType,
} from '../_lib/mediaProxySecurity';
import { createProxyStreamToken } from '../_lib/proxyToken';

interface ProxyTokenBody {
  mediaId?: unknown;
  provider?: unknown;
  format?: unknown;
}

function parseBody(req: VercelRequest): ProxyTokenBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as ProxyTokenBody;
    } catch {
      return {};
    }
  }
  return req.body as ProxyTokenBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/media/proxy-token.' });
    return;
  }

  const body = parseBody(req);
  const rawMediaId = typeof body.mediaId === 'string' ? body.mediaId.trim() : '';
  const format = body.format === 'video' ? 'video' : body.format === 'audio' ? 'audio' : null;

  if (!rawMediaId || !format) {
    res.status(400).json({
      code: 'invalid_request',
      error: 'Provide valid mediaId and format ("audio" or "video").',
    });
    return;
  }

  const driveId = extractDriveIdStrict(rawMediaId);
  if (driveId) {
    const { token, expiresAt } = createProxyStreamToken({
      kind: 'drive',
      target: driveId,
      format,
    });
    res.status(200).json({
      url: `/api/media/proxy?token=${encodeURIComponent(token)}`,
      expiresAt,
      format,
      mimeType: format === 'video' ? 'video/mp4' : 'audio/mpeg',
    });
    return;
  }

  const normalized = normalizeUpstreamMediaUrl(rawMediaId);
  const safeCheck = isSafePublicMediaUrl(normalized);
  if (!safeCheck.ok) {
    res.status(400).json({
      code: 'invalid_media_url',
      error: safeCheck.reason,
    });
    return;
  }

  const { token, expiresAt } = createProxyStreamToken({
    kind: 'url',
    target: safeCheck.url,
    format,
  });

  res.status(200).json({
    url: `/api/media/proxy?token=${encodeURIComponent(token)}`,
    expiresAt,
    format,
    mimeType: sanitizeMediaContentType(null, format, safeCheck.url),
  });
}
