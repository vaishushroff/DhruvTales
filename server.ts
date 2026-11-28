import dotenv from 'dotenv';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCorsHeaders } from './api/_lib/cors';
import adminAnalyticsHandler from './api/admin/analytics';
import adminCmsHandler from './api/admin/cms';
import coinsAdminAdjustHandler from './api/coins/admin-adjust';
import coinsPricingHandler from './api/coins/pricing';
import coinsPurchaseHandler from './api/coins/purchase';
import coinsUnlockHandler from './api/coins/unlock';
import coinsWalletHandler from './api/coins/wallet';
import driveBrowseHandler from './api/drive/browse';
import driveResolvePathHandler from './api/drive/resolve-path';
import healthHandler from './api/health';
import mediaAuthorizeHandler from './api/media/authorize';
import mediaImportFolderHandler from './api/media/import-folder';
import mediaProxyHandler from './api/media/proxy';
import mediaProxyTokenHandler from './api/media/proxy-token';
import mediaStreamHandler from './api/media/stream';
import sessionAdminHandler from './api/session/admin';
import sessionLogoutHandler from './api/session/logout';
import sessionRegisterHandler from './api/session/register';

// Load local env files without overriding host-injected environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

const API_ROUTES: Record<string, ApiHandler> = {
  '/api/health': healthHandler,
  '/api/admin/analytics': adminAnalyticsHandler,
  '/api/admin/cms': adminCmsHandler,
  '/api/coins/admin-adjust': coinsAdminAdjustHandler,
  '/api/coins/pricing': coinsPricingHandler,
  '/api/coins/purchase': coinsPurchaseHandler,
  '/api/coins/unlock': coinsUnlockHandler,
  '/api/coins/wallet': coinsWalletHandler,
  '/api/drive/browse': driveBrowseHandler,
  '/api/drive/resolve-path': driveResolvePathHandler,
  '/api/media/authorize': mediaAuthorizeHandler,
  '/api/media/import-folder': mediaImportFolderHandler,
  '/api/media/proxy': mediaProxyHandler,
  '/api/media/proxy-token': mediaProxyTokenHandler,
  '/api/media/stream': mediaStreamHandler,
  '/api/session/admin': sessionAdminHandler,
  '/api/session/logout': sessionLogoutHandler,
  '/api/session/register': sessionRegisterHandler,
};

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB JSON payload cap

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

