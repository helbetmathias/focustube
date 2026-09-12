import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Link as LinkIcon, Loader2, Search, ListVideo, ArrowLeft, LayoutGrid } from 'lucide-react';
import YouTubePlayer from '../components/YouTubePlayer';
import { parseYouTubeUrl } from '../utils/youtube';
import { blendRecommendationSources, buildBalancedCreatorFeed, getCompactTargetFeedSize, getContinueWatchingItems, getHomeFeedPoolSize, getHomeHistoryContext, getTargetFeedSize } from '../utils/feed';
import { getInitialSearchResultCount, prepareSearchResults } from '../utils/search';
import { fetchPlaylistDetails, fetchSearchResults, fetchRelatedVideos } from '../services/youtubeApi';
import { getHistory, saveHistory, getHomeBlendCache, saveHomeBlendCache, saveHomeReserveCache } from '../services/storage';

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

const COMPACT_LAPTOP_QUERY = '(min-width: 1024px) and (max-width: 1279px)';

const getCompactLaptopMatch = () => (
  typeof window !== 'undefined' && window.matchMedia(COMPACT_LAPTOP_QUERY).matches
);

const SearchResultCard = ({ vid, onSelect, formatDuration, className = '' }) => {
  const isPlaylist = vid.type === 'playlist';
  const thumbnailVideoId = isPlaylist && vid.thumbnail.includes('/vi/')
    ? vid.thumbnail.split('/vi/')[1].split('/')[0]
    : vid.id;

  return (
    <button
      onClick={() => onSelect(vid)}
      className={`flex flex-col text-left group hover:bg-zinc-800/50 p-2 rounded-xl transition-colors ${className}`}
    >
      <div className="w-full aspect-video bg-zinc-800 rounded-lg relative overflow-hidden mb-3 shadow-md">
        <div className="w-full h-full transform-gpu transition-transform duration-500 ease-out group-hover:scale-105 [will-change:transform] motion-reduce:transform-none">
          <ThumbnailImage
            src={`https://img.youtube.com/vi/${thumbnailVideoId}/maxresdefault.jpg`}
            videoId={thumbnailVideoId}
            className="w-full h-full object-cover"
            alt=""
          />
        </div>
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
};

export default function PlayerView({ isActive, playRequest, onChannelClick }) {
  const [url, setUrl] = useState('');
  const [mediaInfo, setMediaInfo] = useState({ videoId: null, playlistId: null });
  const [playlistStartIndex, setPlaylistStartIndex] = useState(0);
  const [startSeconds, setStartSeconds] = useState(0);
  const [playlistData, setPlaylistData] = useState(null);
  const [playlistMetadata, setPlaylistMetadata] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [ambient, setAmbient] = useState(false);
  const [recommMode, setRecommMode] = useState(() => localStorage.getItem('puretube_recomm') || 'all');
  const [continueWatchingEnabled, setContinueWatchingEnabled] = useState(() => localStorage.getItem('puretube_continue_watching') !== 'false');
  const [continueWatching, setContinueWatching] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [showAllSearchResults, setShowAllSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [homeFeed, setHomeFeed] = useState(null);
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [disableFeedAnims, setDisableFeedAnims] = useState(false);
  const [isFeedLoading, setIsFeedLoading] = useState(true);
  const [homeCreatorCount, setHomeCreatorCount] = useState(0);
  const [isCompactLaptop, setIsCompactLaptop] = useState(getCompactLaptopMatch);
  const currentVideoIdRef = useRef(null);
  const activePlaylistIdRef = useRef(null);
  const activePlaylistIndexRef = useRef(-1);
  const loadMediaRequestIdRef = useRef(0);
  const homeFeedRequestIdRef = useRef(0);
  const historyWriteQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_LAPTOP_QUERY);
    const updateLayout = (event) => setIsCompactLaptop(event.matches);
    setIsCompactLaptop(mediaQuery.matches);
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

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
      setContinueWatchingEnabled(localStorage.getItem('puretube_continue_watching') !== 'false');
    };
    readSettings();
    window.addEventListener('puretube_settings_updated', readSettings);
    return () => window.removeEventListener('puretube_settings_updated', readSettings);
  }, []);

  const loadContinueWatching = useCallback(async () => {
    if (!continueWatchingEnabled) {
      setContinueWatching([]);
      return;
    }

    try {
      const history = await getHistory();
      setContinueWatching(getContinueWatchingItems(history));
    } catch {
      setContinueWatching([]);
    }
  }, [continueWatchingEnabled]);

  useEffect(() => {
    loadContinueWatching();
    window.addEventListener('puretube_history_updated', loadContinueWatching);
    return () => window.removeEventListener('puretube_history_updated', loadContinueWatching);
  }, [loadContinueWatching]);

  // Load Home Feed
  const loadHomeFeed = useCallback(async (forceRefresh = false) => {
    const requestId = ++homeFeedRequestIdRef.current;

    if (recommMode === 'off') {
        setIsFeedLoading(false);
        return;
    }
    setIsFeedLoading(true);
    
    try {
      const history = await getHistory();
      if (!history || history.length === 0) {
        setHomeCreatorCount(0);
        setIsFeedLoading(false);
        return;
      }

      const { creators, newestSeed, signature } = getHomeHistoryContext(history);
      setHomeCreatorCount(creators.length);
      if (creators.length === 0) {
        setIsFeedLoading(false);
        return;
      }

      const historyIds = new Set(history.map(item => item.id));
      const enrichWithRealRecommendations = (baseFeed, excludedIds = new Set()) => {
        if (!newestSeed?.id || !Array.isArray(baseFeed) || baseFeed.length === 0) return;

        const baseIds = new Set(baseFeed.map(video => video.id));
        fetchRelatedVideos(newestSeed.id)
          .then(realResults => {
            if (requestId !== homeFeedRequestIdRef.current || !Array.isArray(realResults)) return;

            const realIds = new Set();
            const realFeed = realResults.filter(video => {
              if (
                video.type !== 'video'
                || historyIds.has(video.id)
                || baseIds.has(video.id)
                || excludedIds.has(video.id)
                || realIds.has(video.id)
              ) return false;
              realIds.add(video.id);
              return true;
            });

            if (realFeed.length === 0) return;

            const finalFeed = blendRecommendationSources(baseFeed, realFeed);
            setHomeFeed(finalFeed);
            saveHomeBlendCache(finalFeed, signature);
          })
          .catch(() => {
            // The creator-search feed remains visible while real recommendations are unavailable.
          });
      };

      if (!forceRefresh) {
        const cache = await getHomeBlendCache();
        const poolTarget = getHomeFeedPoolSize(creators.length);
        if (
          cache?.historySignature === signature
          && Array.isArray(cache.feed)
          && cache.feed.length >= poolTarget
        ) {
          setHomeFeed(cache.feed);
          setIsFeedLoading(false);
          enrichWithRealRecommendations(cache.feed, new Set(cache.feed.map(video => video.id)));
          return;
        }
      }

      // Keep enough cards ready for both four-column desktops and three-column laptops.
      const numAuthors = creators.length;
      const targetFeedSize = getHomeFeedPoolSize(numAuthors);
      const videosPerAuthor = Math.ceil(targetFeedSize / numAuthors);

      // Phase 1: fetch creator searches together and render them immediately.
      const authorResults = await Promise.allSettled(
        creators.map(author => fetchSearchResults(author, true))
      );

      const authorVideos = authorResults.map((result, index) => {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) {
          console.warn("Home feed search failed for", creators[index]);
          return [];
        }

        const seenInThisAuthor = new Set();
        return result.value
          .filter(video => {
            if (video.type !== 'video' || historyIds.has(video.id) || seenInThisAuthor.has(video.id)) return false;
            seenInThisAuthor.add(video.id);
            return true;
          })
          .slice(0, videosPerAuthor);
      });

      // Keep a complete four-card pool; the visible feed is sliced responsively below.
      const { visibleFeed: fastFeed, reserveFeed, creatorIds } = buildBalancedCreatorFeed(authorVideos, targetFeedSize);

      if (requestId !== homeFeedRequestIdRef.current) return;

      saveHomeReserveCache(reserveFeed);

      if (fastFeed.length > 0) {
        setHomeFeed(fastFeed);
        setIsFeedLoading(false);
        saveHomeBlendCache(fastFeed, signature);
      }

      // Phase 2: real recommendations retry on every page load and never block the fast feed.
      enrichWithRealRecommendations(fastFeed, creatorIds);
    } catch (e) {
      console.error("Failed to build history feed", e);
    } finally {
      setIsFeedLoading(false);
    }
  }, [recommMode]);

  useEffect(() => {
    loadHomeFeed();
  }, [loadHomeFeed]);

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
      setShowAllSearchResults(false);
      setUrl('');
      
      loadHomeFeed(false);
    };
    window.addEventListener('focustube_refresh_feed', handleRefresh);
    return () => window.removeEventListener('focustube_refresh_feed', handleRefresh);
  }, [loadHomeFeed]);

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

  const activePlaylistIndex = playlistData?.currentIndex ?? -1;

  // Auto-scroll to active playlist item when the playlist is active
  useEffect(() => {
    if (activePlaylistIndex >= 0 && isActive) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`playlist-item-${activePlaylistIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activePlaylistIndex, isActive]);

  const loadMedia = async (vid, pid, forceStart = false, requestedPlaylistIndex = -1) => {
    const requestId = ++loadMediaRequestIdRef.current;
    let progress = 0;
    let playlistIndex = Number.isInteger(requestedPlaylistIndex) ? requestedPlaylistIndex : -1;

    if (vid) {
      try {
        const history = await getHistory();
        const historyItem = history.find(i => i.id === vid) || null;
        if (!forceStart && historyItem?.progress) progress = historyItem.progress;
        if (pid && playlistIndex < 0 && historyItem?.playlistId === pid && Number.isInteger(historyItem.playlistIndex)) {
          playlistIndex = historyItem.playlistIndex;
        }
      } catch {}
    }

    // Older history entries predate playlistIndex. Resolve the saved video's
    // position once so resuming keeps the YouTube playlist context.
    if (pid && vid && playlistIndex < 0) {
      try {
        const details = await fetchPlaylistDetails(pid);
        if (requestId !== loadMediaRequestIdRef.current) return;
        setPlaylistMetadata(details);
        playlistIndex = details.videos.findIndex(video => video.id === vid);
      } catch {}
    }

    if (requestId !== loadMediaRequestIdRef.current) return;
    const normalizedPlaylistIndex = pid ? Math.max(0, playlistIndex) : -1;
    setStartSeconds(progress);
    setPlaylistStartIndex(Math.max(0, normalizedPlaylistIndex));
    setMediaInfo({ videoId: vid, playlistId: pid });
    activePlaylistIdRef.current = pid || null;
    activePlaylistIndexRef.current = normalizedPlaylistIndex;
    setReloadKey(prev => prev + 1);
    currentVideoIdRef.current = vid;
    if (!pid) {
      setPlaylistData(null);
    }
  };

  useEffect(() => {
    if (playRequest) {
      loadMedia(playRequest.videoId, playRequest.playlistId, playRequest.forceStart);
    }
  }, [playRequest]);

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
      setShowAllSearchResults(false);
      fetchSearchResults(parsed.query)
        .then(results => {
          setSearchResults(prepareSearchResults(results, parsed.query));
          setIsSearching(false);
        })
        .catch(() => {
          setSearchError(true);
          setIsSearching(false);
        });
    }
  };

  const updateHistory = async (id, title, progress, duration, author, playlistIndex = activePlaylistIndexRef.current) => {
    const playlistId = activePlaylistIdRef.current || undefined;

    const writeHistory = async () => {
      try {
        const history = await getHistory();
        const existingItem = history.find(item => item.id === id);
        const updatedHistory = history.filter(item => item.id !== id);

        updatedHistory.unshift({
          ...(existingItem || {}),
          id,
          title: title || existingItem?.title || '',
          author: author || existingItem?.author,
          timestamp: Date.now(),
          type: 'video',
          progress: progress !== undefined ? progress : (existingItem?.progress || 0),
          duration: duration || existingItem?.duration || 0,
          playlistId,
          playlistIndex: playlistId
            ? (Number.isInteger(playlistIndex) && playlistIndex >= 0 ? playlistIndex : existingItem?.playlistIndex)
            : undefined
        });

        await saveHistory(updatedHistory.slice(0, 500));
      } catch (error) {
        console.error('Failed to save history', error);
      }
    };

    historyWriteQueueRef.current = historyWriteQueueRef.current.then(writeHistory, writeHistory);
    return historyWriteQueueRef.current;
  };

  const handleVideoChange = ({ id, title, author, playlist, playlistIndex }) => {
    currentVideoIdRef.current = id;
    if (Number.isInteger(playlistIndex) && playlistIndex >= 0) {
      activePlaylistIndexRef.current = playlistIndex;
    }
    updateHistory(id, title, undefined, undefined, author, playlistIndex);
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
  const playerContainerMaxWidth = (playlistData && playlistData.videos)
    ? `calc(${videoMaxWidth} + 400px + 1.5rem)` 
    : videoMaxWidth;
  const hasActiveMedia = Boolean(mediaInfo.videoId || mediaInfo.playlistId);
  const browseMaxWidth = '110rem';
  const viewMaxWidth = hasActiveMedia ? playerContainerMaxWidth : browseMaxWidth;

  const showBack = searchResults && (mediaInfo.videoId || mediaInfo.playlistId) && (url === lastSearchTerm || url.trim().length === 0);
  const initialSearchResultCount = searchResults ? getInitialSearchResultCount(searchResults.length) : 0;
  const primarySearchResults = searchResults?.slice(0, initialSearchResultCount) || [];
  const extraSearchResults = showAllSearchResults ? searchResults?.slice(initialSearchResultCount) || [] : [];
  const hasExtraSearchResults = Boolean(searchResults && searchResults.length > initialSearchResultCount);
  const continueWatchingItems = isCompactLaptop ? continueWatching.slice(0, 3) : continueWatching;
  const desktopHomeFeedSize = getTargetFeedSize(homeCreatorCount);
  const compactHomeFeedSize = getCompactTargetFeedSize(homeCreatorCount);
  const requestedHomeFeedSize = isCompactLaptop ? compactHomeFeedSize : desktopHomeFeedSize;
  const availableHomeFeedSize = Math.min(requestedHomeFeedSize, homeFeed?.length || 0);
  const completeHomeFeedSize = isCompactLaptop
    ? Math.floor(availableHomeFeedSize / 3) * 3
    : availableHomeFeedSize;
  const visibleHomeFeed = homeFeed?.slice(0, completeHomeFeedSize) || [];
  const selectSearchResult = (result) => {
    if (result.type === 'playlist') loadMedia(null, result.id);
    else loadMedia(result.id, null);
  };

  return (
    <div className={`flex-1 min-h-0 w-full flex flex-col justify-start lg:justify-center gap-4 sm:gap-6 ${searchResults && !mediaInfo.videoId ? 'animate-page-fade' : ''}`}>
      <div className="flex-none w-full mx-auto transition-all duration-500" style={{ maxWidth: viewMaxWidth }}>
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
                    loadMedia(null, null);
                    setPlaylistMetadata(null);
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

      <div className="flex-1 min-h-0 w-full mx-auto flex flex-col lg:flex-row gap-4 sm:gap-6 lg:justify-center transition-all duration-500" style={{ maxWidth: viewMaxWidth }}>
        {mediaInfo.videoId || mediaInfo.playlistId ? (
          <>
            <div 
              className="w-full min-w-0 lg:flex-1 flex flex-col relative aspect-video transition-all duration-500 z-10"
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
                playlistIndex={playlistStartIndex}
                startSeconds={startSeconds}
                onVideoChange={handleVideoChange} 
                onProgress={handleProgress}
                isActive={isActive}
                onPlayRelated={(vidId) => loadMedia(vidId, null)}
              />
            </div>
            
            {playlistData && playlistData.videos && (
              <div 
                className="w-full lg:w-[clamp(300px,22vw,400px)] lg:flex-none lg:shrink-0 glass rounded-2xl flex flex-col overflow-hidden transition-all duration-500"
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
                        onClick={() => loadMedia(vid, mediaInfo.playlistId, false, idx)}
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
                            {richData?.title || (idx === playlistData.currentIndex ? (mediaInfo.videoId === vid ? "Currently Playing" : `Video ${idx + 1}`) : `Video ${idx + 1}`)}
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
                style={{ maxWidth: browseMaxWidth, maxHeight: playerMaxHeight }}
              >
                <Loader2 className="w-10 h-10 animate-spin text-brand-500 mb-4" />
                <p className="text-zinc-400 animate-pulse">Searching...</p>
              </div>
            ) : searchError ? (
              <div 
                key="search-error-state"
                className="w-full mx-auto aspect-video glass rounded-3xl flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800/80 shadow-2xl transition-all duration-500"
                style={{ maxWidth: browseMaxWidth, maxHeight: playerMaxHeight }}
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
                style={{ maxWidth: browseMaxWidth, maxHeight: playerMaxHeight }}
              >
                <h3 className="text-xl font-semibold text-zinc-100 mb-6 px-2">Search Results</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {primarySearchResults.map(vid => (
                    <SearchResultCard key={`${vid.type}:${vid.id}`} vid={vid} onSelect={selectSearchResult} formatDuration={formatDuration} />
                  ))}
                </div>
                {hasExtraSearchResults && !showAllSearchResults && (
                  <div className="flex justify-center mt-6">
                    <button
                      type="button"
                      onClick={() => setShowAllSearchResults(true)}
                      className="px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-sm font-semibold text-zinc-100 transition-colors"
                    >
                      Show more ({searchResults.length - initialSearchResultCount})
                    </button>
                  </div>
                )}
                {extraSearchResults.length > 0 && (
                  <>
                    <div className="flex flex-wrap justify-center gap-4 mt-4">
                      {extraSearchResults.map(vid => (
                        <SearchResultCard
                          key={`${vid.type}:${vid.id}`}
                          vid={vid}
                          onSelect={selectSearchResult}
                          formatDuration={formatDuration}
                          className="w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.7rem)]"
                        />
                      ))}
                    </div>
                    <div className="flex justify-center mt-6">
                      <button
                        type="button"
                        onClick={() => setShowAllSearchResults(false)}
                        className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-sm font-medium text-zinc-300 transition-colors"
                      >
                        Show less
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div key="home-content" id="home-feed-container" className="w-full flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-10 pr-2">
                {continueWatchingEnabled && continueWatching.length > 0 && (
                  <section className="mb-8">
                    <h3 className="text-xl font-bold text-zinc-100 mb-6 px-2">Continue Watching</h3>
                    <div className="flex lg:flex-wrap lg:justify-center gap-4 lg:gap-6 overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {continueWatchingItems.map((item, idx) => {
                        const progressPercent = Math.min(100, Math.max(0, (item.progress / item.duration) * 100));

                        return (
                          <button
                            key={`continue-${item.id}`}
                            onClick={() => loadMedia(item.id, item.playlistId, false, item.playlistIndex)}
                            className={`group text-left flex-none w-[82%] sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-1rem)] xl:w-[calc(25%-1.125rem)] flex flex-col focus:outline-none snap-start ${!disableFeedAnims ? 'animate-card-pop' : ''}`}
                            style={{ animationDelay: `${idx * 40}ms` }}
                          >
                            <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-3 bg-zinc-800">
                              <ThumbnailImage
                                src={`https://img.youtube.com/vi/${item.id}/maxresdefault.jpg`}
                                videoId={item.id}
                                alt={item.title || 'Continue watching video'}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                                <Play size={40} className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-lg" fill="currentColor" />
                              </div>
                              <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm border border-white/10">
                                {formatDuration(Math.floor(item.duration))}
                              </div>
                              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25">
                                <div className="h-full bg-brand-500" style={{ width: `${progressPercent}%` }} />
                              </div>
                            </div>
                            <div className="px-1 min-w-0">
                              <h4 className="font-medium text-zinc-100 text-sm lg:text-base line-clamp-2 leading-snug mb-1 group-hover:text-brand-500 transition-colors">
                                {item.title || `Video ID: ${item.id}`}
                              </h4>
                              {item.author && <p className="text-xs lg:text-sm text-zinc-400 line-clamp-1">{item.author}</p>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {isFeedLoading ? (
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
                ) : visibleHomeFeed.length > 0 ? (
                  <section>
                    <h3 className="text-xl font-bold text-zinc-100 mb-6 px-2">Recommended for you</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
                      {visibleHomeFeed.map((vid, idx) => (
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
                  </section>
                ) : (
                  <div
                    key="ready-state"
                    className="w-full mx-auto min-h-[400px] lg:min-h-0 lg:aspect-video glass rounded-3xl flex flex-col items-center justify-center bg-zinc-900/30 border border-zinc-800/80 shadow-2xl transition-all duration-500"
                    style={{ maxWidth: '80rem', maxHeight: playerMaxHeight }}
                  >
                    <div className="w-20 h-20 bg-zinc-800/80 rounded-full flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/5">
                      <Play size={32} className="text-zinc-400 ml-1" fill="currentColor" />
                    </div>
                    <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">Ready to watch</h2>
                    <p className="text-zinc-400 mt-3 max-w-md text-center leading-relaxed">Paste a YouTube video or playlist link above for an ad-free, sponsor-skipped, and private playback experience.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
