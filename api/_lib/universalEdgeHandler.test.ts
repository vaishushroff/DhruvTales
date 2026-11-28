import assert from 'node:assert/strict';
import test from 'node:test';
import { build as esbuild } from 'esbuild';
import {
  handleUniversalEdgeApiRequest,
  signEdgeProxyToken,
  verifyEdgeProxyToken,
  type UniversalEdgeEnv,
} from './universalEdgeHandler';

test('Cloudflare Workers Error 10021 guard: worker.ts bundles cleanly with zero Node built-ins and zero global-scope disallowed ops', async () => {
  // 1. Bundle worker.ts as a neutral/browser ESM module (same constraint as Wrangler / Cloudflare Workers)
  const result = await esbuild({
    entryPoints: ['worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });

  assert.equal(result.errors.length, 0);
  const code = result.outputFiles[0]?.text ?? '';
  assert.ok(code.length > 500, 'Expected non-empty bundled worker script');
  assert.equal(code.includes('node:crypto'), false, 'Worker bundle must not import node:crypto');
  assert.equal(code.includes('node:fs'), false, 'Worker bundle must not import node:fs');

  // 2. Execute the bundled module with global crypto.getRandomValues, fetch, setTimeout, and setInterval
  // throwing — replicating Cloudflare Workers startup snapshot enforcement (Error 10021).
  const origGetRandomValues = crypto.getRandomValues.bind(crypto);
  const origFetch = globalThis.fetch;
  const origSetTimeout = globalThis.setTimeout;
  const origSetInterval = globalThis.setInterval;

  const throwGlobal = (name: string) => () => {
    throw new Error(`Disallowed global-scope operation during startup: ${name}`);
  };

  Object.defineProperty(crypto, 'getRandomValues', {
    value: throwGlobal('crypto.getRandomValues'),
    configurable: true,
  });
  globalThis.fetch = throwGlobal('fetch') as typeof fetch;
  globalThis.setTimeout = throwGlobal('setTimeout') as unknown as typeof setTimeout;
  globalThis.setInterval = throwGlobal('setInterval') as unknown as typeof setInterval;

  try {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
    const workerModule = (await import(dataUrl)) as {
      default?: { fetch?: (req: Request, env: Record<string, unknown>) => Promise<Response> };
    };
    assert.equal(typeof workerModule.default?.fetch, 'function');
  } finally {
    Object.defineProperty(crypto, 'getRandomValues', {
      value: origGetRandomValues,
      configurable: true,
    });
    globalThis.fetch = origFetch;
    globalThis.setTimeout = origSetTimeout;
    globalThis.setInterval = origSetInterval;
  }
});

test('handleUniversalEdgeApiRequest serves /api/health, CORS preflight, and passes non-API routes through', async () => {
  const env: UniversalEdgeEnv = {
    ALLOWED_ORIGINS: 'https://stories.example.com',
  };

  const nonApi = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/story/trinetra'),
    env
  );
  assert.equal(nonApi, null);

  const healthRes = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/api/health', {
      headers: { Origin: 'https://stories.example.com' },
    }),
    env,
    'dhruv-tales-test'
  );
  assert.ok(healthRes);
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.headers.get('access-control-allow-origin'), 'https://stories.example.com');
  const body = (await healthRes.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.service, 'dhruv-tales-test');
  assert.equal(body.driveConfigured, false);

  const preflight = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/api/drive/browse', {
      method: 'OPTIONS',
      headers: { Origin: 'https://stories.example.com' },
    }),
    env
  );
  assert.ok(preflight);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://stories.example.com');
});

test('handleUniversalEdgeApiRequest enforces auth on Drive endpoints and blocks direct browser tab downloads', async () => {
  const env: UniversalEdgeEnv = {};

  const browseRes = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/api/drive/browse'),
    env
  );
  assert.ok(browseRes);
  assert.equal(browseRes.status, 401);

  const resolveRes = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/api/drive/resolve-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'Trinetra/EP_1.wav' }),
    }),
    env
  );
  assert.ok(resolveRes);
  assert.equal(resolveRes.status, 401);

  const docNavRes = await handleUniversalEdgeApiRequest(
    new Request('https://tales.example.com/api/media/proxy?token=v1.invalid', {
      headers: { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' },
    }),
    env
  );
  assert.ok(docNavRes);
  assert.equal(docNavRes.status, 403);
});

test('edge proxy tokens encrypt Drive IDs and verify consistently using Service Account-derived keys across isolates', async () => {
  const env: UniversalEdgeEnv = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'drive-reader@dhruv-tales.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nTESTKEYMATERIAL1234567890\n-----END PRIVATE KEY-----\n',
    }),
  };

  const token = await signEdgeProxyToken(
    {
      kind: 'drive',
      target: '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h',
      format: 'audio',
      exp: Date.now() + 60_000,
    },
    env
  );

  assert.ok(token.startsWith('v1.'));
  assert.equal(token.includes('1LU6N'), false);

  const verified = await verifyEdgeProxyToken(token, env);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.kind, 'drive');
    assert.equal(verified.payload.target, '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h');
    assert.equal(verified.payload.format, 'audio');
  }

  // Tampered token must fail authenticated AES-GCM decryption
  const tampered = `${token.slice(0, -4)}AAAA`;
  const failed = await verifyEdgeProxyToken(tampered, env);
  assert.equal(failed.valid, false);
});

test('Service Account parser handles raw newlines in pasted JSON, outer quotes, base64, Cloudflare Secrets Store bindings, and clear diagnostics', async () => {
  const { parseServiceAccountJsonString, resolveDriveServiceAccountCredsAsync } = await import(
    './driveServiceAccount'
  );

  // 1. Raw unescaped newlines inside private_key (common when pasting JSON into web secret inputs)
  const rawNewlineJson = `{
    "type": "service_account",
    "client_email": "drive-reader@dhruv-tales.iam.gserviceaccount.com",
    "private_key": "-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj
-----END PRIVATE KEY-----
"
  }`;
  const parsedRaw = parseServiceAccountJsonString(rawNewlineJson);
  assert.ok(parsedRaw);
  assert.equal(parsedRaw.clientEmail, 'drive-reader@dhruv-tales.iam.gserviceaccount.com');
  assert.ok(parsedRaw.privateKey.includes('BEGIN PRIVATE KEY'));

  // 2. Outer single quotes around JSON
  const quoted = `'{"client_email":"sa@dhruv-tales.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\\\nABC\\\\n-----END PRIVATE KEY-----"}'`;
  const parsedQuoted = parseServiceAccountJsonString(quoted);
  assert.ok(parsedQuoted);
  assert.equal(parsedQuoted.clientEmail, 'sa@dhruv-tales.iam.gserviceaccount.com');

  // 3. Cloudflare Secrets Store binding ({ get(): Promise<string> })
  const storeRes = await resolveDriveServiceAccountCredsAsync({
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: {
      get: async () => rawNewlineJson,
    },
  });
  assert.equal(storeRes.diagnostic.status, 'ok');
  assert.equal(storeRes.creds?.clientEmail, 'drive-reader@dhruv-tales.iam.gserviceaccount.com');

  // 4. Distinguishes missing_env vs invalid_json
  const missingRes = await resolveDriveServiceAccountCredsAsync({});
  assert.equal(missingRes.diagnostic.status, 'missing_env');

  const invalidRes = await resolveDriveServiceAccountCredsAsync({
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: 'not-valid-json-at-all',
  });
  assert.equal(invalidRes.diagnostic.status, 'invalid_json');
});
