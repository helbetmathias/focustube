import test from 'node:test';
import assert from 'node:assert/strict';
import { blendRecommendationSources, buildBalancedCreatorFeed, getCompactTargetFeedSize, getContinueWatchingItems, getHomeFeedPoolSize, getHomeHistoryContext, getTargetFeedSize } from '../src/utils/feed.js';

const videos = (prefix, count) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index + 1}` }));

test('feed size grows in complete desktop rows', () => {
  assert.equal(getTargetFeedSize(0), 0);
  assert.equal(getTargetFeedSize(1), 8);
  assert.equal(getTargetFeedSize(2), 12);
  assert.equal(getTargetFeedSize(3), 16);
  assert.equal(getTargetFeedSize(4), 20);
  assert.equal(getTargetFeedSize(10), 20);
});

test('compact laptop feeds preserve full three-column rows and the largest feed keeps 24 cards available', () => {
  assert.deepEqual(
    [1, 2, 3, 4].map(getCompactTargetFeedSize),
    [9, 12, 18, 21]
  );
  assert.deepEqual(
    [1, 2, 3, 4].map(getHomeFeedPoolSize),
    [12, 12, 20, 24]
  );
});

test('home context always selects the four latest unique creators', () => {
  const context = getHomeHistoryContext([
    { id: 'old-a', author: 'Alpha', timestamp: 1 },
    { id: 'new-e', author: 'Echo', timestamp: 6 },
    { id: 'new-a', author: 'alpha', timestamp: 5 },
    { id: 'new-d', author: 'Delta', timestamp: 4 },
    { id: 'new-c', author: 'Charlie', timestamp: 3 },
    { id: 'new-b', author: 'Bravo', timestamp: 2 },
  ]);

  assert.deepEqual(context.creators, ['Echo', 'alpha', 'Delta', 'Charlie']);
  assert.equal(context.newestSeed.id, 'new-e');
});

test('home cache signature changes for a new creator or related-video seed', () => {
  const original = getHomeHistoryContext([{ id: 'video-1', author: 'Alpha', timestamp: 1 }]);
  const newVideo = getHomeHistoryContext([{ id: 'video-2', author: 'Alpha', timestamp: 2 }]);
  const newCreator = getHomeHistoryContext([
    { id: 'video-3', author: 'Bravo', timestamp: 3 },
    { id: 'video-1', author: 'Alpha', timestamp: 1 },
  ]);

  assert.notEqual(original.signature, newVideo.signature);
  assert.notEqual(original.signature, newCreator.signature);
});

test('continue watching keeps the four latest unique unfinished videos', () => {
  const result = getContinueWatchingItems([
    { id: 'older', progress: 40, duration: 100, timestamp: 1 },
    { id: 'finished', progress: 96, duration: 100, timestamp: 8 },
    { id: 'missing-duration', progress: 20, duration: 0, timestamp: 7 },
    { id: 'newest', progress: 10, duration: 100, timestamp: 6 },
    { id: 'second', progress: 30, duration: 100, timestamp: 5 },
    { id: 'newest', progress: 5, duration: 100, timestamp: 4 },
    { id: 'third', progress: 50, duration: 100, timestamp: 3 },
    { id: 'fourth', progress: 70, duration: 100, timestamp: 2 },
  ]);

  assert.deepEqual(result.map(item => item.id), ['newest', 'second', 'third', 'fourth']);
});

test('continue watching preserves playlist resume context', () => {
  const [item] = getContinueWatchingItems([
    {
      id: 'playlist-video',
      playlistId: 'playlist-id',
      playlistIndex: 7,
      progress: 42,
      duration: 100,
      timestamp: 1,
    },
  ]);

  assert.equal(item.playlistId, 'playlist-id');
  assert.equal(item.playlistIndex, 7);
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
