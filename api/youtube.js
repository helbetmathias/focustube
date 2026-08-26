import { INVIDIOUS_CAPABILITIES } from '../shared/invidious.js';
import { createProviderRouter } from '../server/providerRouter.js';
import {
  fetchYouTubeSearchResults,
  raceSearchSources,
} from '../server/youtubeSearchFallback.js';

const router = createProviderRouter();
const rateWindows = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || 'unknown').split(',')[0].trim();
}

function withinRateLimit(request) {
  const ip = clientIp(request);
  const now = Date.now();
  if (rateWindows.size > 2000) {
    for (const [key, value] of rateWindows) {
      if (now - value.startedAt >= RATE_WINDOW_MS) rateWindows.delete(key);
    }
  }
  const current = rateWindows.get(ip);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return null;

  try {
    const requestHost = request.headers['x-forwarded-host'] || request.headers.host;
    if (new URL(origin).host === requestHost) return origin;
  } catch {
    return false;
  }

  const configured = (process.env.FOCUSTUBE_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return configured.includes(origin) ? origin : false;
}

function readRequest(query) {
  const operation = String(query.operation || '');
  if (operation === INVIDIOUS_CAPABILITIES.SEARCH) {
    const searchQuery = String(query.q || '').trim();
    if (!searchQuery || searchQuery.length > 200) throw new Error('Invalid search query');
    return {
      capability: operation,
      params: { query: searchQuery, pages: String(query.pages) === '2' ? 2 : 1 },
    };
  }

  if (operation === INVIDIOUS_CAPABILITIES.RELATED) {
    const videoId = String(query.id || '');
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid video ID');
    return { capability: operation, params: { videoId } };
  }

  if (operation === INVIDIOUS_CAPABILITIES.PLAYLIST) {
    const playlistId = String(query.id || '');
    if (!/^[\w-]{10,80}$/.test(playlistId)) throw new Error('Invalid playlist ID');
    return { capability: operation, params: { playlistId } };
  }

  throw new Error('Unsupported operation');
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');

  const origin = allowedOrigin(request);
  if (origin === false) return response.status(403).json({ ok: false, error: 'Origin not allowed' });
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);

  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return response.status(204).end();
  }
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!withinRateLimit(request)) return response.status(429).json({ ok: false, error: 'Too many requests' });

  let parsed;
  try {
    parsed = readRequest(request.body || {});
  } catch (error) {
    return response.status(400).json({ ok: false, error: error.message });
  }

  try {
    const result = parsed.capability === INVIDIOUS_CAPABILITIES.SEARCH
      ? await raceSearchSources(
          () => router.request(parsed.capability, parsed.params),
          async () => ({
            provider: 'youtube-web',
            data: await fetchYouTubeSearchResults(parsed.params.query),
          }),
        )
      : await router.request(parsed.capability, parsed.params);
    return response.status(200).json({ ok: true, provider: result.provider, data: result.data });
  } catch {
    return response.status(502).json({ ok: false, error: 'No healthy provider available' });
  }
}
