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
      shortsLockupViewModel: {
        entityId: 'shorts-shelf-item-lockupshort',
        accessibilityText: 'Dedicated shelf Short, 2.8 million views - play Short',
        onTap: {
          innertubeCommand: {
            commandMetadata: {
              webCommandMetadata: {
                url: '/shorts/lockupshort',
                webPageType: 'WEB_PAGE_TYPE_SHORTS',
              },
            },
            reelWatchEndpoint: {
              videoId: 'lockupshort',
              thumbnail: {
                thumbnails: [{
                  url: 'https://i.ytimg.com/vi/lockupshort/frame0.jpg',
                  width: 1080,
                  height: 1920,
                }],
              },
            },
          },
        },
        overlayMetadata: {
          primaryText: { content: 'Dedicated shelf Short' },
          secondaryText: { content: '2.8M views' },
        },
      },
    },
    {
      videoRenderer: {
        videoId: 'shortsabcde',
        title: {
          runs: [{ text: 'Example Short' }],
          accessibility: { accessibilityData: { label: 'Example Short - play Short' } },
        },
        ownerText: { runs: [{ text: 'Short creator' }] },
        lengthText: { simpleText: '1:11' },
        navigationEndpoint: {
          commandMetadata: {
            webCommandMetadata: {
              url: '/shorts/shortsabcde',
              webPageType: 'WEB_PAGE_TYPE_SHORTS',
            },
          },
          reelWatchEndpoint: { videoId: 'shortsabcde' },
        },
        thumbnailOverlays: [{
          thumbnailOverlayTimeStatusRenderer: { style: 'SHORTS' },
        }],
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
    isShort: false,
  });
  const shortResult = results.find(result => result.videoId === 'shortsabcde');
  assert.equal(shortResult.type, 'video');
  assert.equal(shortResult.isShort, true);

  const lockupResult = results.find(result => result.videoId === 'lockupshort');
  assert.equal(lockupResult.type, 'video');
  assert.equal(lockupResult.title, 'Dedicated shelf Short');
  assert.equal(lockupResult.viewCount, 2_800_000);
  assert.equal(lockupResult.isShort, true);

  const classicPlaylist = results.find(result => result.playlistId === 'PLabcdefghijk');
  assert.equal(classicPlaylist.type, 'playlist');
  assert.equal(classicPlaylist.videoCount, 25);
  assert.equal(classicPlaylist.videos[0].videoId, 'lmnopqrstuv');

  const lockupPlaylist = results.find(result => result.playlistId === 'PLnewformat12345');
  assert.equal(lockupPlaylist.type, 'playlist');
  assert.equal(lockupPlaylist.title, 'New format playlist');
  assert.equal(lockupPlaylist.author, 'New creator');
  assert.equal(lockupPlaylist.videoCount, 35);
  assert.equal(lockupPlaylist.videos[0].videoId, 'zyxwvutsrqp');
});

test('Short shelf duplicates upgrade regular renderers without consuming the regular result limit', () => {
  const contents = [];
  for (let index = 0; index < 45; index += 1) {
    const videoId = `regular${String(index).padStart(4, '0')}`;
    contents.push({
      videoRenderer: {
        videoId,
        title: { simpleText: `Regular ${index}` },
      },
    });
  }

  contents.unshift({
    videoRenderer: {
      videoId: 'duplicatesh',
      title: { simpleText: 'Duplicate with duration' },
      lengthText: { simpleText: '0:42' },
    },
  });
  contents.push({
    shortsLockupViewModel: {
      onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: 'duplicatesh' } } },
      overlayMetadata: { primaryText: { content: 'Duplicate Short' } },
    },
  });

  const results = extractYouTubeSearchResults({ contents });
  const regularResults = results.filter(result => !result.isShort);
  const duplicate = results.find(result => result.videoId === 'duplicatesh');

  assert.equal(regularResults.length, 40);
  assert.equal(duplicate.isShort, true);
  assert.equal(duplicate.lengthSeconds, 42);
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

test('loads a second YouTube search page from its continuation token', async () => {
  const firstPage = {
    contents: [
      { videoRenderer: { videoId: 'firstpage01', title: { simpleText: 'First page' } } },
      {
        continuationItemRenderer: {
          continuationEndpoint: {
            continuationCommand: { token: 'next-page-token' },
          },
        },
      },
    ],
  };
  const secondPage = {
    continuationContents: [
      { videoRenderer: { videoId: 'secondpage1', title: { simpleText: 'Second page' } } },
    ],
  };
  const requests = [];

  const results = await fetchYouTubeJsonSearchResults('example query', {
    pages: 2,
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => requests.length === 1 ? firstPage : secondPage,
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].continuation, 'next-page-token');
  assert.deepEqual(results.map(result => result.videoId), ['firstpage01', 'secondpage1']);
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
