import test from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, parseAllowedOrigins } from './cors';

test('parseAllowedOrigins parses valid origins, trims trailing slashes, and rejects wildcards', () => {
  const parsed = parseAllowedOrigins(
    'https://dhruvtales.pages.dev/, *, https://dhruvtales.com, capacitor://localhost, javascript:alert(1), not-a-url'
  );
  assert.deepEqual(parsed, [
    'https://dhruvtales.pages.dev',
    'https://dhruvtales.com',
    'capacitor://localhost',
  ]);
});

test('isOriginAllowed permits allowlisted, same-origin, and Capacitor origins while blocking untrusted origins', () => {
  const allowedOrigins = parseAllowedOrigins(
    'https://dhruvtales.pages.dev, capacitor://localhost'
  );

  assert.equal(
    isOriginAllowed({
      origin: 'https://dhruvtales.pages.dev',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins,
      isDev: false,
    }),
    true
  );

  assert.equal(
    isOriginAllowed({
      origin: 'capacitor://localhost',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins,
      isDev: false,
    }),
    true
  );

  assert.equal(
    isOriginAllowed({
      origin: 'https://api.dhruvtales.com',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins: [],
      isDev: false,
    }),
    true
  );

  assert.equal(
    isOriginAllowed({
      origin: 'https://evil.example.com',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins,
      isDev: false,
    }),
    false
  );

  assert.equal(
    isOriginAllowed({
      origin: 'http://localhost:3000',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins: [],
      isDev: false,
    }),
    false
  );

  assert.equal(
    isOriginAllowed({
      origin: 'http://localhost:3000',
      hostHeader: 'api.dhruvtales.com',
      allowedOrigins: [],
      isDev: true,
    }),
    true
  );
});
