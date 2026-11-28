import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriveCandidateUrls,
  extractFileExtension,
  formatRealDuration,
  inferMimeTypeFromUrl,
  isPlaceholderMediaRef,
} from './mediaFormats';

test('inferMimeTypeFromUrl detects all common web audio and video formats', () => {
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.mp3?token=abc', 'audio'), 'audio/mpeg');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.m4a', 'audio'), 'audio/mp4');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.aac', 'audio'), 'audio/aac');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.wav', 'audio'), 'audio/wav');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.ogg', 'audio'), 'audio/ogg');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.opus', 'audio'), 'audio/opus');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.flac', 'audio'), 'audio/flac');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.webm', 'audio'), 'audio/webm');

  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.mp4', 'video'), 'video/mp4');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.webm', 'video'), 'video/webm');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.mov', 'video'), 'video/quicktime');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.mkv', 'video'), 'video/x-matroska');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.ogv', 'video'), 'video/ogg');
  assert.equal(inferMimeTypeFromUrl('https://cdn.example.com/ep1.3gp', 'video'), 'video/3gpp');
});

test('extractFileExtension strips query params and hashes cleanly', () => {
  assert.equal(extractFileExtension('https://www.dropbox.com/scl/fi/123/Story_Ep1.FLAC?rlkey=x&raw=1#t=5'), 'flac');
  assert.equal(extractFileExtension('https://cdn.example.com/no-extension'), '');
});

test('buildDriveCandidateUrls returns ordered direct stream candidates for a Drive file ID', () => {
  const candidates = buildDriveCandidateUrls('https://drive.google.com/file/d/1LU6N-yTrSr_ieVVzZ0exq/view');
  assert.equal(candidates.length, 3);
  assert.equal(
    candidates[0],
    'https://drive.usercontent.google.com/download?id=1LU6N-yTrSr_ieVVzZ0exq&export=download&confirm=t'
  );
  assert.equal(
    candidates[1],
    'https://drive.google.com/uc?export=open&id=1LU6N-yTrSr_ieVVzZ0exq'
  );
  assert.equal(
    candidates[2],
    'https://docs.google.com/uc?export=open&id=1LU6N-yTrSr_ieVVzZ0exq'
  );
});

test('isPlaceholderMediaRef distinguishes unattached placeholders from real Drive and HTTPS links', () => {
  assert.equal(
    isPlaceholderMediaRef({ provider: 'demo', id: 'demo-audio-story-1-ep1', type: 'audio' }),
    true
  );
  assert.equal(
    isPlaceholderMediaRef({ provider: 'demo', id: 'local-file-12345', type: 'audio' }),
    true
  );
  assert.equal(
    isPlaceholderMediaRef({ provider: 'drive', id: '1LU6N-yTrSr_ieVVzZ0exq', type: 'audio' }),
    false
  );
  assert.equal(
    isPlaceholderMediaRef({ provider: 'demo', id: 'https://cdn.example.com/ep1.flac', type: 'audio' }),
    false
  );
});

test('formatRealDuration formats arbitrary durations including short clips and multi-hour episodes', () => {
  assert.equal(formatRealDuration(5), '0:05');
  assert.equal(formatRealDuration(277), '4:37');
  assert.equal(formatRealDuration(3725), '1:02:05');
});
