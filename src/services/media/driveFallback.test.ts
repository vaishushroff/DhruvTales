import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectDrivePlaybackUrl,
  extractDriveFileId,
  isStaticHostApiUnavailable,
  parseBatchEpisodeLines,
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
  assert.equal(extractDriveFileId('https://example.com/audio.mp3'), null);
});

test('buildDirectDrivePlaybackUrl builds clean direct download URL from share link or raw ID', () => {
  assert.equal(
    buildDirectDrivePlaybackUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'),
    'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
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
