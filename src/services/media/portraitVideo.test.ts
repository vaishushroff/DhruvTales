import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyVideoSelectionToEpisodeForm,
  computeContainedVideoRect,
  computePortraitFrameBox,
  computeVideoFrameBox,
  detectVideoAspectFormat,
  formatPortraitRejectionMessage,
  isLandscapeSixteenByNine,
  isPortraitNineBySixteen,
  LANDSCAPE_ASPECT_RATIO,
  PORTRAIT_ASPECT_RATIO,
  validatePortraitVideoDimensions,
  validateSupportedVideoDimensions,
} from './portraitVideo';

test('accepts both standard vertical 9:16 and horizontal 16:9 resolutions and detects exact format', () => {
  for (const [w, h] of [
    [1080, 1920],
    [720, 1280],
    [540, 960],
    [1440, 2560],
    [360, 640],
    [1080, 1916],
  ]) {
    const res = validateSupportedVideoDimensions(w, h);
    assert.equal(res.valid, true, `expected 9:16 ${w}x${h} to be accepted`);
    if (res.valid) assert.equal(res.format, '9:16');
    assert.equal(isPortraitNineBySixteen(w, h), true);
    assert.equal(detectVideoAspectFormat(w, h), '9:16');
  }

  for (const [w, h] of [
    [1920, 1080],
    [1280, 720],
    [1376, 768],
    [640, 360],
    [2560, 1440],
  ]) {
    const res = validateSupportedVideoDimensions(w, h);
    assert.equal(res.valid, true, `expected 16:9 ${w}x${h} to be accepted`);
    if (res.valid) assert.equal(res.format, '16:9');
    assert.equal(isLandscapeSixteenByNine(w, h), true);
    assert.equal(detectVideoAspectFormat(w, h), '16:9');
  }
});

test('rejects square and non-9:16 / non-16:9 aspect ratios with detected dimensions', () => {
  for (const [w, h] of [
    [1080, 1080], // 1:1 square
    [1080, 1350], // 4:5 portrait
    [1080, 1440], // 3:4 portrait
    [1440, 1080], // 4:3 landscape
    [1080, 1620], // 2:3 portrait
  ]) {
    const res = validateSupportedVideoDimensions(w, h);
    assert.equal(res.valid, false, `expected ${w}x${h} to be rejected`);
    if (!res.valid) {
      assert.equal(res.reason, 'wrong_aspect_ratio');
      assert.equal(res.width, w);
      assert.equal(res.height, h);
    }
  }
});

test('strict validatePortraitVideoDimensions still distinguishes 9:16 from 16:9', () => {
  assert.equal(validatePortraitVideoDimensions(1080, 1920).valid, true);
  assert.equal(validatePortraitVideoDimensions(1920, 1080).valid, false);
});

test('rejects invalid or missing video metadata cleanly', () => {
  for (const [w, h] of [
    [0, 0],
    [1080, 0],
    [0, 1920],
    [-1080, 1920],
    [Number.NaN, 1920],
  ]) {
    const res = validateSupportedVideoDimensions(w, h);
    assert.equal(res.valid, false);
    if (!res.valid) {
      assert.equal(res.reason, 'invalid_metadata');
    }
  }
});

test('formats localized rejection message with detected dimensions', () => {
  const template =
    'This video is {width} × {height}. Dhruv Tales supports vertical 9:16 and horizontal 16:9 videos.';
  assert.equal(
    formatPortraitRejectionMessage(template, 1080, 1080),
    'This video is 1080 × 1080. Dhruv Tales supports vertical 9:16 and horizontal 16:9 videos.'
  );
});

