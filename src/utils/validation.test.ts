import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeErrorMessage, sanitizeSafeUrl, validateOptionalUrl } from './validation';

test('sanitizeSafeUrl allows valid https, http, and root-relative URLs', () => {
  assert.equal(sanitizeSafeUrl('https://cdn.example.com/cover.jpg'), 'https://cdn.example.com/cover.jpg');
  assert.equal(sanitizeSafeUrl('http://localhost:3000/demo.mp4'), 'http://localhost:3000/demo.mp4');
  assert.equal(sanitizeSafeUrl('/demo-media/kaalchakra-chapter.mp4'), '/demo-media/kaalchakra-chapter.mp4');
});

test('sanitizeSafeUrl blocks javascript:, data:, vbscript:, and protocol-relative URLs', () => {
  assert.equal(sanitizeSafeUrl('javascript:alert(1)'), undefined);
  assert.equal(sanitizeSafeUrl('  JAVASCRIPT:alert(document.cookie)'), undefined);
  assert.equal(sanitizeSafeUrl('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(sanitizeSafeUrl('vbscript:msgbox(1)'), undefined);
  assert.equal(sanitizeSafeUrl('//evil.example.com/phish.jpg'), undefined);
  assert.equal(sanitizeSafeUrl('file:///etc/passwd'), undefined);
  assert.equal(sanitizeSafeUrl('https://example.com/\u0000bad'), undefined);
  assert.equal(sanitizeSafeUrl(''), undefined);
  assert.equal(sanitizeSafeUrl(undefined), undefined);
});

test('validateOptionalUrl accepts empty optional values and rejects dangerous schemes', () => {
  assert.deepEqual(validateOptionalUrl(''), { valid: true, sanitized: undefined });
  assert.equal(validateOptionalUrl('https://dhruvtales.example/sample').valid, true);
  assert.equal(validateOptionalUrl('javascript:void(0)').valid, false);
  assert.equal(validateOptionalUrl('not a url').valid, false);
  assert.equal(validateOptionalUrl('/assets/cover.png', true).valid, true);
  assert.equal(validateOptionalUrl('/assets/cover.png', false).valid, false);
});

test('getSafeErrorMessage redacts structured Firestore JSON diagnostic dumps', () => {
  const internalJsonError = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'update',
      path: 'users/uid_secret_123',
      authInfo: {
        userId: 'uid_secret_123',
        email: 'private@example.com',
        emailVerified: true,
      },
    })
  );

  const safe = getSafeErrorMessage(internalJsonError, 'Fallback');
  assert.equal(safe.includes('uid_secret_123'), false);
  assert.equal(safe.includes('private@example.com'), false);
  assert.equal(safe.includes('operationType'), false);
  assert.match(safe, /permission/i);
});

test('getSafeErrorMessage maps Firebase auth errors and preserves clean validation errors', () => {
  assert.match(
    getSafeErrorMessage(new Error('Firebase: Error (auth/invalid-credential).')),
    /Invalid email or password/i
  );
  assert.match(
    getSafeErrorMessage(new Error('Firebase: Error (auth/requires-recent-login).')),
    /sign out and sign back in/i
  );
  assert.equal(
    getSafeErrorMessage(new Error('Please enter your studio or creator name.')),
    'Please enter your studio or creator name.'
  );
});
