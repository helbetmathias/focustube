let cachedInstances = null;

async function getInvidiousInstances() {
  if (cachedInstances && cachedInstances.length > 0) return cachedInstances;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    // Fetch official list of instances
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=health', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (res.ok) {
      const data = await res.json();
      
      // Filter for active, HTTPS, and API-capable instances
      const validInstances = data
        .filter(instance => 
          instance[1] && 
          instance[1].type === "https" && 
          instance[1].api === true &&
          instance[1].cors === true &&
          instance[1].monitor &&
          instance[1].monitor.down === false
        )
        // Sort by latency
        .sort((a, b) => (a[1].monitor.latency || 9999) - (b[1].monitor.latency || 9999))
        .map(instance => instance[1].uri);
        
      if (validInstances.length > 0) {
        // Cache the top 10 fastest instances for the session
        cachedInstances = validInstances.slice(0, 10);
        return cachedInstances;
      }
    }
  } catch (e) {
    console.warn("Failed to fetch Invidious instances list, falling back to hardcoded list", e);
  }
  
  // Hardcoded fallback list if the main registry is down
  return [
    "https://inv.thepixora.com",
    "https://vid.puffyan.us",
    "https://invidious.jing.rocks",
    "https://inv.tux.pizza"
  ].sort(() => Math.random() - 0.5);
}

export async function fetchRelatedVideos(videoId, author) {
  const instances = await getInvidiousInstances();
  
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout for heavier load
      
      const res = await fetch(`${uri}/api/v1/videos/${videoId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data.recommendedVideos && data.recommendedVideos.length > 0) {
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
      // Ignore errors (like timeout or cors) and immediately try the next instance
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
  
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
      const res = await fetch(`${uri}/api/v1/playlists/${playlistId}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
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
      // Ignore errors and try the next instance
    }
  }
  
  throw new Error("All public instances failed to return playlist details");
}

export async function fetchSearchResults(query, singlePage = false) {
  const instances = await getInvidiousInstances();
  
  for (const uri of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for search
      
      const res1 = await fetch(`${uri}/api/v1/search?q=${encodeURIComponent(query)}&page=1`, {
        signal: controller.signal
      });
      
      if (!res1.ok) {
        clearTimeout(timeoutId);
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
      // Ignore errors and try the next instance
    }
  }
  
  throw new Error("All public instances failed to return search results");
}
