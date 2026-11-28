import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';
import {
  DriveServiceAccountError,
  getDriveFileMetadataWithServiceAccount,
  resolveDriveFileByPath,
} from '../_lib/driveServiceAccount';
import { verifyFirebaseIdTokenEdge } from '../_lib/firebaseEdgeAuth';
import { isValidDriveFileId } from '../_lib/mediaProxySecurity';
import { createProxyStreamToken } from '../_lib/proxyToken';

interface ResolvePathRequestBody {
  path?: unknown;
  fileId?: unknown;
  slot?: unknown;
}

function parseBody(req: VercelRequest): ResolvePathRequestBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as ResolvePathRequestBody;
    } catch {
      return {};
    }
  }
  return req.body as ResolvePathRequestBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use POST /api/drive/resolve-path.' });
    return;
  }

  const authCheck = await verifyFirebaseIdTokenEdge(req.headers.authorization);
  if (!authCheck.ok) {
    res.status(authCheck.status).json({ code: 'unauthenticated', error: authCheck.message });
    return;
  }

  const body = parseBody(req);
  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  const rawFileId = typeof body.fileId === 'string' ? body.fileId.trim() : '';
  const slot: 'audio' | 'video' | 'any' =
    body.slot === 'video' ? 'video' : body.slot === 'audio' ? 'audio' : 'any';

  if (!rawPath && !rawFileId) {
    res.status(400).json({
      code: 'invalid_path',
      error: 'Provide a Google Drive file path (for example: Trinetra/EP_1.wav).',
    });
    return;
  }

  try {
    if (rawFileId && !rawPath) {
      if (!isValidDriveFileId(rawFileId)) {
        res.status(400).json({ code: 'invalid_drive_id', error: 'Invalid Google Drive file ID.' });
        return;
      }
      const meta = await getDriveFileMetadataWithServiceAccount(rawFileId, process.env);
      if (!meta.mediaKind) {
        res.status(400).json({
          code: 'not_media_file',
          error: `"${meta.name}" is not a supported audio or video file (${meta.mimeType}).`,
        });
        return;
      }
      const streamFormat = slot === 'video' ? 'video' : meta.mediaKind;
      const { token, expiresAt } = createProxyStreamToken({
        kind: 'drive',
        target: meta.id,
        format: streamFormat,
      });
      res.status(200).json({
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
      return;
    }

    const resolved = await resolveDriveFileByPath(rawPath, slot, process.env);
    const streamFormat = slot === 'video' ? 'video' : resolved.mediaKind;
    const { token, expiresAt } = createProxyStreamToken({
      kind: 'drive',
      target: resolved.fileId,
      format: streamFormat,
    });

    res.status(200).json({
      ...resolved,
      previewProxyUrl: `/api/media/proxy?token=${encodeURIComponent(token)}`,
      expiresAt,
    });
  } catch (err) {
    if (err instanceof DriveServiceAccountError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    res.status(502).json({
      code: 'drive_api_error',
      error: 'Unable to locate this file in Google Drive right now.',
    });
  }
}
