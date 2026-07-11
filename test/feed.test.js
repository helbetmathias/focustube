import test from 'node:test';
import assert from 'node:assert/strict';
import { blendRecommendationSources, buildBalancedCreatorFeed, getTargetFeedSize } from '../src/utils/feed.js';

const videos = (prefix, count) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index + 1}` }));

test('feed size grows in complete desktop rows', () => {
  assert.equal(getTargetFeedSize(0), 0);
  assert.equal(getTargetFeedSize(1), 8);
  assert.equal(getTargetFeedSize(2), 12);
  assert.equal(getTargetFeedSize(3), 16);
  assert.equal(getTargetFeedSize(4), 20);
  assert.equal(getTargetFeedSize(10), 20);
});

test('creator results are interleaved and trimmed to a complete row', () => {
  const result = buildBalancedCreatorFeed(
    [videos('a', 5), videos('b', 5), videos('c', 5), videos('d', 5)],
    20,
    () => 0.37
  );

  assert.equal(result.visibleFeed.length, 20);
  assert.equal(result.reserveFeed.length, 0);

  const groups = result.visibleFeed.map(video => video.id[0]);
  for (let index = 0; index < groups.length; index += 1) {
    if (index % 4 !== 0) assert.notEqual(groups[index], groups[index - 1]);
    if (index >= 4) assert.notEqual(groups[index], groups[index - 4]);
  }

  for (const group of ['a', 'b', 'c', 'd']) {
    assert.equal(groups.filter(value => value === group).length, 5);
  }
});

test('awkward result totals leave overflow in reserve', () => {
  const result = buildBalancedCreatorFeed([videos('a', 6), videos('b', 5)], 12);

  assert.equal(result.visibleFeed.length, 8);
  assert.equal(result.reserveFeed.length, 3);
});

test('real recommendations replace cards without changing feed size', () => {
  const creatorFeed = videos('c', 8).map(video => ({ ...video, author: 'creator' }));
  const realFeed = videos('r', 10).map((video, index) => ({ ...video, author: `related-${index}` }));
  const result = blendRecommendationSources(creatorFeed, realFeed, () => 0.61);

  assert.equal(result.length, 8);
  assert.equal(result.filter(video => video.id.startsWith('c')).length, 4);
  assert.equal(result.filter(video => video.id.startsWith('r')).length, 4);
});
