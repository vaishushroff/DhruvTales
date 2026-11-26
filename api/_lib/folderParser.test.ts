import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractDriveFolderId,
  parseEpisodeMediaFilename,
  planFolderImport,
  type DriveFolderFileItem,
} from './folderParser';

test('extracts Drive folder IDs from raw IDs and Drive URLs while rejecting unsafe URLs', () => {
  assert.equal(
    extractDriveFolderId('1AbCdEfGhIjKlMnOpQrStUvWxYz1234'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz1234'
  );
  assert.equal(
    extractDriveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz1234?usp=sharing'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz1234'
  );
  assert.equal(
    extractDriveFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz1234'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz1234'
  );
  assert.equal(extractDriveFolderId('https://evil.example.com/drive/folders/1AbCdEfGhIjKlMnOpQrSt'), null);
  assert.equal(extractDriveFolderId('short'), null);
  assert.equal(extractDriveFolderId(''), null);
});

test('parses EP##_audio and EP##_video filenames case-insensitively', () => {
  const audio = parseEpisodeMediaFilename('EP01_audio.mp3');
  assert.equal(audio.ok, true);
  if (audio.ok) {
    assert.deepEqual(audio.parsed, { episodeNumber: 1, slot: 'audio', extension: 'mp3' });
  }

  const video = parseEpisodeMediaFilename('ep12_VIDEO.MP4');
  assert.equal(video.ok, true);
  if (video.ok) {
    assert.deepEqual(video.parsed, { episodeNumber: 12, slot: 'video', extension: 'mp4' });
  }

  const badExt = parseEpisodeMediaFilename('EP01_video.exe');
  assert.equal(badExt.ok, false);

  const badName = parseEpisodeMediaFilename('Episode 1 Final Cut.mp4');
  assert.equal(badName.ok, false);
});

test('merges audio and video of same episode into ONE draft episode, skips existing, and flags invalid files', () => {
  const files: DriveFolderFileItem[] = [
    { id: 'f1', name: 'EP01_audio.mp3', mimeType: 'audio/mpeg', durationSec: 210 },
    { id: 'f2', name: 'EP01_video.mp4', mimeType: 'video/mp4', durationSec: 215 },
    { id: 'f3', name: 'EP02_audio.mp3', mimeType: 'audio/mpeg' }, // already exists -> skip
    { id: 'f4', name: 'EP03_video.mp4', mimeType: 'video/mp4', durationSec: 95 }, // video-only
    { id: 'f5', name: 'EP01_audio.wav', mimeType: 'audio/wav' }, // duplicate audio slot -> invalid
    { id: 'f6', name: 'cover_art.png', mimeType: 'image/png' }, // invalid name
    { id: 'f7', name: 'Subfolder', mimeType: 'application/vnd.google-apps.folder' }, // ignored
  ];

  const plan = planFolderImport(files, new Set([2]));

  assert.equal(plan.toCreate.length, 2);

  // Episode 1 merged audio + video
  assert.equal(plan.toCreate[0].episodeNumber, 1);
  assert.equal(plan.toCreate[0].audioFile?.id, 'f1');
  assert.equal(plan.toCreate[0].videoFile?.id, 'f2');
  assert.equal(plan.toCreate[0].estimatedDurationSec, 215);

  // Episode 3 video-only
  assert.equal(plan.toCreate[1].episodeNumber, 3);
  assert.equal(plan.toCreate[1].audioFile, undefined);
  assert.equal(plan.toCreate[1].videoFile?.id, 'f4');
  assert.equal(plan.toCreate[1].estimatedDurationSec, 95);

  // Episode 2 skipped
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].fileId, 'f3');
  assert.equal(plan.skipped[0].episodeNumber, 2);

  // Duplicate audio + cover_art reported in invalid
  assert.equal(plan.invalid.length, 2);
  assert.deepEqual(
    plan.invalid.map((i) => i.fileId),
    ['f5', 'f6']
  );
});
