import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';
import {
  DriveClientError,
  fetchDriveFileRange,
  getDriveFileMetadata,
} from '../_lib/driveClient';
import { getAdminDb, ServerConfigError } from '../_lib/firebaseAdmin';
import {
  getDefaultMimeTypeForFormat,
  mapFirestoreEpisode,
  resolveDriveRefForFormat,
} from '../_lib/firestoreModels';
import { getMediaSigningSecret, verifyMediaStreamToken } from '../_lib/mediaToken';
import { MAX_STREAM_CHUNK_BYTES, parseByteRange } from '../_lib/rangeParser';

function resolveQueryToken(req: VercelRequest): string | null {
  const raw = req.query.token;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/media/stream.' });
    return;
  }

  // 1. Verify HMAC-signed token & expiration
  const token = resolveQueryToken(req);
  const verification = verifyMediaStreamToken(token, getMediaSigningSecret());
  if (!verification.valid) {
    const status = verification.code === 'server_not_configured' ? 503 : 401;
    res.status(status).json({
      code: verification.code,
      error: verification.message,
    });
    return;
  }

  const { episodeId, uid, format } = verification.payload;

  try {
    // 2. Resolve Google Drive file ID strictly from Firestore on the server (and enforce ban block)
    const db = getAdminDb();
    const [episodeSnap, userSnap] = await Promise.all([
      db.collection('episodes').doc(episodeId).get(),
      uid && uid !== 'guest' ? db.collection('users').doc(uid).get() : Promise.resolve(null),
    ]);

    if (userSnap?.exists) {
      const userData = userSnap.data();
      if (userData?.banned === true || userData?.isDisabled === true) {
        res.status(403).json({
          code: 'account_banned',
          error: 'This account has been banned and cannot stream media.',
        });
        return;
      }
    }

    if (!episodeSnap.exists) {
      res.status(404).json({
        code: 'episode_not_found',
        error: 'Episode not found.',
      });
      return;
    }

    const episode = mapFirestoreEpisode(episodeSnap.id, episodeSnap.data() ?? {});
    const driveRef = resolveDriveRefForFormat(episode, format);
    if (!driveRef) {
      res.status(404).json({
        code: 'file_not_found',
        error: `No Google Drive ${format} file is attached to this episode.`,
      });
      return;
    }

    // 3. Read Drive metadata to obtain total byte size and content type
    const meta = await getDriveFileMetadata(driveRef.id);
    if (meta.size <= 0) {
      res.status(404).json({
        code: 'file_not_found',
        error: 'The Google Drive media file is empty or unreadable.',
      });
      return;
    }

    const contentType =
      meta.mimeType && meta.mimeType !== 'application/octet-stream'
        ? meta.mimeType
        : getDefaultMimeTypeForFormat(format);

    // 4. Parse Range header and enforce ~3 MB max chunk cap for Vercel serverless stability
    const rangeHeader =
      typeof req.headers.range === 'string'
        ? req.headers.range
        : Array.isArray(req.headers.range)
          ? req.headers.range[0]
          : undefined;

    const range = parseByteRange(rangeHeader, meta.size, MAX_STREAM_CHUNK_BYTES);
    if (!range.ok) {
      res.setHeader('Content-Range', `bytes */${meta.size}`);
      res.status(416).json({
        code: 'range_not_satisfiable',
        error: range.message,
      });
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(range.length));
    if (range.isPartial) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.totalSize}`);
    }

    if (req.method === 'HEAD') {
      res.status(range.status).end();
      return;
    }

    // 5. Fetch the bounded byte range from Google Drive API and stream to client
    const driveResponse = await fetchDriveFileRange(driveRef.id, range.start, range.end);
    res.status(range.status);

    if (!driveResponse.body) {
      const arrayBuf = await driveResponse.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
      return;
    }

    const reader = driveResponse.body.getReader();
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
          const canContinue = res.write(Buffer.from(value));
          if (!canContinue && !clientClosed) {
            await new Promise<void>((resolve) => {
              res.once('drain', resolve);
            });
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
    if (err instanceof DriveClientError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    if (err instanceof ServerConfigError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    console.error('[api/media/stream] Unexpected error:', err);
    res.status(500).json({
      code: 'stream_error',
      error: 'Unable to stream media from Google Drive right now.',
    });
  }
}
