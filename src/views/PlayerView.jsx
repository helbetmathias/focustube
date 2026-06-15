import { useState, useEffect, useRef } from 'react';
import { Play, Link as LinkIcon, Loader2, Search, ListVideo, ArrowLeft, LayoutGrid } from 'lucide-react';
import YouTubePlayer from '../components/YouTubePlayer';
import { parseYouTubeUrl } from '../utils/youtube';
import { fetchPlaylistDetails, fetchSearchResults, fetchRelatedVideos } from '../services/youtubeApi';
import { getHistory, saveHistory, getHomeBlendCache, saveHomeBlendCache } from '../services/storage';

const ThumbnailImage = ({ src, videoId, alt, className }) => {
  const [level, setLevel] = useState(0);
  const imgRef = useRef(null);

  useEffect(() => {
    setLevel(0);
  }, [src, videoId]);

  const urls = [
    src,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/default.jpg`
  ];

  const checkPlaceholder = () => {
    const el = imgRef.current;
    if (el && el.complete) {
      if (el.naturalWidth === 120 && el.naturalHeight === 90) {
        if (level < urls.length - 1) {
          setLevel(l => l + 1);
        }
      }
    }
  };

  useEffect(() => {
    checkPlaceholder();
  }, [level]);

  return (
    <img
      ref={imgRef}
      src={urls[level]}
      alt={alt}
      className={className}
      onError={() => {
        if (level < urls.length - 1) {
          setLevel(l => l + 1);
        }
      }}
      onLoad={checkPlaceholder}
      loading="lazy"
    />
  );
};

export default function PlayerView({ isActive, playRequest, onChannelClick }) {
  const [url, setUrl] = useState('');
  const [mediaInfo, setMediaInfo] = useState({ videoId: null, playlistId: null });
  const [startSeconds, setStartSeconds] = useState(0);
  const [playlistData, setPlaylistData] = useState(null);
  const [playlistMetadata, setPlaylistMetadata] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [ambient, setAmbient] = useState(false);
  const [recommMode, setRecommMode] = useState(() => localStorage.getItem('puretube_recomm') || 'all');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [homeFeed, setHomeFeed] = useState(null);
  const [lastFeedGenTime, setLastFeedGenTime] = useState(() => Number(localStorage.getItem('puretube_last_feed_gen')) || 0);
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [disableFeedAnims, setDisableFeedAnims] = useState(false);
  const [isFeedLoading, setIsFeedLoading] = useState(true);
  const currentVideoIdRef = useRef(null);
  const lastFeedGenTimeRef = useRef(Number(localStorage.getItem('puretube_last_feed_gen')) || 0);

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatViews = (views) => {
    if (!views) return '';
    const str = String(views);
    if (/[mkb]/i.test(str)) {
      return str.replace(/\s*views?/i, '').trim();
    }
    const num = parseInt(str.replace(/,/g, ''), 10);
    if (isNaN(num)) return views;
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
  };

  useEffect(() => {
    const readSettings = () => {
      const a = localStorage.getItem('puretube_ambient');
      setAmbient(a !== null ? a === 'true' : false);
      const r = localStorage.getItem('puretube_recomm');
      setRecommMode(r ? r : 'all');
    };
    readSettings();
    window.addEventListener('puretube_settings_updated', readSettings);
    return () => window.removeEventListener('puretube_settings_updated', readSettings);
  }, []);

  // Load Home Feed
  const loadHomeFeed = async (forceRefresh = false) => {
    if (recommMode === 'off') {
        setIsFeedLoading(false);
        return;
    }
    setIsFeedLoading(true);
    if (!forceRefresh) {
      const cache = await getHomeBlendCache();
      if (cache && cache.length > 0) {
        setHomeFeed(cache);
        setIsFeedLoading(false);
        return;
      }
    }
    
    try {
      const history = await getHistory();
      if (!history || history.length === 0) {
        setIsFeedLoading(false);
        return;
      }
      
      // Sort history by timestamp descending to get the most recently watched authors first
      const sortedHistory = [...history].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const authors = [...new Set(sortedHistory.map(h => h.author).filter(Boolean))];
      
      // Pick top 10 recent authors, then shuffle them to get 4 random ones
      const recentAuthors = authors.slice(0, 10);
      const shuffledAuthors = recentAuthors.sort(() => 0.5 - Math.random()).slice(0, 4);
      if (shuffledAuthors.length === 0) {
        setIsFeedLoading(false);
        return;
      }

      // 50/50 split means 10 author videos, 10 related videos.
      const numAuthors = shuffledAuthors.length;
      const videosPerAuthor = Math.max(3, Math.ceil(10 / numAuthors));

      const historyIds = new Set(history.map(h => h.id));

      let blended = [];
      
      // Branch 1: The Loyal Fan (Creator Search)
      let authorVideos = [];
      for (const author of shuffledAuthors) {
        try {
          const res = await fetchSearchResults(author, true);
          if (res && res.length > 0) {
            const unseenVideos = res.filter(v => v.type === 'video' && !historyIds.has(v.id));
            authorVideos.push(unseenVideos.slice(0, videosPerAuthor));
          }
        } catch (e) {
          console.warn("Home feed search failed for", author);
        }
      }

      for (let i = 0; i < videosPerAuthor; i++) {
        for (let j = 0; j < authorVideos.length; j++) {
          if (authorVideos[j][i]) {
            blended.push(authorVideos[j][i]);
          }
        }
      }
      
      // Branch 2: The Explorer (Related Videos)
      let relatedVideos = [];
      // Take up to 3 most recently watched videos to source recommendations from
      const seedVideos = history.slice(0, 3);
      for (const seed of seedVideos) {
        try {
          const res = await fetchRelatedVideos(seed.id);
          if (res && res.length > 0) {
            const unseenRelated = res.filter(v => v.type === 'video' && !historyIds.has(v.id));
            relatedVideos.push(...unseenRelated);
          }
        } catch (e) {
          console.warn("Home feed related search failed for", seed.id);
        }
      }
      
      // Shuffle the related videos and take up to 10
      relatedVideos.sort(() => 0.5 - Math.random());
      blended.push(...relatedVideos.slice(0, 10));

      // Shuffle the final hybrid feed so it's a perfect mix
      blended.sort(() => 0.5 - Math.random());
      
      // Guarantee exactly 20 videos total
      blended = blended.slice(0, 20);

      if (blended.length > 0) {
        setHomeFeed(blended);
        setIsFeedLoading(false);
        saveHomeBlendCache(blended);
        lastFeedGenTimeRef.current = Date.now();
        localStorage.setItem('puretube_last_feed_gen', lastFeedGenTimeRef.current.toString());
        setLastFeedGenTime(lastFeedGenTimeRef.current);
      }
    } catch (e) {
      console.error("Failed to build history feed", e);
    } finally {
      setIsFeedLoading(false);
    }
  };

  useEffect(() => {
    loadHomeFeed();
  }, [recommMode]);

  useEffect(() => {
    if (!isActive) {
      setDisableFeedAnims(true);
    }
  }, [isActive]);

  useEffect(() => {
    const handleRefresh = async () => {
      const feedContainer = document.getElementById('home-feed-container');
      if (feedContainer) feedContainer.scrollTo({ top: 0, behavior: 'smooth' });
      
      setDisableFeedAnims(false);
      setMediaInfo({ videoId: null, playlistId: null });
      setPlaylistData(null);
      setPlaylistMetadata(null);
      setSearchResults(null);
      setUrl('');
      
      try {
        const history = await getHistory();
        const mostRecentWatchTime = history && history.length > 0 ? history[0].timestamp : 0;
        
        if (mostRecentWatchTime > lastFeedGenTimeRef.current) {
          loadHomeFeed(true);
        } else {
          loadHomeFeed(false);
        }
      } catch (e) {
        loadHomeFeed(true);
      }
    };
    window.addEventListener('focustube_refresh_feed', handleRefresh);
    return () => window.removeEventListener('focustube_refresh_feed', handleRefresh);
  }, []);

  // Ensure scroll resets to top when a completely new feed is rendered
  useEffect(() => {
    if (!isFeedLoading && homeFeed && homeFeed.length > 0) {
      const feedContainer = document.getElementById('home-feed-container');
      if (feedContainer) feedContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [homeFeed, isFeedLoading]);

  useEffect(() => {
    if (mediaInfo.playlistId) {
      setPlaylistMetadata(null);
      fetchPlaylistDetails(mediaInfo.playlistId)
        .then(data => setPlaylistMetadata(data))
        .catch(err => console.error("Playlist rich fetch failed:", err));
    } else {
      setPlaylistMetadata(null);
    }
  }, [mediaInfo.playlistId]);

  useEffect(() => {
    if (playRequest) {
      loadMedia(playRequest.videoId, playRequest.playlistId, playRequest.forceStart);
    }
  }, [playRequest]);

  // Auto-scroll to active playlist item when the playlist is active
  useEffect(() => {
    if (playlistData && playlistData.currentIndex >= 0 && isActive) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`playlist-item-${playlistData.currentIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [playlistData?.currentIndex, isActive]);

  const loadMedia = async (vid, pid, forceStart = false) => {
    let progress = 0;
    if (!forceStart && vid) {
      try {
        const history = await getHistory();
        const item = history.find(i => i.id === vid);
        if (item && item.progress) progress = item.progress;
      } catch(e) {}
    }
    setStartSeconds(progress);
    setMediaInfo({ videoId: vid, playlistId: pid });
    setReloadKey(prev => prev + 1);
    currentVideoIdRef.current = vid;
    if (!pid) {
      setPlaylistData(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!url) return;
    const parsed = parseYouTubeUrl(url);
    if (parsed.videoId || parsed.playlistId) {
      setSearchResults(null);
      loadMedia(parsed.videoId, parsed.playlistId);
    } else if (parsed.query) {
      // It's a search
      loadMedia(null, null); // clear player
      setIsSearching(true);
      setSearchError(false);
      setLastSearchTerm(url);
      fetchSearchResults(parsed.query)
        .then(results => {
          setSearchResults(results);
          setIsSearching(false);
        })
        .catch(() => {
          setSearchError(true);
          setIsSearching(false);
        });
    }
  };

  const updateHistory = async (id, title, progress, duration, author) => {
    try {
      const history = await getHistory();
      
      const existingIdx = history.findIndex(item => item.id === id);
      const existingItem = existingIdx >= 0 ? history[existingIdx] : null;
      
      if (existingIdx >= 0) history.splice(existingIdx, 1);
      
      history.unshift({
        ...(existingItem || {}),
        id,
        title: title || (existingItem ? existingItem.title : ''),
        author: author || (existingItem ? existingItem.author : undefined),
        timestamp: Date.now(),
        type: 'video',
        progress: progress !== undefined ? progress : (existingItem ? existingItem.progress : 0),
        duration: duration || (existingItem ? existingItem.duration : 0),
        playlistId: mediaInfo.playlistId || undefined
      });
      
      await saveHistory(history);
    } catch(e) {
      console.error('Failed to save history', e);
    }
  };

  const handleVideoChange = ({ id, title, author, playlist, playlistIndex }) => {
    currentVideoIdRef.current = id;
    updateHistory(id, title, undefined, undefined, author);
    if (playlist && playlist.length > 1) {
      setPlaylistData({ videos: playlist, currentIndex: playlistIndex });
    }
  };

  const handleProgress = (progress, duration) => {
    if (currentVideoIdRef.current) {
      updateHistory(currentVideoIdRef.current, null, progress, duration);
    }
  };

  const playerMaxHeight = 'calc(100vh - 320px)';
  const videoMaxWidth = `calc(${playerMaxHeight} * (16 / 9))`;
  const containerMaxWidth = (playlistData && playlistData.videos) 
    ? `calc(${videoMaxWidth} + 400px + 1.5rem)` 
    : videoMaxWidth;

  const showBack = searchResults && (mediaInfo.videoId || mediaInfo.playlistId) && (url === lastSearchTerm || url.trim().length === 0);

  return (
    <div className={`flex-1 min-h-0 w-full flex flex-col justify-start lg:justify-center gap-4 sm:gap-6 ${searchResults && !mediaInfo.videoId ? 'animate-page-fade' : ''}`}>
      <div className="flex-none w-full mx-auto transition-all duration-500" style={{ maxWidth: containerMaxWidth }}>
            <h2 className="text-2xl sm:text-3xl font-semibold mb-4 text-zinc-100 tracking-tight">Now Playing</h2>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6">
              <div className="flex-1 relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                  <LinkIcon size={18} />
                </div>
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste YouTube Video/Playlist URL or Search..." 
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-12 pr-4 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                />
              </div>
              {showBack ? (
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMediaInfo({ videoId: null, playlistId: null });
                    setUrl(lastSearchTerm);
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 sm:px-8 py-3 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 border border-zinc-700"
                >
                  <ArrowLeft size={20} />
                  <span>Back</span>
                </button>
              ) : (!url.startsWith('http') && url.trim().length > 0) ? (
                <button type="submit" className="bg-brand-500 hover:bg-brand-400 text-white px-6 sm:px-8 py-3 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2">
                  <Search size={20} />
                  <span>Search</span>
                </button>
              ) : (
                <button type="submit" className="bg-brand-500 hover:bg-brand-400 text-white px-6 sm:px-8 py-3 rounded-xl font-semibold transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2">
                  <Play fill="currentColor" size={20} />
                  <span>Play</span>
                </button>
              )}
            </form>
      </div>

      <div className="flex-1 min-h-0 w-full mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6 lg:justify-center transition-all duration-500" style={{ maxWidth: containerMaxWidth }}>
        {mediaInfo.videoId || mediaInfo.playlistId ? (
          <>
            <div 
              className="w-full lg:flex-1 flex flex-col relative aspect-video transition-all duration-500 z-10"
              style={{ maxHeight: playerMaxHeight, maxWidth: videoMaxWidth }}
            >
              {ambient && mediaInfo.videoId && (
                <div 
                  className="absolute inset-0 pointer-events-none scale-[1.15] sm:scale-105 z-[-1] transition-opacity duration-1000"
                  style={{
                    backgroundImage: `url('https://img.youtube.com/vi/${mediaInfo.videoId}/maxresdefault.jpg')`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(50px) saturate(150%)',
                    opacity: 0.6
                  }}
                />
              )}
              <YouTubePlayer 
                key={`${mediaInfo.videoId}-${mediaInfo.playlistId}-${reloadKey}`}
                videoId={mediaInfo.videoId} 
                playlistId={mediaInfo.playlistId} 
                startSeconds={startSeconds}
                onVideoChange={handleVideoChange} 
                onProgress={handleProgress}
                isActive={isActive}
                onPlayRelated={(vidId) => loadMedia(vidId, null)}
              />
            </div>
            
            {playlistData && playlistData.videos && (
              <div 
                className="w-full lg:w-[400px] glass rounded-2xl flex flex-col overflow-hidden transition-all duration-500"
                style={{ maxHeight: playerMaxHeight }}
              >
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                  <h3 className="font-semibold text-zinc-100">Playlist</h3>
                  <p className="text-sm text-zinc-500">{playlistData.currentIndex + 1} / {playlistData.videos.length}</p>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {playlistData.videos.map((vid, idx) => {
                    const richData = playlistMetadata?.videos?.find(v => v.id === vid);
                    return (
                      <button 
                        id={`playlist-item-${idx}`}
                        key={`${vid}-${idx}`} 
                        onClick={() => loadMedia(vid, mediaInfo.playlistId)}
                        className={`w-full flex gap-3 p-2 rounded-xl transition-colors text-left hover:bg-zinc-800/80 ${idx === playlistData.currentIndex ? 'bg-zinc-800 border border-zinc-700 shadow-md' : 'border border-transparent'}`}
                      >
                        <div className="w-24 h-14 bg-zinc-800 rounded relative flex-shrink-0 overflow-hidden shadow-sm">
                          <img src={richData?.thumbnail || `https://img.youtube.com/vi/${vid}/default.jpg`} className="w-full h-full object-cover transition-opacity duration-300" alt="" />
                          {idx === playlistData.currentIndex && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <Play size={16} className="text-brand-500" fill="currentColor" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <p className={`text-sm line-clamp-2 leading-snug ${idx === playlistData.currentIndex ? 'text-zinc-100 font-medium' : 'text-zinc-400'}`}>
                            {richData?.title || (idx === playlistData.currentIndex ? (currentVideoIdRef.current === vid ? "Currently Playing" : `Video ${idx + 1}`) : `Video ${idx + 1}`)}
                          </p>
                          {richData?.author && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                onChannelClick?.(richData.author);
                              }}
                              className="text-xs text-zinc-500 mt-1 truncate hover:text-brand-400 transition-colors text-left"
                            >
                              {richData.author}
                            </button>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {isSearching ? (
              <div 
                key="searching-state"
                className="w-full mx-auto aspect-video glass rounded-3xl flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800/80 shadow-2xl transition-all duration-500"
                style={{ maxWidth: videoMaxWidth, maxHeight: playerMaxHeight }}
              >
                <Loader2 className="w-10 h-10 animate-spin text-brand-500 mb-4" />
                <p className="text-zinc-400 animate-pulse">Searching...</p>
              </div>
            ) : searchError ? (
              <div 
                key="search-error-state"
                className="w-full mx-auto aspect-video glass rounded-3xl flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800/80 shadow-2xl transition-all duration-500"
                style={{ maxWidth: videoMaxWidth, maxHeight: playerMaxHeight }}
              >
                <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 text-red-500">
                  <Search size={28} />
                </div>
                <p className="text-zinc-300 font-medium">Could not fetch search results.</p>
                <p className="text-zinc-500 text-sm mt-1">Please try again later.</p>
              </div>
            ) : searchResults ? (
              <div 
                key="search-results-state"
                className="w-full mx-auto h-full glass rounded-3xl bg-zinc-900/30 border border-zinc-800/80 shadow-2xl overflow-y-auto custom-scrollbar p-4 sm:p-6"
                style={{ maxWidth: videoMaxWidth, maxHeight: playerMaxHeight }}
              >
                <h3 className="text-xl font-semibold text-zinc-100 mb-6 px-2">Search Results</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.map((vid, idx) => {
                    const isPlaylist = vid.type === 'playlist';
                    return (
                      <button 
                        key={`${vid.id}-${idx}`}
                        onClick={() => {
                          if (isPlaylist) {
                            loadMedia(null, vid.id);
                          } else {
                            loadMedia(vid.id, null);
                          }
                        }}
                        className="flex flex-col text-left group hover:bg-zinc-800/50 p-2 rounded-xl transition-colors"
                      >
                        <div className="w-full aspect-video bg-zinc-800 rounded-lg relative overflow-hidden mb-3 shadow-md group-hover:shadow-lg transition-all">
                          <ThumbnailImage 
                            src={`https://img.youtube.com/vi/${isPlaylist && vid.thumbnail.includes('/vi/') ? vid.thumbnail.split('/vi/')[1].split('/')[0] : vid.id}/maxresdefault.jpg`} 
                            videoId={isPlaylist && vid.thumbnail.includes('/vi/') ? vid.thumbnail.split('/vi/')[1].split('/')[0] : vid.id}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
                            alt="" 
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            {isPlaylist ? (
                              <ListVideo size={32} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                            ) : (
                              <Play size={32} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" fill="currentColor" />
                            )}
                          </div>
                          {isPlaylist ? (
                            <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1.5 shadow-sm border border-white/10">
                              <ListVideo size={12} />
                              <span>{vid.videoCount}</span>
                            </div>
                          ) : vid.lengthSeconds ? (
                            <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm border border-white/10">
                              {formatDuration(vid.lengthSeconds)}
                            </div>
                          ) : null}
                        </div>
                        <h4 className="font-medium text-zinc-100 line-clamp-2 leading-snug mb-1 group-hover:text-brand-500 transition-colors">{vid.title}</h4>
                        <p className="text-sm text-zinc-400 mt-1 line-clamp-1">{vid.author}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : isFeedLoading ? (
              <div key="loading-spinner" className="w-full flex items-center justify-center min-h-[400px]">
                <Loader2 size={32} className="text-zinc-500 animate-spin" />
              </div>
            ) : recommMode === 'off' ? (
              <div 
                key="home-feed-disabled-state"
                className="w-full flex-1 flex flex-col items-center justify-center animate-fade-in"
                style={{ minHeight: '40vh' }}
              >
                <div className="w-16 h-16 bg-zinc-900/50 rounded-full flex items-center justify-center mb-4 text-zinc-600">
                  <LayoutGrid size={28} />
                </div>
                <h3 className="text-xl font-medium text-zinc-400 mb-2">Recommendations Disabled</h3>
                <p className="text-zinc-600 text-sm max-w-sm text-center">Your home feed is hidden. Use the search bar above to find a video or paste a URL to start watching.</p>
              </div>
            ) : homeFeed && homeFeed.length > 0 ? (
              <div key="feed-container" id="home-feed-container" className="w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-10 pr-2">
                <h3 className="text-xl font-bold text-zinc-100 mb-6 px-2">Recommended for you</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
                  {homeFeed.map((vid, idx) => (
                    <button
                      key={`home-${vid.id}-${idx}`}
                      onClick={() => loadMedia(vid.id)}
                      className={`group text-left flex flex-col focus:outline-none ${!disableFeedAnims ? 'animate-card-pop' : ''}`}
                      style={{ animationDelay: `${idx * 40}ms` }}
                    >
                      <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-3 bg-zinc-800">
                        <ThumbnailImage 
                          src={`https://img.youtube.com/vi/${vid.id}/maxresdefault.jpg`}
                          videoId={vid.id}
                          alt={vid.title}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                          <Play size={40} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-lg" fill="currentColor" />
                        </div>
                        {vid.lengthSeconds ? (
                          <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm border border-white/10">
                            {formatDuration(vid.lengthSeconds)}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex gap-3 px-1">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-zinc-100 text-sm lg:text-base line-clamp-2 leading-snug mb-1 group-hover:text-brand-500 transition-colors">{vid.title}</h4>
                          <p className="text-xs lg:text-sm text-zinc-400 line-clamp-1">{vid.author}</p>
                          {vid.viewCount && (
                            <p className="text-xs text-zinc-500 mt-0.5">{formatViews(vid.viewCount)} views</p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div 
                key="ready-state"
                className="w-full mx-auto min-h-[400px] lg:min-h-0 lg:aspect-video glass rounded-3xl flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800/80 shadow-2xl transition-all duration-500"
                style={{ maxWidth: videoMaxWidth, maxHeight: playerMaxHeight }}
              >
                <div className="w-20 h-20 bg-zinc-800/80 rounded-full flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/5">
                  <Play size={32} className="text-zinc-400 ml-1" fill="currentColor" />
                </div>
                <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">Ready to watch</h2>
                <p className="text-zinc-400 mt-3 max-w-md text-center leading-relaxed">Paste a YouTube video or playlist link above for an ad-free, sponsor-skipped, and private playback experience.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
