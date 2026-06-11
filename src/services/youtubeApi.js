let cachedInstances = null;

async function getInvidiousInstances() {
  if (cachedInstances && cachedInstances.length > 0) return cachedInstances;
  
  // A massive pool of 20+ verified Invidious and Piped-compatible instances.
  // We completely bypass the api.invidious.io 3-second bottleneck because it is currently unreliable.
  const pool = [
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
    "https://invidious.projectsegfau.lt"
  ];
  
  // Shuffle the array to distribute the load globally across thousands of users
  cachedInstances = pool.sort(() => Math.random() - 0.5);
  
  // PERSISTENT MEMORY: If we have a saved Golden Server from a previous session, inject it at the absolute #1 spot
  try {
    const savedGolden = localStorage.getItem('focustube_golden_server');
    if (savedGolden) {
      const idx = cachedInstances.indexOf(savedGolden);
      if (idx > -1) {
        cachedInstances.splice(idx, 1);
      }
      cachedInstances.unshift(savedGolden);
    }
  } catch (e) {
    // Ignore localStorage errors in incognito/strict modes
  }
  
  return cachedInstances;
}

function promoteInstance(uri) {
  if (cachedInstances) {
    const idx = cachedInstances.indexOf(uri);
    if (idx > 0) {
      cachedInstances.splice(idx, 1);
      cachedInstances.unshift(uri);
      
      // PERSISTENT MEMORY: Save this new Golden Server to the hard drive for tomorrow
      try {
        localStorage.setItem('focustube_golden_server', uri);
      } catch (e) {
        // Ignore
      }
    }
  }
}

export async function fetchRelatedVideos(videoId, author) {
  const instances = await getInvidiousInstances();
  
  let failures = 0;
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // Restored to 6s because Invidious video payloads are heavy and take time
      
      const res = await fetch(`${uri}/api/v1/videos/${videoId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        failures++;
        if (failures >= 3) break;
        continue;
      }
      
      const data = await res.json();
      if (data.recommendedVideos && data.recommendedVideos.length > 0) {
        promoteInstance(uri); // Lock onto this working server for future requests
        // Normalize the response so the UI always gets a clean, predictable format
        return data.recommendedVideos.map(vid => ({
          id: vid.videoId,
          title: vid.title,
          author: vid.author,
          lengthSeconds: vid.lengthSeconds,
          viewCount: vid.viewCountText || vid.viewCount,
          thumbnail: `https://img.youtube.com/vi/${vid.videoId}/hqdefault.jpg`,
          type: 'video'
        }));
      }
    } catch (err) {
      failures++;
      if (failures >= 3) break;
    }
  }
  
  throw new Error("All public instances failed to return related videos");
}

export async function fetchAuthorFallback(author, excludeVideoId) {
  if (!author) return [];
  try {
    const cleanAuthor = author.replace(/VEVO$/i, '').replace(/ - Topic$/i, '');
    const searchResults = await fetchSearchResults(cleanAuthor);
    let filtered = searchResults.filter(v => 
      v.id !== excludeVideoId && 
      v.type === 'video' &&
      v.author && (v.author.toLowerCase().includes(cleanAuthor.toLowerCase()) || cleanAuthor.toLowerCase().includes(v.author.toLowerCase()))
    );
    
    // If strict match failed (common with music videos), return the top 15 results from the author search anyway
    if (filtered.length === 0) {
      filtered = searchResults.filter(v => v.type === 'video' && v.id !== excludeVideoId).slice(0, 15);
    }
    
    return filtered;
  } catch (e) {
    console.warn("Author search fallback failed", e);
    throw e;
  }
}

export async function fetchPlaylistDetails(playlistId) {
  const instances = await getInvidiousInstances();
  
  let failures = 0;
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
      const res = await fetch(`${uri}/api/v1/playlists/${playlistId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        failures++;
        if (failures >= 3) break;
        continue;
      }
      
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
        promoteInstance(uri);
        return {
          title: data.title,
          author: data.author,
          videoCount: data.videoCount,
          videos: data.videos.map(vid => ({
            id: vid.videoId,
            title: vid.title,
            author: vid.author,
            lengthSeconds: vid.lengthSeconds,
            thumbnail: `https://img.youtube.com/vi/${vid.videoId}/hqdefault.jpg`
          }))
        };
      }
    } catch (err) {
      failures++;
      if (failures >= 3) break;
    }
  }
  
  throw new Error("All public instances failed to return playlist details");
}

export async function fetchSearchResults(query, singlePage = false) {
  const instances = await getInvidiousInstances();
  
  let failures = 0;
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Restored to 5s
      const res1 = await fetch(`${uri}/api/v1/search?q=${encodeURIComponent(query)}&page=1`, {
        signal: controller.signal
      });
      
      if (!res1.ok) {
        clearTimeout(timeoutId);
        failures++;
        if (failures >= 3) break;
        continue;
      }
      
      let data = await res1.json();
      
      // Try to fetch page 2 to double the results
      if (!singlePage) {
        try {
          const res2 = await fetch(`${uri}/api/v1/search?q=${encodeURIComponent(query)}&page=2`, {
            signal: controller.signal
          });
          if (res2.ok) {
            const data2 = await res2.json();
            if (Array.isArray(data2)) {
              data = [...data, ...data2];
            }
          }
        } catch (e) {
          // If page 2 fails, we still have page 1
        }
      }
      
      clearTimeout(timeoutId);
      
      if (Array.isArray(data) && data.length > 0) {
        promoteInstance(uri);
        return data.filter(item => item.type === 'video' || item.type === 'playlist').map(item => {
          if (item.type === 'playlist') {
            return {
              type: 'playlist',
              id: item.playlistId,
              title: item.title,
              author: item.author,
              videoCount: item.videoCount,
              thumbnail: item.videos && item.videos.length > 0 
                ? `https://img.youtube.com/vi/${item.videos[0].videoId}/hqdefault.jpg` 
                : (item.playlistThumbnail || `https://i.ytimg.com/img/no_thumbnail.jpg`)
            };
          } else {
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
          }
        });
      } else if (Array.isArray(data)) {
         return []; // valid empty response
      }
    } catch (err) {
      failures++;
      if (failures >= 3) break;
    }
  }
  
  throw new Error("All public instances failed to return search results");
}
