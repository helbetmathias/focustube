import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialSearchResultCount, prepareSearchResults } from '../src/utils/search.js';

test('search results are deduplicated and lightly prioritize exact matches', () => {
  const results = prepareSearchResults([
    { id: 'music', type: 'video', title: 'A song featuring Fern', author: 'Someone' },
    { id: 'documentary', type: 'video', title: 'The investigation', author: 'fern' },
    { id: 'music', type: 'video', title: 'Duplicate', author: 'Someone else' },
    { id: 'title', type: 'video', title: 'Fern - Into You', author: 'Label' },
  ], 'fern');

  assert.deepEqual(results.map(result => result.id), ['documentary', 'title', 'music']);
});

test('search batches preserve complete two and three column rows', () => {
  assert.equal(getInitialSearchResultCount(49), 48);
  assert.equal(getInitialSearchResultCount(8), 6);
  assert.equal(getInitialSearchResultCount(6), 6);
  assert.equal(getInitialSearchResultCount(5), 5);
});
