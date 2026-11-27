import type { IncomingMessage, ServerResponse } from 'node:http';

const ALLOW_METHODS = 'GET, POST, HEAD, OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type, Range';
const EXPOSE_HEADERS = 'Content-Range, Accept-Ranges, Content-Length';

/**
 * Parses comma-separated origins from ALLOWED_ORIGINS env var into normalized origin strings.
 * Wildcard "*" is intentionally ignored so authenticated API routes never emit wildcard CORS.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed === '*') continue;
    try {
      const parsed = new URL(trimmed);
      if (
        parsed.protocol === 'https:' ||
        parsed.protocol === 'http:' ||
        parsed.protocol === 'capacitor:' ||
        parsed.protocol === 'ionic:'
      ) {
        const normalized =
          parsed.protocol === 'capacitor:' || parsed.protocol === 'ionic:'
            ? `${parsed.protocol}//${parsed.host}`
            : parsed.origin;
        if (!origins.includes(normalized)) {
          origins.push(normalized);
        }
      }
    } catch {
      // Ignore malformed origin entries
    }
  }
  return origins;
}

/**
 * Determines whether a request Origin is permitted for CORS on /api/* endpoints.
 * Permits:
 * - Same-origin requests matching Host or X-Forwarded-Host
 * - Explicitly allowlisted origins from ALLOWED_ORIGINS
 * - Localhost dev origins when isDev === true
 */
export function isOriginAllowed(params: {
  origin: string | undefined;
  hostHeader: string | undefined;
  forwardedHostHeader?: string | undefined;
  allowedOrigins: string[];
  isDev?: boolean;
}): boolean {
  const origin = params.origin?.trim();
  if (!origin) return false;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const normalizedOrigin =
    parsedOrigin.protocol === 'capacitor:' || parsedOrigin.protocol === 'ionic:'
      ? `${parsedOrigin.protocol}//${parsedOrigin.host}`
      : parsedOrigin.origin;

  // 1. Explicit allowlist match
  if (params.allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  // 2. Same-origin match against Host / X-Forwarded-Host
  const candidateHosts = [params.forwardedHostHeader, params.hostHeader]
    .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    .flatMap((h) => h.split(',').map((s) => s.trim().toLowerCase()))
    .filter(Boolean);

  if (candidateHosts.includes(parsedOrigin.host.toLowerCase())) {
    return true;
  }

  // 3. Local development convenience (strictly disabled in production)
  if (
    params.isDev &&
    (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1')
  ) {
    return true;
  }

  return false;
}

function appendVaryOrigin(res: ServerResponse): void {
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', 'Origin');
    return;
  }
  const current = Array.isArray(existing) ? existing.join(', ') : String(existing);
  if (!current.toLowerCase().includes('origin')) {
    res.setHeader('Vary', `${current}, Origin`);
  }
}

/**
 * Applies strict allowlist-based CORS headers for portable cross-host deployments
 * (e.g., Cloudflare Pages / Capacitor frontend calling Vercel / Render / VPS / Cloud Run API).
 * Returns true if the request was an OPTIONS preflight that has already been answered.
 */
export function applyCorsHeaders(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  res: ServerResponse
): boolean {
  const rawOrigin = Array.isArray(req.headers.origin)
    ? req.headers.origin[0]
    : req.headers.origin;
  const hostHeader = Array.isArray(req.headers.host)
    ? req.headers.host[0]
    : req.headers.host;
  const forwardedHost = Array.isArray(req.headers['x-forwarded-host'])
    ? req.headers['x-forwarded-host'][0]
    : req.headers['x-forwarded-host'];

  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const isDev = process.env.NODE_ENV !== 'production';

  appendVaryOrigin(res);

  const permitted = isOriginAllowed({
    origin: rawOrigin,
    hostHeader,
    forwardedHostHeader: forwardedHost,
    allowedOrigins,
    isDev,
  });

  if (rawOrigin && permitted) {
    res.setHeader('Access-Control-Allow-Origin', rawOrigin);
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = rawOrigin && !permitted ? 403 : 204;
    res.end();
    return true;
  }

  return false;
}
