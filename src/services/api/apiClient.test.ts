import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApiUnavailableMessage,
  normalizeApiBaseUrl,
  resolveApiUrl,
} from './apiClient';

test('normalizeApiBaseUrl keeps valid http/https origins and rejects unsafe schemes', () => {
  assert.equal(normalizeApiBaseUrl(''), '');
  assert.equal(normalizeApiBaseUrl('  https://api.dhruvtales.com///  '), 'https://api.dhruvtales.com');
  assert.equal(normalizeApiBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalizeApiBaseUrl('javascript:alert(1)'), '');
  assert.equal(normalizeApiBaseUrl('ftp://files.example.com'), '');
  assert.equal(normalizeApiBaseUrl('not-a-url'), '');
});

test('resolveApiUrl supports same-origin relative paths and external API hosts without double /api', () => {
  assert.equal(resolveApiUrl('/api/session/admin', ''), '/api/session/admin');
  assert.equal(
    resolveApiUrl('/api/session/admin', 'https://api.dhruvtales.com'),
    'https://api.dhruvtales.com/api/session/admin'
  );
  assert.equal(
    resolveApiUrl('/api/media/stream?token=abc', 'https://api.dhruvtales.com/'),
    'https://api.dhruvtales.com/api/media/stream?token=abc'
  );
  assert.equal(
    resolveApiUrl('/api/coins/wallet', 'https://api.dhruvtales.com/api'),
    'https://api.dhruvtales.com/api/coins/wallet'
  );
  assert.equal(
    resolveApiUrl('https://other.example.com/api/test', 'https://api.dhruvtales.com'),
    'https://other.example.com/api/test'
  );
});

test('buildApiUnavailableMessage surfaces server_not_configured reason directly instead of generic local preview text', () => {
  const msg = buildApiUnavailableMessage('/api/session/admin', {
    serverNotConfigured: true,
    errorMessage: 'Firebase Admin credentials are not configured.',
  });
  assert.equal(msg, 'Firebase Admin credentials are not configured.');

  const fallbackMsg = buildApiUnavailableMessage('/api/session/admin', {
    serverNotConfigured: false,
  });
  assert.match(fallbackMsg, /VITE_API_BASE_URL/);
  assert.doesNotMatch(fallbackMsg, /local preview/i);
});