test('computeVideoFrameBox keeps exact 9:16 and exact 16:9 on both phone (390x844) and laptop (1366x768)', () => {
  // 9:16 Portrait
  const phonePortrait = computePortraitFrameBox(366, 620);
  assert.ok(Math.abs(phonePortrait.aspectRatio - PORTRAIT_ASPECT_RATIO) < 0.001);
  assert.ok(phonePortrait.width <= 366 && phonePortrait.height <= 620);

  const laptopPortrait = computeVideoFrameBox(1280, 560, '9:16');
  assert.ok(Math.abs(laptopPortrait.aspectRatio - PORTRAIT_ASPECT_RATIO) < 0.001);
  assert.equal(Math.round(laptopPortrait.width), 315);
  assert.equal(Math.round(laptopPortrait.height), 560);

  // 16:9 Landscape
  const phoneLandscape = computeVideoFrameBox(366, 620, '16:9');
  assert.ok(Math.abs(phoneLandscape.aspectRatio - LANDSCAPE_ASPECT_RATIO) < 0.001);
  assert.equal(Math.round(phoneLandscape.width), 366);
  assert.ok(phoneLandscape.height <= 620);

  const laptopLandscape = computeVideoFrameBox(860, 560, '16:9');
  assert.ok(Math.abs(laptopLandscape.aspectRatio - LANDSCAPE_ASPECT_RATIO) < 0.001);
  assert.equal(Math.round(laptopLandscape.width), 860);
  assert.equal(Math.round(laptopLandscape.height), 484);
});

test('native 9:16 fills 9:16 frame edge-to-edge and native 16:9 fills 16:9 frame edge-to-edge', () => {
  const portraitFrame = computeVideoFrameBox(366, 640, '9:16');
  const fullHdPortrait = computeContainedVideoRect(portraitFrame.width, portraitFrame.height, 1080, 1920);
  assert.equal(fullHdPortrait.fillsFrameEdgeToEdge, true);

  const landscapeFrame = computeVideoFrameBox(860, 560, '16:9');
  const fullHdLandscape = computeContainedVideoRect(landscapeFrame.width, landscapeFrame.height, 1920, 1080);
  assert.equal(fullHdLandscape.fillsFrameEdgeToEdge, true);
  assert.equal(fullHdLandscape.hasLetterboxBars, false);
  assert.equal(fullHdLandscape.hasPillarboxBars, false);
});

test('Studio accepts 9:16 and 16:9 replacements while rejected square upload preserves prior video and unsaved text', () => {
  const initialForm = {
    title: 'Unsaved Chapter Title',
    titleHi: 'असहेजा शीर्षक',
    description: 'Important unsaved draft synopsis.',
    videoMediaRef: null as { provider: 'demo'; id: string; type: 'video' } | null,
  };

  // Step 1: Valid 1080x1920 portrait upload succeeds
  const portraitUpload = applyVideoSelectionToEpisodeForm(
    initialForm,
    validateSupportedVideoDimensions(1080, 1920),
    { provider: 'demo', id: 'portrait-clip-1', type: 'video' }
  );
  assert.equal(portraitUpload.accepted, true);
  assert.equal(portraitUpload.nextForm.videoMediaRef?.id, 'portrait-clip-1');

  // Step 2: Valid 1920x1080 landscape upload succeeds
  const landscapeUpload = applyVideoSelectionToEpisodeForm(
    portraitUpload.nextForm,
    validateSupportedVideoDimensions(1920, 1080),
    { provider: 'demo', id: 'landscape-clip-2', type: 'video' }
  );
  assert.equal(landscapeUpload.accepted, true);
  assert.equal(landscapeUpload.nextForm.videoMediaRef?.id, 'landscape-clip-2');

  // Step 3: Unsupported square 1080x1080 upload is rejected; prior video and unsaved text stay intact
  const editedForm = {
    ...landscapeUpload.nextForm,
    title: 'Edited Unsaved Chapter Title',
    description: 'Even newer unsaved notes.',
  };
  const rejectedReplacement = applyVideoSelectionToEpisodeForm(
    editedForm,
    validateSupportedVideoDimensions(1080, 1080),
    null
  );
  assert.equal(rejectedReplacement.accepted, false);
  assert.equal(rejectedReplacement.nextForm.videoMediaRef?.id, 'landscape-clip-2');
  assert.equal(rejectedReplacement.nextForm.title, 'Edited Unsaved Chapter Title');
  assert.equal(rejectedReplacement.nextForm.description, 'Even newer unsaved notes.');
});
