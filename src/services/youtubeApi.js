const INSTANCE_POOL = [
  "https://inv.thepixora.com",
  "https://vid.puffyan.us",
  "https://invidious.jing.rocks",
  "https://inv.tux.pizza",
  "https://invidious.nerdvpn.de",
  "https://inv.nadeko.net",
  "https://yt.cdaut.de",
  "https://inv.us.projectsegfau.lt",
  "https://invidious.lunar.icu",
  "https://invidious.snopyta.org",
  "https://yewtu.be",
  "https://invidious.tiekoetter.com",
  "https://invidious.mutahar.rocks",
  "https://invidious.slipfox.xyz",
  "https://invidious.weblibre.org",
  "https://invidious.privacydev.net",
  "https://invidious.esmailelbob.xyz",
  "https://invidious.projectsegfau.lt",
  "https://yt.chocolatemoo53.com"
];

const PREFERRED_SEARCH_INSTANCE = "https://yt.chocolatemoo53.com";
const CAPABILITIES = {
  SEARCH: 'search',
  RELATED: 'related',
  PLAYLIST: 'playlist'
};
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_PER_REQUEST = 5;

let shuffledInstances = null;
const failedByCapability = {
  [CAPABILITIES.SEARCH]: new Map(),
  [CAPABILITIES.RELATED]: new Map(),
  [CAPABILITIES.PLAYLIST]: new Map()
};

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function moveToFront(values, uri) {
  if (!uri || !values.includes(uri)) return values;
  return [uri, ...values.filter(value => value !== uri)];
}

function readGoldenInstance(capability) {
  try {
    const capabilityGolden = localStorage.getItem(`focustube_golden_server_${capability}`);
    if (capabilityGolden) return capabilityGolden;

    // Migrate the original shared golden server only for search. A search-capable
    // instance is not necessarily capable of video details or playlists.
    if (capability === CAPABILITIES.SEARCH) {
      return localStorage.getItem('focustube_golden_server');
    }
  } catch {
    // localStorage can be unavailable in strict or private browsing modes.
  }
  return null;
}

function getInstances(capability) {
  if (!shuffledInstances) {
    const withoutPreferred = INSTANCE_POOL.filter(uri => uri !== PREFERRED_SEARCH_INSTANCE);
    shuffledInstances = [PREFERRED_SEARCH_INSTANCE, ...shuffle(withoutPreferred)];
  }

  let ordered = [...shuffledInstances];
  ordered = moveToFront(ordered, readGoldenInstance(capability));
  if (capability === CAPABILITIES.SEARCH) {
    ordered = moveToFront(ordered, PREFERRED_SEARCH_INSTANCE);
  }

  const failures = failedByCapability[capability];
  const now = Date.now();
  const available = ordered.filter(uri => {
    const failedAt = failures.get(uri);
    if (!failedAt) return true;
    if (now - failedAt >= FAILURE_COOLDOWN_MS) {
      failures.delete(uri);
      return true;
    }
    return false;
  });

  return available.slice(0, MAX_ATTEMPTS_PER_REQUEST);
}

function promoteInstance(uri, capability) {
  failedByCapability[capability].delete(uri);
  try {
    localStorage.setItem(`focustube_golden_server_${capability}`, uri);
    if (capability === CAPABILITIES.SEARCH) {
      localStorage.setItem('focustube_golden_server', uri);
    }
  } catch {
    // Ignore storage failures; the current request still succeeded.
  }
}

