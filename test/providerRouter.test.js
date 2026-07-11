import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRouter } from '../server/providerRouter.js';
import { INVIDIOUS_CAPABILITIES } from '../shared/invidious.js';

function response(data, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => data };
}

test('server router bypasses a failed provider and returns a healthy search response', async () => {
  const calls = [];
  const router = createProviderRouter({
    instances: ['https://failed.example', 'https://healthy.example'],
    random: () => 0.99,
    fetchImpl: async url => {
      calls.push(url);
      if (url.startsWith('https://failed.example')) return response(null, false);
      return response([{ type: 'video', videoId: 'abcdefghijk' }]);
    },
  });

  const result = await router.request(INVIDIOUS_CAPABILITIES.SEARCH, { query: 'test', pages: 1 });
  assert.equal(result.provider, 'https://healthy.example');
  assert.equal(result.data[0].videoId, 'abcdefghijk');
  assert.equal(calls.length, 2);
});

test('provider health is tracked separately for search and related videos', async () => {
  let searchFailures = 0;
  const router = createProviderRouter({
    instances: ['https://one.example', 'https://two.example'],
    random: () => 0.99,
    fetchImpl: async url => {
      if (url.includes('/search') && url.startsWith('https://one.example')) {
        searchFailures += 1;
        return response(null, false);
      }
      if (url.includes('/videos/')) {
        return response({ recommendedVideos: [{ videoId: 'abcdefghijk' }] });
      }
      return response([{ type: 'video', videoId: 'abcdefghijk' }]);
    },
  });

  await router.request(INVIDIOUS_CAPABILITIES.SEARCH, { query: 'test', pages: 1 });
  const related = await router.request(INVIDIOUS_CAPABILITIES.RELATED, { videoId: 'abcdefghijk' });

  assert.equal(searchFailures, 1);
  assert.equal(related.data.recommendedVideos.length, 1);
});
