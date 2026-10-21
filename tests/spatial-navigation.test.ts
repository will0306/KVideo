import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANDIDATE_TIER,
  findBestCandidateIndex,
  isDirectionOwnedByElement,
  type Box,
} from '@/lib/utils/spatial-navigation';

const box = (left: number, top: number, width = 100, height = 50): Box => ({ left, top, width, height });

// Player stage on top, a control bar inside it, and an episode row below
const stage = box(0, 0, 1000, 560);
const controls = [box(20, 500, 40, 40), box(940, 500, 40, 40)];
const episodes = [box(0, 600), box(120, 600), box(240, 600)];

test('down from the player stage lands on its control bar before the episode list', () => {
  const candidates = [...controls, ...episodes];
  const insideStage = candidates.map((_, index) => index < controls.length ? CANDIDATE_TIER.inside : CANDIDATE_TIER.normal);
  const index = findBestCandidateIndex(stage, candidates, 'down', insideStage);
  assert.ok(index >= 0 && index < controls.length);
});

test('falls back to outside candidates when nothing inside lies in the direction', () => {
  const candidates = [...controls, box(0, -100)];
  const insideStage = [CANDIDATE_TIER.inside, CANDIDATE_TIER.inside, CANDIDATE_TIER.normal];
  assert.equal(findBestCandidateIndex(stage, candidates, 'up', insideStage), 2);
});

test('down from a control leaves the player for the nearest episode', () => {
  const candidates = [stage, controls[1], ...episodes];
  assert.equal(findBestCandidateIndex(controls[0], candidates, 'down'), 1 + 1);
});

test('up from a control returns to the player stage', () => {
  assert.equal(findBestCandidateIndex(controls[0], [stage, ...episodes], 'up'), 0);
});

test('horizontal moves stay in the same row', () => {
  const offRow = box(130, 900);
  assert.equal(findBestCandidateIndex(episodes[0], [offRow, episodes[1], episodes[2]], 'right'), 1);
  assert.equal(findBestCandidateIndex(episodes[2], [offRow, episodes[0], episodes[1]], 'left'), 2);
});

test('a wide target below is reachable even when its center is far to the side', () => {
  const logo = box(0, 0, 120, 40);
  const searchBox = box(0, 60, 1200, 48);
  const tagButton = box(300, 140, 80, 40);
  assert.equal(findBestCandidateIndex(logo, [tagButton, searchBox], 'down'), 1);
});

test('floating buttons lose to page content and are used only as a last resort', () => {
  const lastControl = box(638, 440, 40, 40);
  const episode = box(739, 245, 52, 41);
  const backToTop = box(986, 519, 49, 49);
  const tiers = [CANDIDATE_TIER.normal, CANDIDATE_TIER.floating];
  assert.equal(findBestCandidateIndex(lastControl, [episode, backToTop], 'right', tiers), 0);
  assert.equal(findBestCandidateIndex(lastControl, [box(0, 0), backToTop], 'right', tiers), 1);
});

test('returns -1 when nothing lies in the requested direction', () => {
  assert.equal(findBestCandidateIndex(episodes[0], [episodes[1], episodes[2]], 'left'), -1);
  assert.equal(findBestCandidateIndex(episodes[0], [], 'down'), -1);
});

test('data-tv-keys decides which arrows an element handles itself', () => {
  assert.equal(isDirectionOwnedByElement(null, 'left'), false);
  assert.equal(isDirectionOwnedByElement('horizontal', 'left'), true);
  assert.equal(isDirectionOwnedByElement('horizontal', 'down'), false);
  assert.equal(isDirectionOwnedByElement('vertical', 'up'), true);
  assert.equal(isDirectionOwnedByElement('vertical', 'right'), false);
  assert.equal(isDirectionOwnedByElement('all', 'down'), true);
});
