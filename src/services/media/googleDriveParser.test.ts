import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDriveFolderId,
  planClientDriveFolderImport,
} from './googleDriveParser';

test('extractDriveFolderId extracts folder IDs from Drive folder URLs and raw IDs', () => {
  assert.equal(
    extractDriveFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(
    extractDriveFolderId('1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    '1AbCdEfGhIjKlMnOpQrStUvWxYz'
  );
  assert.equal(extractDriveFolderId('not valid'), null);
});

test('planClientDriveFolderImport merges EP01 audio+video, parses natural titles, auto-numbers plain files, and skips existing', () => {
  const plan = planClientDriveFolderImport(
    [
      { id: 'f1', name: 'EP01_audio.mp3', mimeType: 'audio/mpeg' },
      { id: 'f2', name: 'EP01_video.mp4', mimeType: 'video/mp4', durationSec: 245 },
      { id: 'f3', name: 'Episode 2 - Monsoon Whisper.mp3', mimeType: 'audio/mpeg' },
      { id: 'f4', name: '03_Already_Exists.mp3', mimeType: 'audio/mpeg' },
      { id: 'f5', name: 'Secret Finale.m4a', mimeType: 'audio/mp4' },
      { id: 'f6', name: 'Notes.pdf', mimeType: 'application/pdf' },
      { id: 'f7', name: 'Subfolder', mimeType: 'application/vnd.google-apps.folder' },
    ],
    new Set([3])
  );

  assert.equal(plan.toCreate.length, 3);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.invalid.length, 1);

  assert.equal(plan.toCreate[0].episodeNumber, 1);
  assert.equal(plan.toCreate[0].title, 'Episode 1');
  assert.equal(plan.toCreate[0].audioFile?.id, 'f1');
  assert.equal(plan.toCreate[0].videoFile?.id, 'f2');
  assert.equal(plan.toCreate[0].estimatedDurationSec, 245);

  assert.equal(plan.toCreate[1].episodeNumber, 2);
  assert.equal(plan.toCreate[1].title, 'Monsoon Whisper');
  assert.equal(plan.toCreate[1].audioFile?.id, 'f3');

  assert.equal(plan.toCreate[2].episodeNumber, 4);
  assert.equal(plan.toCreate[2].title, 'Secret Finale');
  assert.equal(plan.toCreate[2].audioFile?.id, 'f5');

  assert.equal(plan.skipped[0].episodeNumber, 3);
  assert.equal(plan.invalid[0].fileName, 'Notes.pdf');
});
