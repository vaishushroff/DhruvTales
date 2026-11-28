import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriveDownloadUrl,
  extractDriveIdStrict,
  isDirectBrowserDownloadRequest,
  isSafePublicMediaUrl,
  isValidDriveFileId,
  parseDriveConfirmFormUrl,
  sanitizeMediaContentType,
  validateRangeHeader,
} from './mediaProxySecurity';
import { createProxyStreamToken, verifyProxyStreamToken } from './proxyToken';

test('extractDriveIdStrict extracts valid Google Drive file IDs and rejects folders/malformed values', () => {
  assert.equal(
    extractDriveIdStrict('https://drive.google.com/file/d/1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h/view?usp=sharing'),
    '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h'
  );
  assert.equal(
    extractDriveIdStrict('https://drive.usercontent.google.com/download?id=1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h&export=download'),
    '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h'
  );
  assert.equal(extractDriveIdStrict('1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h'), '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h');
  assert.equal(
    extractDriveIdStrict('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    null
  );
  assert.equal(isValidDriveFileId('../etc/passwd'), false);
});

test('isSafePublicMediaUrl blocks SSRF targets (localhost, metadata, RFC-1918, non-HTTPS) and allows public HTTPS', () => {
  assert.equal(isSafePublicMediaUrl('https://cdn.example.com/stories/ep1.wav').ok, true);
  assert.equal(isSafePublicMediaUrl('http://cdn.example.com/stories/ep1.mp3').ok, false);
  assert.equal(isSafePublicMediaUrl('https://127.0.0.1/secret').ok, false);
  assert.equal(isSafePublicMediaUrl('https://localhost:3000/api/health').ok, false);
  assert.equal(isSafePublicMediaUrl('https://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(isSafePublicMediaUrl('https://metadata.google.internal/computeMetadata/v1/').ok, false);
  assert.equal(isSafePublicMediaUrl('https://10.0.0.5/audio.mp3').ok, false);
  assert.equal(isSafePublicMediaUrl('https://192.168.1.10/video.mp4').ok, false);
  assert.equal(isSafePublicMediaUrl('https://[::1]/audio.mp3').ok, false);
  assert.equal(isSafePublicMediaUrl('https://user:pass@cdn.example.com/ep1.mp3').ok, false);
});

test('isDirectBrowserDownloadRequest blocks document navigation and external hotlinks while allowing in-app audio/video', () => {
  assert.equal(
    isDirectBrowserDownloadRequest({
      secFetchDest: 'document',
      secFetchMode: 'navigate',
      host: 'tales.dhruvtales.workers.dev',
    }),
    true
  );
  assert.equal(
    isDirectBrowserDownloadRequest({
      secFetchDest: 'audio',
      secFetchMode: 'no-cors',
      referer: 'https://tales.dhruvtales.workers.dev/story/story-trinetra',
      host: 'tales.dhruvtales.workers.dev',
    }),
    false
  );
  assert.equal(
    isDirectBrowserDownloadRequest({
      secFetchDest: 'audio',
      secFetchMode: 'no-cors',
      referer: 'https://evil-scraper.example.com/steal',
      host: 'tales.dhruvtales.workers.dev',
    }),
    true
  );
});

test('parseDriveConfirmFormUrl extracts Google Drive virus-scan confirmation URL safely', () => {
  const html = `
    <form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
      <input type="hidden" name="id" value="1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h">
      <input type="hidden" name="export" value="download">
      <input type="hidden" name="confirm" value="t">
      <input type="hidden" name="uuid" value="abc-123-uuid">
    </form>
  `;
  const url = parseDriveConfirmFormUrl(html, '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h');
  assert.ok(url);
  assert.match(url, /uuid=abc-123-uuid/);
  assert.match(url, /confirm=t/);
  assert.match(buildDriveDownloadUrl('1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h'), /drive\.usercontent\.google\.com/);
});

test('validateRangeHeader and sanitizeMediaContentType handle all audio/video formats cleanly', () => {
  assert.equal(validateRangeHeader('bytes=0-1023'), 'bytes=0-1023');
  assert.equal(validateRangeHeader('bytes=1024-'), 'bytes=1024-');
  assert.equal(validateRangeHeader('bytes=0-10, 20-30'), null);
  assert.equal(validateRangeHeader('invalid'), null);

  assert.equal(sanitizeMediaContentType('audio/wav; charset=binary', 'audio'), 'audio/wav');
  assert.equal(sanitizeMediaContentType('application/octet-stream', 'audio', 'ep1.flac'), 'audio/flac');
  assert.equal(sanitizeMediaContentType('application/octet-stream', 'video', 'ep1.webm'), 'video/webm');
  assert.equal(sanitizeMediaContentType('text/html', 'audio'), 'audio/mpeg');
});

test('createProxyStreamToken encrypts target with AES-256-GCM and rejects tampering', () => {
  const driveId = '1LU6N-yTrSr_ieVVzZ0exq_6MbIcGEC4h';
  const { token } = createProxyStreamToken({ kind: 'drive', target: driveId, format: 'audio' });
  assert.ok(token.startsWith('v1.'));
  assert.equal(token.includes(driveId), false);

  const rawDecoded = Buffer.from(token.slice(3), 'base64url').toString('utf8');
  assert.equal(rawDecoded.includes(driveId), false);
  assert.equal(rawDecoded.includes('"drive"'), false);

  const verified = verifyProxyStreamToken(token);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.kind, 'drive');
    assert.equal(verified.payload.target, driveId);
    assert.equal(verified.payload.format, 'audio');
  }

  // Flip a character in the ciphertext and verify GCM rejects it
  const lastChar = token[token.length - 1];
  const tampered = token.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
  assert.equal(verifyProxyStreamToken(tampered).valid, false);
});
