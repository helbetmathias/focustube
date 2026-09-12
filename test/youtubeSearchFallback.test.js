import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeSearchResults,
  fetchYouTubeJsonSearchResults,
  fetchYouTubeSearchResults,
  fetchYouTubeSearchResultsWithRetry,
  parseYouTubeInitialData,
  raceSearchSources,
} from '../server/youtubeSearchFallback.js';

const initialData = {
  contents: [
    {
      videoRenderer: {
        videoId: 'abcdefghijk',
        title: { runs: [{ text: 'Example video' }] },
        ownerText: { runs: [{ text: 'Example creator' }] },
        lengthText: { simpleText: '1:02' },
        viewCountText: { simpleText: '1.2M views' },
        publishedTimeText: { simpleText: '2 days ago' },
      },
    },
    {
      playlistRenderer: {
        playlistId: 'PLabcdefghijk',
        title: { simpleText: 'Example playlist' },
        shortBylineText: { runs: [{ text: 'Playlist creator' }] },
        videoCount: { simpleText: '25 videos' },
        videos: [{ childVideoRenderer: { videoId: 'lmnopqrstuv' } }],
      },
    },
    {
      lockupViewModel: {
        contentId: 'PLnewformat12345',
        contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
        contentImage: {
          collectionThumbnailViewModel: {
            primaryThumbnail: {
              thumbnailViewModel: {
                image: {
                  sources: [{ url: 'https://i.ytimg.com/vi/zyxwvutsrqp/hq720.jpg' }],
                },
                overlays: [{
                  thumbnailOverlayBadgeViewModel: {
                    thumbnailBadges: [{
                      thumbnailBadgeViewModel: { text: '35 videos' },
                    }],
                  },
                }],
              },
            },
          },
        },
        metadata: {
          lockupMetadataViewModel: {
            title: { content: 'New format playlist' },
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [{
                  metadataParts: [
                    { text: { content: 'New creator' } },
                    { text: { content: 'Playlist' } },
                  ],
                }],
              },
            },
          },
        },
      },
    },
  ],
};

test('parses and normalizes YouTube web search renderers', () => {
  const html = `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`;
  const parsed = parseYouTubeInitialData(html);
  const results = extractYouTubeSearchResults(parsed);

  assert.deepEqual(results[0], {
    type: 'video',
    videoId: 'abcdefghijk',
    title: 'Example video',
    author: 'Example creator',
    lengthSeconds: 62,
    viewCount: 1_200_000,
    publishedText: '2 days ago',
  });
  assert.equal(results[1].type, 'playlist');
  assert.equal(results[1].playlistId, 'PLabcdefghijk');
  assert.equal(results[1].videoCount, 25);
  assert.equal(results[1].videos[0].videoId, 'lmnopqrstuv');
  assert.equal(results[2].type, 'playlist');
  assert.equal(results[2].playlistId, 'PLnewformat12345');
  assert.equal(results[2].title, 'New format playlist');
  assert.equal(results[2].author, 'New creator');
  assert.equal(results[2].videoCount, 35);
  assert.equal(results[2].videos[0].videoId, 'zyxwvutsrqp');
});

test('fetches YouTube web search results through the server fallback', async () => {
  let requestedUrl = '';
  const results = await fetchYouTubeSearchResults('example query', {
    fetchImpl: async url => {
      requestedUrl = String(url);
      return {
        ok: true,
        text: async () => `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`,
      };
    },
  });

  assert.match(requestedUrl, /search_query=example\+query/);
  assert.equal(results[0].videoId, 'abcdefghijk');
});

test('fetches search results from the YouTube JSON web client', async () => {
  let requestOptions;
  const results = await fetchYouTubeJsonSearchResults('example query', {
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return {
        ok: true,
        json: async () => initialData,
      };
    },
  });

  const body = JSON.parse(requestOptions.body);
  assert.equal(requestOptions.method, 'POST');
  assert.equal(body.query, 'example query');
  assert.equal(results[0].videoId, 'abcdefghijk');
});

test('keeps a fast primary search source preferred', async () => {
  let fallbackCalls = 0;
  const result = await raceSearchSources(
    async () => ({ provider: 'invidious', data: ['primary'] }),
    async () => {
      fallbackCalls += 1;
      return { provider: 'youtube-web', data: ['fallback'] };
    },
    { fallbackDelayMs: 10 },
  );

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(result.provider, 'invidious');
  assert.equal(fallbackCalls, 0);
});

test('uses the staggered fallback without waiting for a slow primary source', async () => {
  const result = await raceSearchSources(
    () => new Promise(resolve => setTimeout(
      () => resolve({ provider: 'invidious', data: ['primary'] }),
      50,
    )),
    async () => ({ provider: 'youtube-web', data: ['fallback'] }),
    { fallbackDelayMs: 5 },
  );

  assert.equal(result.provider, 'youtube-web');
  assert.deepEqual(result.data, ['fallback']);
});

test('retries the YouTube fallback once after a transient failure', async () => {
  let calls = 0;
  const results = await fetchYouTubeSearchResultsWithRetry('example query', {
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (options?.method === 'POST') throw new Error('Temporary JSON failure');
      return {
        ok: true,
        text: async () => `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`,
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(results[0].videoId, 'abcdefghijk');
});
