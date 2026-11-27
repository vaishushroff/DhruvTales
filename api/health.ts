import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders, parseAllowedOrigins } from './_lib/cors';

/**
 * Non-sensitive health & configuration status endpoint.
 * Works identically on Vercel serverless and the portable Node server (`server.ts`).
 * Never exposes secret values—only booleans showing whether required env vars are present.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCorsHeaders(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.status(405).json({ code: 'method_not_allowed', error: 'Use GET /api/health.' });
    return;
  }

  const firebaseAdminConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      (process.env.FIREBASE_PROJECT_ID?.trim() &&
        process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
        process.env.FIREBASE_PRIVATE_KEY?.trim())
  );
  const driveConfigured = Boolean(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim());
  const mediaSigningConfigured = Boolean(process.env.MEDIA_SIGNING_SECRET?.trim());
  const corsAllowedOriginsCount = parseAllowedOrigins(process.env.ALLOWED_ORIGINS).length;

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    ok: true,
    service: 'dhruv-tales-api',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
    checks: {
      firebaseAdminConfigured,
      driveConfigured,
      mediaSigningConfigured,
      corsAllowedOriginsCount,
    },
  });
}