function markInstanceFailed(uri, capability) {
  failedByCapability[capability].set(uri, Date.now());
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchRelatedVideos(videoId) {
  const instances = getInstances(CAPABILITIES.RELATED);

  for (const uri of instances) {
    try {
      const data = await fetchJsonWithTimeout(`${uri}/api/v1/videos/${videoId}`, 6000);
      if (!Array.isArray(data.recommendedVideos)) {
        markInstanceFailed(uri, CAPABILITIES.RELATED);
        continue;
      }

      promoteInstance(uri, CAPABILITIES.RELATED);
      if (data.recommendedVideos.length === 0) continue;

      return data.recommendedVideos.map(video => ({
        id: video.videoId,
        title: video.title,
        author: video.author,
        lengthSeconds: video.lengthSeconds,
        viewCount: video.viewCountText || video.viewCount,
        thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
        type: 'video'
      }));
    } catch {
      markInstanceFailed(uri, CAPABILITIES.RELATED);
    }
  }

  throw new Error("All available instances failed to return related videos");
}

export async function fetchAuthorFallback(author, excludeVideoId) {
  if (!author) return [];

  try {
    const cleanAuthor = author.replace(/VEVO$/i, '').replace(/ - Topic$/i, '');
    const searchResults = await fetchSearchResults(cleanAuthor);
    let filtered = searchResults.filter(video =>
      video.id !== excludeVideoId &&
      video.type === 'video' &&
      video.author &&
      (video.author.toLowerCase().includes(cleanAuthor.toLowerCase()) ||
        cleanAuthor.toLowerCase().includes(video.author.toLowerCase()))
    );

    if (filtered.length === 0) {
      filtered = searchResults
        .filter(video => video.type === 'video' && video.id !== excludeVideoId)
        .slice(0, 15);
    }

    return filtered;
  } catch (error) {
    console.warn("Author search fallback failed", error);
    throw error;
  }
}

export async function fetchPlaylistDetails(playlistId) {
  const instances = getInstances(CAPABILITIES.PLAYLIST);

  for (const uri of instances) {
    try {
      const data = await fetchJsonWithTimeout(`${uri}/api/v1/playlists/${playlistId}`, 4000);
      if (!Array.isArray(data.videos)) {
        markInstanceFailed(uri, CAPABILITIES.PLAYLIST);
        continue;
      }

      promoteInstance(uri, CAPABILITIES.PLAYLIST);
      return {
        title: data.title,
        author: data.author,
        videoCount: data.videoCount,
        videos: data.videos.map(video => ({
          id: video.videoId,
          title: video.title,
          author: video.author,
          lengthSeconds: video.lengthSeconds,
          thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`
        }))
      };
    } catch {
      markInstanceFailed(uri, CAPABILITIES.PLAYLIST);
    }
  }

  throw new Error("All available instances failed to return playlist details");
}

function normalizeSearchResults(data) {
  return data
    .filter(item => item.type === 'video' || item.type === 'playlist')
    .map(item => {
      if (item.type === 'playlist') {
        return {
          type: 'playlist',
          id: item.playlistId,
          title: item.title,
          author: item.author,
          videoCount: item.videoCount,
          thumbnail: item.videos && item.videos.length > 0
            ? `https://img.youtube.com/vi/${item.videos[0].videoId}/hqdefault.jpg`
            : (item.playlistThumbnail || 'https://i.ytimg.com/img/no_thumbnail.jpg')
        };
      }

      return {
        type: 'video',
        id: item.videoId,
        title: item.title,
        author: item.author,
        lengthSeconds: item.lengthSeconds,
        viewCount: item.viewCount,
        publishedText: item.publishedText,
        thumbnail: `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`
      };
    });
}

export async function fetchSearchResults(query, singlePage = false) {
  const instances = getInstances(CAPABILITIES.SEARCH);
  const encodedQuery = encodeURIComponent(query);

  for (const uri of instances) {
    try {
      let data = await fetchJsonWithTimeout(`${uri}/api/v1/search?q=${encodedQuery}&page=1`, 5000);
      if (!Array.isArray(data)) {
        markInstanceFailed(uri, CAPABILITIES.SEARCH);
        continue;
      }

      promoteInstance(uri, CAPABILITIES.SEARCH);

      if (!singlePage) {
        try {
          const secondPage = await fetchJsonWithTimeout(`${uri}/api/v1/search?q=${encodedQuery}&page=2`, 5000);
          if (Array.isArray(secondPage)) data = [...data, ...secondPage];
        } catch {
          // Page one is still a valid successful result.
        }
      }

      return normalizeSearchResults(data);
    } catch {
      markInstanceFailed(uri, CAPABILITIES.SEARCH);
    }
  }

  throw new Error("All available instances failed to return search results");
}
