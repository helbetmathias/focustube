import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialSearchResultCount, getSearchIntent, prepareSearchResults } from '../src/utils/search.js';

test('search results are deduplicated and lightly prioritize exact matches', () => {
  const results = prepareSearchResults([
    { id: 'music', type: 'video', title: 'A song featuring Fern', author: 'Someone' },
    { id: 'documentary', type: 'video', title: 'The investigation', author: 'fern' },
    { id: 'music', type: 'video', title: 'Duplicate', author: 'Someone else' },
    { id: 'title', type: 'video', title: 'Fern - Into You', author: 'Label' },
  ], 'fern');

  assert.deepEqual(results.map(result => result.id), ['documentary', 'title', 'music']);
});

test('playlists only appear when the query explicitly asks for them', () => {
  const mixedResults = [
    { id: 'video-1', type: 'video', title: 'XSlayder video', author: 'XSlayder' },
    { id: 'playlist-1', type: 'playlist', title: 'XSlayder uploads', author: 'XSlayder' },
  ];

  assert.deepEqual(
    prepareSearchResults(mixedResults, 'xslayder').map(result => result.id),
    ['video-1']
  );
  assert.deepEqual(
    prepareSearchResults(mixedResults, 'xslayder playlist').map(result => result.id),
    ['video-1', 'playlist-1']
  );
  assert.deepEqual(
    prepareSearchResults(mixedResults, 'XSLAYDER PLAYLISTS').map(result => result.id),
    ['video-1', 'playlist-1']
  );
});

test('Shorts only appear when the query explicitly asks for them', () => {
  const mixedResults = [
    { id: 'regular', type: 'video', title: 'Regular video', isShort: false, lengthSeconds: 75 },
    { id: 'short', type: 'video', title: 'Vertical clip', isShort: true, lengthSeconds: 71 },
    { id: 'unknown', type: 'video', title: 'Short music video', lengthSeconds: 58 },
  ];

  assert.deepEqual(
    prepareSearchResults(mixedResults, 'kurzgesagt').map(result => result.id),
    ['regular', 'unknown']
  );
  assert.deepEqual(
    prepareSearchResults(mixedResults, 'kurzgesagt shorts').map(result => result.id),
    ['short']
  );
  assert.deepEqual(
    prepareSearchResults(mixedResults, '#short').map(result => result.id),
    ['short']
  );
});

test('Shorts keywords act as filters and are removed from the provider query', () => {
  assert.deepEqual(getSearchIntent('kurzgesagt shorts'), {
    searchQuery: 'kurzgesagt',
    wantsShorts: true,
  });
  assert.deepEqual(getSearchIntent('  iRaffael   #SHORT,  '), {
    searchQuery: 'iRaffael',
    wantsShorts: true,
  });
  assert.deepEqual(getSearchIntent('a short-story documentary'), {
    searchQuery: 'a short-story documentary',
    wantsShorts: false,
  });
});

test('search batches preserve complete two and three column rows', () => {
  assert.equal(getInitialSearchResultCount(49), 48);
  assert.equal(getInitialSearchResultCount(8), 6);
  assert.equal(getInitialSearchResultCount(6), 6);
  assert.equal(getInitialSearchResultCount(5), 5);
});
