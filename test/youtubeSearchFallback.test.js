import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeSearchResults,
  fetchYouTubeSearchResults,
  parseYouTubeInitialData,
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
