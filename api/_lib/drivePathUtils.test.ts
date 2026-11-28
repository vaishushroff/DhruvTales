import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDriveMediaFile,
  escapeDriveQueryLiteral,
  normalizeDriveFolderPath,
  normalizeDrivePath,
  pickBestDriveNameMatch,
} from './drivePathUtils';

test('normalizeDrivePath accepts slash/backslash paths and rejects URLs and traversal', () => {
  const ok1 = normalizeDrivePath('/Trinetra/EP_1.wav');
  assert.equal(ok1.ok, true);
  if (ok1.ok) {
    assert.deepEqual(ok1.segments, ['Trinetra', 'EP_1.wav']);
    assert.equal(ok1.normalizedPath, 'Trinetra/EP_1.wav');
  }

  const ok2 = normalizeDrivePath('Stories\\Trinetra\\audio\\ep1.flac');
  assert.equal(ok2.ok, true);
  if (ok2.ok) {
    assert.deepEqual(ok2.segments, ['Stories', 'Trinetra', 'audio', 'ep1.flac']);
  }

  assert.equal(normalizeDrivePath('').ok, false);
  assert.equal(normalizeDrivePath('../secret.wav').ok, false);
  assert.equal(normalizeDrivePath('Trinetra/../other.mp3').ok, false);
  assert.equal(normalizeDrivePath('https://drive.google.com/file/d/12345/view').ok, false);
});

test('normalizeDriveFolderPath allows empty/root path and rejects traversal', () => {
  const root = normalizeDriveFolderPath('');
  assert.equal(root.ok, true);
  if (root.ok) {
    assert.deepEqual(root.segments, []);
    assert.equal(root.normalizedPath, '');
  }

  const slash = normalizeDriveFolderPath('/');
  assert.equal(slash.ok, true);
  assert.equal(normalizeDriveFolderPath('../etc').ok, false);
});

test('escapeDriveQueryLiteral escapes quotes and backslashes against Drive query injection', () => {
  assert.equal(escapeDriveQueryLiteral("Ram's Story"), "Ram\\'s Story");
  assert.equal(escapeDriveQueryLiteral("a\\'b"), "a\\\\\\'b");
});

test('classifyDriveMediaFile detects all web audio/video formats including octet-stream fallback', () => {
  assert.deepEqual(classifyDriveMediaFile('audio/wav', 'EP_1.wav'), {
    isMedia: true,
    kind: 'audio',
    resolvedMimeType: 'audio/wav',
  });
  assert.deepEqual(classifyDriveMediaFile('application/octet-stream', 'ep1.flac'), {
    isMedia: true,
    kind: 'audio',
    resolvedMimeType: 'audio/flac',
  });
  assert.deepEqual(classifyDriveMediaFile('application/octet-stream', 'trailer.mkv'), {
    isMedia: true,
    kind: 'video',
    resolvedMimeType: 'video/x-matroska',
  });
  assert.equal(classifyDriveMediaFile('application/vnd.google-apps.folder', 'Trinetra').isMedia, false);
  assert.equal(classifyDriveMediaFile('application/pdf', 'script.pdf').isMedia, false);
});

test('pickBestDriveNameMatch prefers exact match, then case-insensitive, then unique extensionless match', () => {
  const items = [
    { id: '1', name: 'EP_1.wav' },
    { id: '2', name: 'EP_2.mp4' },
  ];
  assert.equal(pickBestDriveNameMatch(items, 'EP_1.wav', true)?.id, '1');
  assert.equal(pickBestDriveNameMatch(items, 'ep_1.wav', true)?.id, '1');
  assert.equal(pickBestDriveNameMatch(items, 'ep_1', true)?.id, '1');
  assert.equal(pickBestDriveNameMatch(items, 'ep_1', false), null);
});
