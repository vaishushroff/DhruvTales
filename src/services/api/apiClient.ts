/**
 * Portable API URL resolver so the Dhruv Tales frontend works on ANY static or full-stack host:
 * - Same-origin (Vercel, Render, Railway, Cloud Run, VPS, Docker, local dev): leave VITE_API_BASE_URL empty.
 * - Split hosting (Cloudflare Pages, Netlify, Firebase Hosting, Capacitor mobile): set VITE_API_BASE_URL=https://api.yourdomain.com
 */

export function normalizeApiBaseUrl(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    // Preserve optional path prefix without trailing slash
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return '';
  }
}

export function getConfiguredApiBaseUrl(): string {
  const envBase =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_API_BASE_URL as string | undefined)
      : undefined;
  return normalizeApiBaseUrl(envBase);
}

/**
 * Resolves a relative `/api/...` route against the configured API base URL (if any).
 */
export function resolveApiUrl(
  path: string,
  baseUrlOverride?: string | null
): string {
  const cleanPath = path.trim();
  if (/^https?:\/\//i.test(cleanPath)) {
    return cleanPath;
  }
  const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  const base =
    baseUrlOverride !== undefined
      ? normalizeApiBaseUrl(baseUrlOverride)
      : getConfiguredApiBaseUrl();

  if (!base) {
    return normalizedPath;
  }
  // Avoid double `/api/api/...` if user set VITE_API_BASE_URL=https://host/api
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
}

export interface ApiJsonResponse {
  available: boolean;
  serverNotConfigured: boolean;
  status: number;
  data: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Shared JSON fetch wrapper that clearly distinguishes:
 * 1. Backend server unreachable or static-only host returning HTML/404 (`available: false`, `serverNotConfigured: false`)
 * 2. Backend server reachable but missing server env vars (`503 server_not_configured` -> `available: false`, `serverNotConfigured: true`, with real `errorMessage`)
 * 3. Live backend response (`available: true`)
 */
export async function fetchApiJson(
  path: string,
  init: RequestInit
): Promise<ApiJsonResponse> {
  const targetUrl = resolveApiUrl(path);
  try {
    const response = await fetch(targetUrl, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return {
        available: false,
        serverNotConfigured: false,
        status: response.status,
        data: {},
      };
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (response.status === 503 && data.code === 'server_not_configured') {
      return {
        available: false,
        serverNotConfigured: true,
        status: response.status,
        data,
        errorMessage:
          typeof data.error === 'string' && data.error.trim()
            ? data.error.trim()
            : 'Backend API reached, but server environment variables (Firebase Admin credentials) are not configured yet.',
      };
    }
    return {
      available: true,
      serverNotConfigured: false,
      status: response.status,
      data,
    };
  } catch {
    return {
      available: false,
      serverNotConfigured: false,
      status: 0,
      data: {},
    };
  }
}

export function buildApiUnavailableMessage(
  endpoint: string,
  res: Pick<ApiJsonResponse, 'serverNotConfigured' | 'errorMessage'>
): string {
  if (res.serverNotConfigured && res.errorMessage) {
    return res.errorMessage;
  }
  const base = getConfiguredApiBaseUrl();
  if (base) {
    return `Could not reach ${endpoint} at ${base}. Verify your Node API server is running, CORS ALLOWED_ORIGINS includes this site, and Firebase Admin env vars are set.`;
  }
  return `Server API ${endpoint} is not reachable on this host. If your frontend is on static hosting (such as Cloudflare Pages), deploy the Node API server and set VITE_API_BASE_URL, or run the full-stack server with Firebase Admin env vars.`;
}
