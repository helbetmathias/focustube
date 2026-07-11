export function parseYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return { videoId: null, playlistId: null, query: null };
  
  try {
    // If it doesn't start with http, it might be a search query
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Not a URL');
    }
    
    const urlObj = new URL(url);
    const result = { videoId: null, playlistId: null, query: null };

    const hostname = urlObj.hostname.toLowerCase();
    const isYouTubeHost = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');

    if (isYouTubeHost) {
      result.videoId = urlObj.searchParams.get('v');
      result.playlistId = urlObj.searchParams.get('list');
      if (!result.videoId) {
        const pathMatch = urlObj.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
        result.videoId = pathMatch?.[1] || null;
      }
    } else if (hostname === 'youtu.be') {
      result.videoId = urlObj.pathname.slice(1);
      result.playlistId = urlObj.searchParams.get('list');
    }

    // If it is a valid youtube URL but has no video or playlist ID, maybe they pasted youtube.com itself.
    // We treat it as invalid unless it has v= or list=
    if (!result.videoId && !result.playlistId) {
      throw new Error('No video or playlist ID');
    }

    return result;
  } catch {
    // Treat as search query
    return { videoId: null, playlistId: null, query: url.trim() };
  }
}
