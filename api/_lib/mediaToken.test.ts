import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMediaStreamToken,
  MEDIA_TOKEN_TTL_MS,
  verifyMediaStreamToken,
} from './mediaToken';

const TEST_SECRET = 'dhruv-tales-test-signing-secret-32-bytes-minimum';

test('creates and verifies a valid 5-minute HMAC media stream token', () => {
  const now = 1_700_000_000_000;
  const { token, expiresAt } = createMediaStreamToken(
    { episodeId: 'ep-bhangarh-1', uid: 'user-123', format: 'video' },
    TEST_SECRET,
    now
  );

  assert.equal(expiresAt, now + MEDIA_TOKEN_TTL_MS);
  assert.ok(token.includes('.'));

  const verified = verifyMediaStreamToken(token, TEST_SECRET, now + 60_000);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.episodeId, 'ep-bhangarh-1');
    assert.equal(verified.payload.uid, 'user-123');
    assert.equal(verified.payload.format, 'video');
    assert.equal(verified.payload.exp, expiresAt);
  }
});

test('rejects expired media stream tokens cleanly', () => {
  const now = 1_700_000_000_000;
  const { token, expiresAt } = createMediaStreamToken(
    { episodeId: 'ep-bhangarh-1', uid: 'user-123', format: 'audio' },
    TEST_SECRET,
    now
  );

  const expired = verifyMediaStreamToken(token, TEST_SECRET, expiresAt + 1);
  assert.equal(expired.valid, false);
  if (!expired.valid) {
    assert.equal(expired.code, 'expired_token');
  }
});

test('rejects tampered payload or wrong signing secret', () => {
  const now = 1_700_000_000_000;
  const { token } = createMediaStreamToken(
    { episodeId: 'ep-1', uid: 'user-1', format: 'audio' },
    TEST_SECRET,
    now
  );

  const [payloadPart, sigPart] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ episodeId: 'ep-premium-99', uid: 'user-1', format: 'audio', exp: now + 999999 })
  ).toString('base64url');
  const forgedToken = `${forgedPayload}.${sigPart}`;

  const forgedResult = verifyMediaStreamToken(forgedToken, TEST_SECRET, now);
  assert.equal(forgedResult.valid, false);
  if (!forgedResult.valid) {
    assert.equal(forgedResult.code, 'invalid_token');
  }

  const wrongSecretResult = verifyMediaStreamToken(
    `${payloadPart}.${sigPart}`,
    'another-completely-different-secret-key-99',
    now
  );
  assert.equal(wrongSecretResult.valid, false);
  if (!wrongSecretResult.valid) {
    assert.equal(wrongSecretResult.code, 'invalid_token');
  }
});

test('rejects missing token or unconfigured server secret', () => {
  const missing = verifyMediaStreamToken('', TEST_SECRET);
  assert.equal(missing.valid, false);
  if (!missing.valid) assert.equal(missing.code, 'missing_token');

  const noSecret = verifyMediaStreamToken('abc.def', null);
  assert.equal(noSecret.valid, false);
  if (!noSecret.valid) assert.equal(noSecret.code, 'server_not_configured');
});
