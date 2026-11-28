import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from '../_lib/cors';
import { browseDriveFolder, DriveServiceAccountError } from '../_lib/driveServiceAccount';
import { verifyFirebaseIdTokenEdge } from '../_lib/firebaseEdgeAuth';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/drive/browse.' });
    return;
  }

  const authCheck = await verifyFirebaseIdTokenEdge(req.headers.authorization);
  if (!authCheck.ok) {
    res.status(authCheck.status).json({ code: 'unauthenticated', error: authCheck.message });
    return;
  }

  const rawPath =
    typeof req.query.path === 'string'
      ? req.query.path
      : Array.isArray(req.query.path)
        ? req.query.path[0]
        : '';

  try {
    const result = await browseDriveFolder(rawPath, process.env);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof DriveServiceAccountError) {
      res.status(err.status).json({ code: err.code, error: err.message });
      return;
    }
    res.status(502).json({
      code: 'drive_api_error',
      error: 'Unable to list files from your Google Drive folder right now.',
    });
  }
}
