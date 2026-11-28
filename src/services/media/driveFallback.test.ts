import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectDrivePlaybackUrl,
  buildDrivePreviewEmbedUrl,
  extractDriveFileId,
  isStaticHostApiUnavailable,
  normalizeDirectMediaUrl,
  parseBatchEpisodeLines,
  resolveCreatorMediaInput,
} from './driveFallback';

test('isStaticHostApiUnavailable treats 404, 405, and non-JSON responses as static host fallback', () => {
  assert.equal(isStaticHostApiUnavailable(405, false), true);
  assert.equal(isStaticHostApiUnavailable(404, false), true);
  assert.equal(isStaticHostApiUnavailable(405, true), true);
  assert.equal(isStaticHostApiUnavailable(200, false), false);
  assert.equal(isStaticHostApiUnavailable(403, true), false);
  assert.equal(isStaticHostApiUnavailable(500, true), false);
});

test('extractDriveFileId parses share URLs, open URLs, uc URLs, and raw Drive IDs', () => {
  assert.equal(
    extractDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    extractDriveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    extractDriveFileId('1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    extractDriveFileId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    null
  );
  assert.equal(extractDriveFileId('https://example.com/audio.mp3'), null);
});

test('buildDirectDrivePlaybackUrl and buildDrivePreviewEmbedUrl build clean Google Drive URLs', () => {
  assert.equal(
    buildDirectDrivePlaybackUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'),
    'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOpQrStUvWxYz&export=download&confirm=t'
  );
  assert.equal(
    buildDrivePreviewEmbedUrl('1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/preview'
  );
});

test('normalizeDirectMediaUrl converts Dropbox and GitHub share links into direct playable media URLs', () => {
  assert.equal(
    normalizeDirectMediaUrl('https://www.dropbox.com/scl/fi/abc123/ep1.mp3?rlkey=xyz&dl=0'),
    'https://www.dropbox.com/scl/fi/abc123/ep1.mp3?rlkey=xyz&raw=1'
  );
  assert.equal(
    normalizeDirectMediaUrl('https://github.com/dhruvtales/audio/blob/main/ep01.mp3'),
    'https://raw.githubusercontent.com/dhruvtales/audio/main/ep01.mp3'
  );
  assert.equal(normalizeDirectMediaUrl('javascript:alert(1)'), null);
});

test('resolveCreatorMediaInput accepts Drive files, Dropbox, and direct HTTPS while rejecting folders', () => {
  const driveRes = resolveCreatorMediaInput(
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view',
    'audio'
  );
  assert.equal(driveRes.ok, true);
  if (driveRes.ok) {
    assert.equal(driveRes.mediaRef.provider, 'drive');
    assert.equal(driveRes.mediaRef.id, '1AbCdEfGhIjKlMnOpQrStUvWxYz');
  }

  const dropboxRes = resolveCreatorMediaInput(
    'https://www.dropbox.com/scl/fi/abc123/ep1.mp3?dl=0',
    'audio'
  );
  assert.equal(dropboxRes.ok, true);
  if (dropboxRes.ok) {
    assert.equal(dropboxRes.mediaRef.provider, 'demo');
    assert.equal(dropboxRes.mediaRef.id, 'https://www.dropbox.com/scl/fi/abc123/ep1.mp3?raw=1');
  }

  const folderRes = resolveCreatorMediaInput(
    'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz',
    'audio'
  );
  assert.equal(folderRes.ok, false);
});

test('parseBatchEpisodeLines groups audio+video Drive links, auto-numbers, skips existing, and flags invalid', () => {
  const input = [
    '# Comment line ignored',
    'EP01 | First Dawn | https://drive.google.com/file/d/1AudioFileIdExample0001/view',
    'EP01_video | First Dawn | https://drive.google.com/file/d/1VideoFileIdExample0001/view',
    'EP02 | Already Exists | https://drive.google.com/file/d/1ExistingFileIdExample2/view',
    'https://cdn.dhruvtales.com/ep03.mp3',
    'not-a-valid-link',
  ].join('\n');

  const plan = parseBatchEpisodeLines(input, [2]);
  assert.equal(plan.totalLines, 5);
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.invalid.length, 1);

  assert.equal(plan.groups[0].episodeNumber, 1);
  assert.equal(plan.groups[0].title, 'First Dawn');
  assert.equal(plan.groups[0].audioRef.provider, 'drive');
  assert.equal(plan.groups[0].audioRef.id, '1AudioFileIdExample0001');
  assert.equal(plan.groups[0].videoMediaRef?.provider, 'drive');
  assert.equal(plan.groups[0].videoMediaRef?.id, '1VideoFileIdExample0001');

  assert.equal(plan.groups[1].episodeNumber, 3);
  assert.equal(plan.groups[1].audioRef.provider, 'demo');
  assert.equal(plan.groups[1].audioRef.id, 'https://cdn.dhruvtales.com/ep03.mp3');
});

test('parseBatchEpisodeLines rejects Google Drive folder URLs with helpful file-link guidance', () => {
  const plan = parseBatchEpisodeLines(
    'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing',
    []
  );
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.invalid.length, 1);
  assert.match(plan.invalid[0].reason, /folder link/i);
});
