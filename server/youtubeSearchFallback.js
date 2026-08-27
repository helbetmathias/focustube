const YOUTUBE_SEARCH_URL = 'https://www.youtube.com/results';
const YOUTUBE_JSON_SEARCH_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const YOUTUBE_WEB_CLIENT_VERSION = '2.20260825.01.00';

export function raceSearchSources(primaryRequest, fallbackRequest, {
  fallbackDelayMs = 500,
} = {}) {
  return new Promise((resolve, reject) => {
    const errors = [];
    let settled = false;
    let fallbackStarted = false;
    let fallbackTimer;

    const succeed = result => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      resolve(result);
    };

    const fail = error => {
      errors.push(error);
      if (errors.length === 2 && !settled) {
        settled = true;
        reject(new AggregateError(errors, 'No search source was available'));
      }
    };

    const startFallback = () => {
      if (fallbackStarted || settled) return;
      fallbackStarted = true;
      Promise.resolve().then(fallbackRequest).then(succeed, fail);
    };

    fallbackTimer = setTimeout(startFallback, fallbackDelayMs);
    Promise.resolve().then(primaryRequest).then(succeed, error => {
      clearTimeout(fallbackTimer);
      fail(error);
      startFallback();
    });
  });
}

function rendererText(value) {
  if (!value) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map(run => run?.text || '').join('');
  }
  return '';
}

function compactNumber(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  const match = text.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  return Math.round(Number(match[1]) * (multipliers[match[2]?.toUpperCase()] || 1));
}

function durationSeconds(value) {
  const parts = String(value || '')
    .split(':')
    .map(part => Number(part.trim()));
  if (parts.length === 0 || parts.some(part => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => (total * 60) + part, 0);
}

function findJsonObject(source, markerIndex) {
  const start = source.indexOf('{', markerIndex);
  if (start < 0) throw new Error('YouTube initial data was not found');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error('YouTube initial data was incomplete');
}

export function parseYouTubeInitialData(html) {
  const markers = ['var ytInitialData =', 'window["ytInitialData"] =', 'ytInitialData ='];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    try {
      return JSON.parse(findJsonObject(html, markerIndex + marker.length));
    } catch {
      // Try another marker when YouTube includes a non-data occurrence first.
    }
  }
  throw new Error('YouTube initial data could not be parsed');
}

function videoFromRenderer(renderer) {
  if (!/^[\w-]{11}$/.test(renderer?.videoId || '')) return null;
  return {
    type: 'video',
    videoId: renderer.videoId,
    title: rendererText(renderer.title),
    author: rendererText(renderer.ownerText) || rendererText(renderer.shortBylineText),
    lengthSeconds: durationSeconds(rendererText(renderer.lengthText)),
    viewCount: compactNumber(rendererText(renderer.viewCountText) || rendererText(renderer.shortViewCountText)),
    publishedText: rendererText(renderer.publishedTimeText),
  };
}

function playlistFromRenderer(renderer) {
  if (!/^[\w-]{10,80}$/.test(renderer?.playlistId || '')) return null;
  const videos = (renderer.videos || [])
    .map(item => item?.childVideoRenderer?.videoId)
    .filter(videoId => /^[\w-]{11}$/.test(videoId || ''))
    .map(videoId => ({ videoId }));
  const thumbnails = renderer.thumbnails?.[0]?.thumbnails || [];

  return {
    type: 'playlist',
    playlistId: renderer.playlistId,
    title: rendererText(renderer.title),
    author: rendererText(renderer.shortBylineText) || rendererText(renderer.ownerText),
    videoCount: compactNumber(rendererText(renderer.videoCount)),
    videos,
    playlistThumbnail: thumbnails.at(-1)?.url || '',
  };
}

export function extractYouTubeSearchResults(initialData) {
  const results = [];
  const seen = new Set();

  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const candidates = [
      videoFromRenderer(value.videoRenderer),
      playlistFromRenderer(value.playlistRenderer),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const id = candidate.videoId || candidate.playlistId;
      const key = `${candidate.type}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(candidate);
      }
    }

    Object.values(value).forEach(visit);
  };

  visit(initialData);
  return results.slice(0, 40);
}

export async function fetchYouTubeSearchResults(query, {
  fetchImpl = fetch,
  timeoutMs = 7000,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(YOUTUBE_SEARCH_URL);
    url.searchParams.set('search_query', query);
    url.searchParams.set('hl', 'en');
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status}`);
    const initialData = parseYouTubeInitialData(await response.text());
    const results = extractYouTubeSearchResults(initialData);
    if (results.length === 0) throw new Error('YouTube returned no search results');
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchYouTubeJsonSearchResults(query, {
  fetchImpl = fetch,
  timeoutMs = 4500,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(YOUTUBE_JSON_SEARCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': YOUTUBE_WEB_CLIENT_VERSION,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: YOUTUBE_WEB_CLIENT_VERSION,
            hl: 'en',
            gl: 'US',
          },
        },
        query,
      }),
    });
    if (!response.ok) throw new Error(`YouTube JSON search returned HTTP ${response.status}`);
    const results = extractYouTubeSearchResults(await response.json());
    if (results.length === 0) throw new Error('YouTube JSON search returned no results');
    return results;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchYouTubeSearchResultsWithRetry(query, {
  attempts = 2,
  fetchImpl = fetch,
  timeoutMs = 4500,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await raceSearchSources(
        () => fetchYouTubeJsonSearchResults(query, { fetchImpl, timeoutMs }),
        () => fetchYouTubeSearchResults(query, { fetchImpl, timeoutMs }),
        { fallbackDelayMs: 600 },
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('YouTube search fallback failed');
}