function parseQueryParams(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  return query;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the 1 MB limit.');
    this.name = 'PayloadTooLargeError';
  }
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function decorateVercelResponse(res: ServerResponse): VercelResponse {
  const vRes = res as unknown as VercelResponse;

  vRes.status = (statusCode: number) => {
    res.statusCode = statusCode;
    return vRes;
  };

  vRes.json = (body: unknown) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(body));
    return vRes;
  };

  vRes.send = (body: unknown) => {
    if (body === undefined || body === null) {
      res.end();
      return vRes;
    }
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      res.end(body);
      return vRes;
    }
    if (typeof body === 'object') {
      return vRes.json(body);
    }
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end(String(body));
    return vRes;
  };

  vRes.redirect = (statusOrUrl: number | string, maybeUrl?: string) => {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const url = typeof statusOrUrl === 'string' ? statusOrUrl : maybeUrl ?? '/';
    res.statusCode = status;
    res.setHeader('Location', url);
    res.end();
    return vRes;
  };

  return vRes;
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  if (applyCorsHeaders(req, res)) {
    return;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const handler = API_ROUTES[normalizedPath];
  const vRes = decorateVercelResponse(res);

  if (!handler) {
    res.setHeader('Cache-Control', 'no-store');
    vRes.status(404).json({
      code: 'not_found',
      error: `API route "${normalizedPath}" not found.`,
    });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readRequestBody(req);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      vRes.status(413).json({ code: 'payload_too_large', error: err.message });
      return;
    }
    vRes.status(400).json({ code: 'invalid_body', error: 'Unable to read request body.' });
    return;
  }

  const vReq = req as unknown as VercelRequest;
  vReq.query = parseQueryParams(url.searchParams);
  vReq.cookies = parseCookies(
    Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie
  );
  vReq.body = parsedBody;

  try {
    await handler(vReq, vRes);
    if (!res.writableEnded && !res.headersSent) {
      res.statusCode = 204;
      res.end();
    }
  } catch (err) {
    console.error(`[server] Unhandled error in ${normalizedPath}:`, err);
    if (!res.headersSent) {
      vRes.status(500).json({
        code: 'internal_error',
        error: 'An unexpected server error occurred.',
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

function serveStaticProduction(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  distDir: string
): void {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  if (decodedPath.includes('\0')) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  // Block hidden dotfiles (e.g. /.env, /.git)
  const segments = decodedPath.split('/').filter(Boolean);
  if (segments.some((seg) => seg.startsWith('.'))) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const resolvedCandidate = path.resolve(distDir, relativePath);
  const isInsideDist =
    resolvedCandidate === distDir || resolvedCandidate.startsWith(distDir + path.sep);

  let targetFile: string | null = null;
  if (isInsideDist && fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isFile()) {
    targetFile = resolvedCandidate;
  } else if (!path.extname(relativePath)) {
    // SPA client-side route fallback -> dist/index.html
    const spaIndex = path.resolve(distDir, 'index.html');
    if (fs.existsSync(spaIndex)) {
      targetFile = spaIndex;
    }
  }

  if (!targetFile) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
    return;
  }

  const ext = path.extname(targetFile).toLowerCase();
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (targetFile.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (ext === '.html' || path.basename(targetFile) === 'sw.js' || path.basename(targetFile) === 'registerSW.js') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  const stat = fs.statSync(targetFile);
  res.setHeader('Content-Length', String(stat.size));
  res.statusCode = 200;

  if (method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(targetFile).pipe(res);
}

export async function startPortableServer(options?: {
  port?: number;
  host?: string;
  isProd?: boolean;
  apiOnly?: boolean;
}): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const isProd =
    options?.isProd ??
    (process.env.NODE_ENV === 'production' || process.argv.includes('--prod'));
  const apiOnly = options?.apiOnly ?? process.env.API_ONLY === 'true';
  const port = options?.port ?? Number(process.env.PORT || 3000);
  const host = options?.host ?? process.env.HOST ?? '0.0.0.0';
  const serverFilename = fileURLToPath(import.meta.url);
  const serverDirname = path.dirname(serverFilename);
  const distDir = path.resolve(serverDirname, 'dist');

  let viteMiddleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null =
    null;
  let closeVite: (() => Promise<void>) | null = null;

  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const isViteDevSharedLib = Boolean(viteMiddleware) && parsedUrl.pathname.startsWith('/api/_lib/');
    if (!isViteDevSharedLib && (parsedUrl.pathname === '/api' || parsedUrl.pathname.startsWith('/api/'))) {
      void handleApiRequest(req, res, parsedUrl);
      return;
    }

    if (apiOnly) {
      const vRes = decorateVercelResponse(res);
      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/health') {
        vRes.status(200).json({ ok: true, service: 'dhruv-tales-api', health: '/api/health' });
      } else {
        vRes.status(404).json({ code: 'not_found', error: 'API-only mode enabled.' });
      }
      return;
    }

    if (viteMiddleware) {
      viteMiddleware(req, res, () => {
        if (!res.writableEnded) {
          res.statusCode = 404;
          res.end('Not Found');
        }
      });
      return;
    }

    serveStaticProduction(req, res, parsedUrl, distDir);
  });

  if (!isProd && !apiOnly) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : true,
        ws: { server },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    viteMiddleware = vite.middlewares;
    closeVite = () => vite.close();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  const modeLabel = apiOnly ? 'api-only' : isProd ? 'production (dist + /api)' : 'development (vite + /api)';
  console.log(`[Dhruv Tales] Listening on http://${host}:${boundPort} [${modeLabel}]`);

  return {
    server,
    port: boundPort,
    close: async () => {
      if (closeVite) await closeVite();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// Start directly when executed as main entry (`tsx server.ts` or `tsx server.ts --prod`)
const currentServerFilename = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(currentServerFilename);

if (isDirectRun) {
  void startPortableServer().catch((err) => {
    console.error('[Dhruv Tales] Failed to start server:', err);
    process.exit(1);
  });
}
