import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConstellationGraph,
  getDownstreamChoiceIds,
  getEpisodeFormats,
  resolveEffectiveFormat,
  shouldTriggerChoicePoint,
} from './storyGraph';
import type { Episode, UserChoiceEntry } from '../../types';

const makeEp = (
  id: string,
  num: number,
  opts?: Partial<Episode>
): Episode => ({
  id,
  storyId: 's-int',
  creatorOwnerUid: 'admin',
  episodeNumber: num,
  title: `Ep ${num}`,
  titleHi: `एपिसोड ${num}`,
  durationSec: 36,
  priceCoins: 0,
  mediaRef: { provider: 'demo', id: `audio-${id}`, type: 'audio' },
  publishedAt: '2026-11-20T00:00:00Z',
  ...opts,
});

test('getEpisodeFormats and resolveEffectiveFormat hide toggle for audio-only and honor preferredFormat for hybrid', () => {
  const audioOnly = makeEp('e1', 1);
  assert.equal(getEpisodeFormats(audioOnly).canSwitch, false);
  assert.equal(resolveEffectiveFormat(audioOnly, 'video'), 'audio');

  const hybrid = makeEp('e2', 2, {
    videoMediaRef: { provider: 'demo', id: 'video-e2', type: 'video' },
  });
  assert.equal(getEpisodeFormats(hybrid).canSwitch, true);
  assert.equal(resolveEffectiveFormat(hybrid, 'video'), 'video');
  assert.equal(resolveEffectiveFormat(hybrid, 'audio'), 'audio');
});

test('shouldTriggerChoicePoint triggers at timestamp and avoids duplicate trigger', () => {
  const ep = makeEp('e1', 1, {
    choicePoint: {
      id: 'cp-1',
      triggerAtSec: 15,
      promptEn: 'Choose a door',
      promptHi: 'दरवाज़ा चुनें',
      options: [
        { id: 'opt-a', labelEn: 'Left', labelHi: 'बाएँ', nextEpisodeId: 'e2' },
        { id: 'opt-b', labelEn: 'Right', labelHi: 'दाएँ', nextEpisodeId: 'e3' },
      ],
    },
  });

  assert.equal(shouldTriggerChoicePoint(ep, 10, 36, null), false);
  assert.equal(shouldTriggerChoicePoint(ep, 15.2, 36, null), true);
  assert.equal(shouldTriggerChoicePoint(ep, 16, 36, 'e1'), false);
});

test('buildConstellationGraph illuminates user light trail and getDownstreamChoiceIds prunes for replay', () => {
  const ep1 = makeEp('e1', 1, {
    choicePoint: {
      id: 'cp1',
      triggerAtSec: 15,
      promptEn: 'P1',
      promptHi: 'P1',
      options: [
        { id: 'a', labelEn: 'Go A', labelHi: 'A', nextEpisodeId: 'e2' },
        { id: 'b', labelEn: 'Go B', labelHi: 'B', nextEpisodeId: 'e3' },
      ],
    },
  });
  const ep2 = makeEp('e2', 2, {
    choicePoint: {
      id: 'cp2',
      triggerAtSec: 15,
      promptEn: 'P2',
      promptHi: 'P2',
      options: [
        { id: 'c', labelEn: 'End 1', labelHi: '1', nextEpisodeId: 'e4' },
        { id: 'd', labelEn: 'End 2', labelHi: '2', nextEpisodeId: 'e5' },
      ],
    },
  });
  const ep3 = makeEp('e3', 3);
  const ep4 = makeEp('e4', 4, { isEnding: true });
  const ep5 = makeEp('e5', 5, { isEnding: true });
  const eps = [ep1, ep2, ep3, ep4, ep5];

  const choices: UserChoiceEntry[] = [
    {
      id: 'u1_s-int_e1',
      userId: 'u1',
      storyId: 's-int',
      episodeId: 'e1',
      choicePointId: 'cp1',
      optionId: 'a',
      optionLabelEn: 'Go A',
      optionLabelHi: 'A',
      nextEpisodeId: 'e2',
      chosenAt: 100,
    },
    {
      id: 'u1_s-int_e2',
      userId: 'u1',
      storyId: 's-int',
      episodeId: 'e2',
      choicePointId: 'cp2',
      optionId: 'c',
      optionLabelEn: 'End 1',
      optionLabelHi: '1',
      nextEpisodeId: 'e4',
      chosenAt: 200,
    },
  ];

  const graph = buildConstellationGraph(eps, choices);
  assert.deepEqual(graph.activePathIds, ['e1', 'e2', 'e4']);
  const litEdges = graph.edges.filter((e) => e.isChosenTrail);
  assert.equal(litEdges.length, 2);
  assert.equal(graph.nodes.find((n) => n.episode.id === 'e4')?.isCurrentTip, true);
  assert.equal(graph.nodes.find((n) => n.episode.id === 'e3')?.isVisited, false);

  // Replaying from e1 should prune both e1 and e2 choices
  assert.deepEqual(getDownstreamChoiceIds('e1', eps, choices), ['u1_s-int_e1', 'u1_s-int_e2']);
  // Replaying from e2 should only prune e2
  assert.deepEqual(getDownstreamChoiceIds('e2', eps, choices), ['u1_s-int_e2']);
});
