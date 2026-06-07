import { useEffect, useRef, useState, useCallback } from 'react';
import { Maximize, Minimize, SkipForward, Info, Star, RotateCcw, Play } from 'lucide-react';
import { fetchSkipSegments } from '../utils/sponsorblock';
import { fetchRelatedVideos, fetchAuthorFallback } from '../services/youtubeApi';
import { getTimeSaved, saveTimeSaved, getFeedCache, saveFeedCache } from '../services/storage';

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
    // Check immediately in case the image was loaded synchronously from cache
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

const CATEGORY_COLORS = {
  sponsor: 'bg-green-500',
  intro: 'bg-cyan-500',
  outro: 'bg-purple-500',
  interaction: 'bg-pink-500',
  selfpromo: 'bg-yellow-500',
  music_offtopic: 'bg-blue-500',
  poi_highlight: 'bg-yellow-400',
};

const DEFAULT_SETTINGS = {
  sponsor: 'auto',
  intro: 'auto',
  outro: 'auto',
  interaction: 'auto',
  selfpromo: 'auto',
  music_offtopic: 'ignore',
  poi_highlight: 'manual',
};

const getInitialSettings = () => {
  try {
    const stored = localStorage.getItem('sponsorblock_categories');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    }
  } catch(e) {}
  return DEFAULT_SETTINGS;
};

const getInitialNotifications = () => {
  const notifs = localStorage.getItem('puretube_notifications');
  return notifs !== null ? notifs === 'true' : true;
};

export default function YouTubePlayer({ videoId, playlistId, startSeconds, onVideoChange, onProgress, isActive, onPlayRelated }) {
  // Device detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const wrapperRef = useRef(null);
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const idleTimeoutRef = useRef(null);
  
  const [segments, setSegments] = useState([]);
  const [settings, setSettings] = useState(getInitialSettings);
  const [showNotifications, setShowNotifications] = useState(getInitialNotifications);
  const [recommMode, setRecommMode] = useState(() => localStorage.getItem('puretube_recomm') || 'all');
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  
  const [manualSkip, setManualSkip] = useState(null);
  const [highlightSegment, setHighlightSegment] = useState(null);
  const [hideHighlight, setHideHighlight] = useState(false);
  const [toasts, setToasts] = useState([]);
  
  // Related Videos Overlay State
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayType, setOverlayType] = useState('paused');
  const [relatedVideos, setRelatedVideos] = useState(null);
  const [isFetchingRelated, setIsFetchingRelated] = useState(false);
  const [relatedError, setRelatedError] = useState(false);

  // Ensure settings are always fresh, even if the component wasn't unmounted
  useEffect(() => {
    const handleSettingsUpdate = () => {
      setSettings(getInitialSettings());
      const r = localStorage.getItem('puretube_recomm');
      setRecommMode(r ? r : 'all');
    };
    window.addEventListener('puretube_settings_updated', handleSettingsUpdate);
    window.addEventListener('storage', handleSettingsUpdate);
    return () => {
      window.removeEventListener('puretube_settings_updated', handleSettingsUpdate);
      window.removeEventListener('storage', handleSettingsUpdate);
    };
  }, []);

  // Idle Timer Logic with Coordinate Check (Ignores fake mousemoves from DOM updates)
  const lastMousePos = useRef({ x: -1, y: -1 });

  const handleMouseMove = useCallback((e) => {
    // Only reset if the mouse actually changed physical coordinates
    if (e.clientX === lastMousePos.current.x && e.clientY === lastMousePos.current.y) {
      return;
    }
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    setIsIdle(false);
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      setIsIdle(false);
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = setTimeout(() => setIsIdle(true), 3000);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Pause video when navigating away
  useEffect(() => {
    if (!isActive && playerRef.current && playerRef.current.getPlayerState) {
      if (playerRef.current.getPlayerState() === window.YT.PlayerState.PLAYING) {
        playerRef.current.pauseVideo();
      }
    }
  }, [isActive]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && wrapperRef.current) {
      wrapperRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  const addToast = useCallback((message) => {
    if (!showNotifications) return;
    const id = Date.now();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, [showNotifications]);

  const trackTimeSaved = async (secondsSkipped) => {
    try {
      const current = await getTimeSaved();
      await saveTimeSaved(current + secondsSkipped);
    } catch (e) {}
  };

  const executeSkip = useCallback((segment) => {
    if (playerRef.current) {
      playerRef.current.seekTo(segment.segment[1], true);
      setCurrentTime(segment.segment[1]); // Instantly update progress bar
      const skippedAmount = segment.segment[1] - segment.segment[0];
      trackTimeSaved(skippedAmount);
      addToast(`Skipped ${segment.category} (${Math.round(skippedAmount)}s)`);
      setManualSkip(null);
      if (segment.category === 'Highlight') setHideHighlight(true);
    }
  }, [addToast]);

  const latestProps = useRef({ videoId, playlistId, settings, onVideoChange });
  useEffect(() => {
    latestProps.current = { videoId, playlistId, settings, onVideoChange };
  }, [videoId, playlistId, settings, onVideoChange]);

  useEffect(() => {
    if (!videoId && !playlistId) return;

    setHideHighlight(false);
    setShowOverlay(false);
    setOverlayType('paused');
    setRelatedVideos(null);
    setRelatedError(false);

    const loadSegments = async (vId) => {
      const data = await fetchSkipSegments(vId);
      const activeSegments = data.filter(seg => (latestProps.current.settings[seg.category] || 'auto') !== 'ignore');
      setSegments(activeSegments);
      
      const highlight = activeSegments.find(seg => seg.category === 'poi_highlight');
      setHighlightSegment(highlight || null);
    };

    if (videoId) loadSegments(videoId);

    const loadPlayer = () => {
      // If playerRef.current is already set (even if it's still initializing and doesn't have loadVideoById yet), 
      // do NOT create a new one to prevent breaking the iframe in React Strict Mode.
      if (playerRef.current) {
        if (playerRef.current.loadVideoById) {
          if (playlistId) {
            playerRef.current.loadPlaylist({ list: playlistId, listType: 'playlist', index: 0, startSeconds: startSeconds || 0 });
          } else if (videoId) {
            playerRef.current.loadVideoById({ videoId: videoId, startSeconds: startSeconds || 0 });
          }
        }
        return;
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        ...(videoId ? { videoId: videoId } : {}),
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          listType: playlistId ? 'playlist' : undefined,
          list: playlistId,
          autoplay: 1,
          modestbranding: 1,
          rel: 0,
          fs: isMobile ? 1 : 0,
          start: startSeconds !== undefined && startSeconds !== null ? Math.floor(startSeconds) : 0,
        },
        events: {
          onReady: (e) => {
            setDuration(e.target.getDuration());
            if (startSeconds !== undefined && startSeconds !== null) {
              e.target.seekTo(startSeconds, true);
            }
          },
          onStateChange: (e) => {
            const triggerRelatedFetch = (currentVideoData) => {
              if (!currentVideoData || !currentVideoData.video_id) return;
              
              if (!window._fetchingRelatedFor || window._fetchingRelatedFor !== currentVideoData.video_id) {
                window._fetchingRelatedFor = currentVideoData.video_id;
                window._relatedErrorFor = null;
                
                // Reset state if we are fetching for a new video
                setRelatedVideos(prev => {
                  if (prev === null) return prev;
                  return null;
                });
                
                setIsFetchingRelated(true);
                setRelatedError(false);
                
                fetchRelatedVideos(currentVideoData.video_id)
                  .then(videos => {
                    setRelatedVideos(videos);
                    setIsFetchingRelated(false);
                    getFeedCache().then(existing => {
                      const prevCache = existing || [];
                      const newIds = new Set(videos.map(v => v.id));
                      const keepPrev = prevCache.filter(v => !newIds.has(v.id)).slice(0, 10);
                      const newSample = videos.slice(0, 10);
                      const combined = [...newSample, ...keepPrev].sort(() => 0.5 - Math.random());
                      saveFeedCache(combined);
                    });
                  })
                  .catch(() => {
                    // Fail silently in the background, mark it for fallback when paused
                    window._relatedErrorFor = currentVideoData.video_id;
                  });
              }
            };

            if (e.data === window.YT.PlayerState.PLAYING) {
              setShowOverlay(false);
              setDuration(playerRef.current.getDuration());
              
              const currentVideoData = playerRef.current.getVideoData();
              if (currentVideoData && currentVideoData.video_id) {
                const currentId = currentVideoData.video_id;
                
                // Aggressively prefetch related videos in the background
                triggerRelatedFetch(currentVideoData);
                
                let playlist = null;
                let playlistIndex = -1;
                if (playerRef.current.getPlaylist) {
                  playlist = playerRef.current.getPlaylist();
                  playlistIndex = playerRef.current.getPlaylistIndex();
                }

                latestProps.current.onVideoChange?.({ 
                  id: currentId, 
                  title: currentVideoData.title,
                  author: currentVideoData.author,
                  playlist,
                  playlistIndex
                });
                
                if (latestProps.current.playlistId) {
                  // Re-fetch segments for the new playlist video
                  fetchSkipSegments(currentId).then(data => {
                    const activeSegments = data.filter(seg => (latestProps.current.settings[seg.category] || 'auto') !== 'ignore');
                    setSegments(activeSegments);
                    const highlight = activeSegments.find(seg => seg.category === 'poi_highlight');
                    setHighlightSegment(highlight || null);
                  });
                }
              }
            } else if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) {
              setOverlayType(e.data === window.YT.PlayerState.ENDED ? 'ended' : 'paused');
              setShowOverlay(recommMode === 'all');
              
              const currentVideoData = playerRef.current.getVideoData();
              if (currentVideoData && currentVideoData.video_id) {
                if (window._relatedErrorFor === currentVideoData.video_id) {
                  // Background fetch failed, execute fallback now that user paused!
                  window._relatedErrorFor = null; // Prevent infinite retries on pause
                  
                  setIsFetchingRelated(true);
                  setRelatedError(false);
                  
                  fetchAuthorFallback(currentVideoData.author, currentVideoData.video_id)
                    .then(videos => {
                      setRelatedVideos(videos);
                      setIsFetchingRelated(false);
                      getFeedCache().then(existing => {
                        const prevCache = existing || [];
                        const newIds = new Set(videos.map(v => v.id));
                        const keepPrev = prevCache.filter(v => !newIds.has(v.id)).slice(0, 10);
                        const newSample = videos.slice(0, 10);
                        const combined = [...newSample, ...keepPrev].sort(() => 0.5 - Math.random());
                        saveFeedCache(combined);
                      });
                    })
                    .catch(() => {
                      setRelatedError(true);
                      setIsFetchingRelated(false);
                    });
                } else if (!window._fetchingRelatedFor) {
                  // Fallback safety net if play event was missed somehow
                  triggerRelatedFetch(currentVideoData);
                }
              }
            }
          }
        }
      });
    };

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      window.onYouTubeIframeAPIReady = loadPlayer;
    } else {
      loadPlayer();
    }

    // Do NOT destroy the player on cleanup! We want to reuse it.
  }, [videoId, playlistId, recommMode]); 

  // Highlight 10s Timeout
  useEffect(() => {
    if (highlightSegment && duration > 0) {
      const timer = setTimeout(() => {
        setHideHighlight(true);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [highlightSegment, duration]);

  // Polling for SponsorBlock skips and progress
  useEffect(() => {
    const interval = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime && playerRef.current.getPlayerState) {
        
        // Always update the progress bar and duration, even if paused or buffering
        const cTime = playerRef.current.getCurrentTime();
        setCurrentTime(cTime);
        
        const currentDuration = playerRef.current.getDuration();
        setDuration(prev => (currentDuration > 0 && currentDuration !== prev) ? currentDuration : prev);

        if (playerRef.current.getPlayerState() === window.YT.PlayerState.PLAYING) {
          
          if (onProgress && Math.floor(cTime) % 5 === 0) {
            onProgress(cTime, playerRef.current.getDuration());
          }

          let activeManual = null;

          if (segments && segments.length > 0) {
            for (const seg of segments) {
              const [start, end] = seg.segment;
              if (cTime >= start && cTime < end) {
                const action = settings[seg.category] || 'auto';
                
                if (action === 'auto') {
                  if (cTime - start < 2) {
                     executeSkip(seg);
                     break;
                  }
                } else if (action === 'manual') {
                  activeManual = seg;
                }
              }
            }
          }
          
          setManualSkip(activeManual);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [segments, settings, onProgress, executeSkip]);

  const isUiHidden = isFullscreen && isIdle;

  return (
    <div 
      ref={wrapperRef}
      className={`w-full h-full relative overflow-hidden bg-black ${isFullscreen ? '' : 'rounded-2xl shadow-2xl border border-zinc-800'}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setIsIdle(true)}
    >
      <div 
        ref={containerRef} 
        className={`w-full h-full transition-opacity duration-300 ${showOverlay ? 'opacity-20' : 'opacity-100'}`} 
      />
      
      {/* Custom Related Videos Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 z-[80]">
          {/* Static Action Button (Immune to scrolling) */}
          <button 
            onClick={() => playerRef.current?.playVideo()} 
            className="absolute top-4 sm:top-6 right-4 sm:right-6 z-[90] group flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 border border-white/10 shadow-xl"
            title={overlayType === 'ended' ? "Replay" : "Resume"}
          >
            {overlayType === 'ended' ? (
              <RotateCcw className="w-5 h-5 sm:w-5 sm:h-5 text-white/90 group-hover:text-white transition-all group-hover:-rotate-180 duration-500 ease-out" />
            ) : (
              <Play className="w-5 h-5 sm:w-5 sm:h-5 text-white/90 group-hover:text-white transition-colors ml-0.5" fill="currentColor" />
            )}
          </button>

          {/* Scrollable Content Layer */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md overflow-y-auto custom-scrollbar transform-gpu">
            <div className="flex flex-col items-center justify-center min-h-full p-4 sm:p-6 sm:py-12">
            
            {isFetchingRelated ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400">
                <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="font-medium tracking-wide animate-pulse">Loading recommendations...</p>
              </div>
            ) : relatedError ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-400">
                <p className="font-medium">Could not load recommendations.</p>
                <button 
                  onClick={() => playerRef.current?.playVideo()} 
                  className="bg-brand-500 hover:bg-brand-400 px-6 py-2.5 rounded-full font-bold text-white transition-all duration-300 ease-out shadow-lg hover:shadow-xl hover:scale-[1.03] active:scale-[0.97]"
                >
                  {overlayType === 'ended' ? 'Replay Video' : 'Resume Video'}
                </button>
              </div>
            ) : relatedVideos && relatedVideos.length > 0 ? (
              <div className={`w-full max-w-6xl mx-auto transition-all duration-500 ${isFullscreen ? 'max-w-[85vw]' : ''}`}>
                <h3 className={`font-bold text-white text-center tracking-tight transition-all duration-500 ${isFullscreen ? 'text-2xl sm:text-3xl mb-4 sm:mb-8' : 'text-sm sm:text-2xl mb-2 sm:mb-6'}`}>Explore Further</h3>
                <div className={`flex sm:grid overflow-x-auto sm:overflow-x-visible snap-x snap-mandatory sm:snap-none pb-4 sm:pb-0 px-4 sm:px-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 transition-all duration-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${isFullscreen ? 'gap-6 sm:gap-8' : 'gap-3 sm:gap-6'}`}>
                {relatedVideos.slice(0, 12).map((vid, idx) => (
                  <button 
                    key={`${vid.id}-${idx}`}
                    onClick={() => {
                      setShowOverlay(false);
                      onPlayRelated?.(vid.id);
                    }}
                    className="min-w-[160px] max-w-[160px] sm:min-w-0 sm:max-w-none shrink-0 snap-start group text-left flex flex-col gap-2 sm:gap-3 rounded-xl transition-all duration-300 hover:scale-[1.03] outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden relative shadow-lg ring-1 ring-white/10 group-hover:ring-brand-500/50 transition-all">
                      <ThumbnailImage 
                        src={`https://img.youtube.com/vi/${vid.id}/maxresdefault.jpg`} 
                        videoId={vid.id}
                        alt={vid.title} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      {vid.lengthSeconds > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] sm:text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
                          {Math.floor(vid.lengthSeconds / 60)}:{(vid.lengthSeconds % 60).toString().padStart(2, '0')}
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                    </div>
                    <div className="px-1">
                      <h4 className="text-xs sm:text-base font-semibold text-zinc-100 line-clamp-2 leading-snug group-hover:text-brand-400 transition-colors drop-shadow-md">{vid.title}</h4>
                      <p className="text-[10px] sm:text-sm text-zinc-400 mt-1 sm:mt-1.5 line-clamp-1 font-medium">{vid.author}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          </div>
        </div>
        </div>
      )}
      
      {/* Wake-Up Overlay - Covers the screen ONLY when the UI is hidden. 
          It catches the very first mouse movement to wake up the UI, then vanishes instantly so you can click the video freely. */}
      {isUiHidden && (
        <div 
          className="absolute inset-0 z-[100]" 
          onMouseMove={handleMouseMove} 
          onClick={handleMouseMove}
        />
      )}

      {/* Custom Fullscreen Button - Middle Right */}
      {!isIOS && (
        <button 
          onClick={toggleFullscreen}
          className={`absolute top-1/2 right-4 -translate-y-1/2 z-[60] flex items-center justify-center w-12 h-12 bg-black/30 hover:bg-white/10 text-white/80 hover:text-white rounded-full backdrop-blur-xl border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.5)] transition-all duration-300 hover:scale-110 active:scale-95 ${isIdle || showOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100 hover:opacity-100'}`}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      )}

      {/* Alerts Container (Bottom Left, safely above all YT controls) */}
      <div className={`absolute bottom-24 sm:bottom-32 left-3 sm:left-4 z-[60] flex flex-col gap-2 sm:gap-3 items-start pointer-events-none transition-all duration-500 ${isUiHidden || showOverlay ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        
        {/* Toasts */}
        {toasts.map(toast => (
          <div 
            key={toast.id}
            className="flex items-center gap-2 sm:gap-2.5 px-3 py-2 sm:px-4 sm:py-2.5 bg-black/30 text-white/95 text-xs sm:text-sm font-medium tracking-wide rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl border border-white/10 animate-in slide-in-from-left-4 fade-in duration-300 pointer-events-auto"
          >
            <Info size={14} className="sm:w-4 sm:h-4 text-zinc-300" />
            {toast.message}
          </div>
        ))}

        {/* Jump to Highlight Button */}
        {highlightSegment && !hideHighlight && currentTime < highlightSegment.segment[0] - 5 && (
          <button 
            onClick={() => executeSkip({ category: 'Highlight', segment: [currentTime, highlightSegment.segment[0]] })}
            className="group flex items-center gap-2 sm:gap-2.5 px-3 py-2 sm:px-5 sm:py-2.5 bg-black/30 hover:bg-white/10 text-white/95 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl border border-white/10 transition-all duration-300 pointer-events-auto active:scale-95 hover:scale-105 animate-in slide-in-from-left-4 fade-in"
          >
            <Star size={14} className="sm:w-4 sm:h-4 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
            <span className="text-xs sm:text-sm font-semibold tracking-wide">Jump to Highlight</span>
          </button>
        )}

        {/* Manual Skip Button */}
        {manualSkip && (
          <button 
            onClick={() => executeSkip(manualSkip)}
            className="group flex items-center gap-2 sm:gap-2.5 px-3 py-2 sm:px-5 sm:py-2.5 bg-black/30 hover:bg-white/10 text-white/95 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl border border-white/10 transition-all duration-300 pointer-events-auto active:scale-95 hover:scale-105 animate-in slide-in-from-left-4 fade-in"
          >
            <SkipForward size={14} className="sm:w-4 sm:h-4 text-brand-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
            <span className="text-xs sm:text-sm font-semibold tracking-wide">Skip {manualSkip.category}</span>
          </button>
        )}
      </div>

      {/* Roadmap Bar - Interactive */}
      {duration > 0 && segments.length > 0 && (
        <div 
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percentage = (e.clientX - rect.left) / rect.width;
            if (playerRef.current) {
              playerRef.current.seekTo(duration * percentage, true);
            }
          }}
          className={`absolute top-0 left-0 right-0 h-1.5 hover:h-6 hover:bg-zinc-900/80 bg-zinc-900/50 z-[60] shadow-md cursor-pointer transition-all duration-300 ${isUiHidden || showOverlay ? 'opacity-0 pointer-events-none' : 'opacity-70 hover:opacity-100'}`}
        >
          {segments.map((seg, i) => {
            const [start, end] = seg.segment;
            const left = (start / duration) * 100;
            const width = seg.category === 'poi_highlight' ? 0.5 : ((end - start) / duration) * 100;
            const colorClass = CATEGORY_COLORS[seg.category] || 'bg-brand-500';
            
            return (
              <div 
                key={i} 
                className={`absolute top-0 bottom-0 ${colorClass} opacity-100`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
          {/* Current Progress Indicator */}
          <div 
            className="absolute top-0 bottom-0 bg-white w-1 rounded-r shadow-[0_0_10px_rgba(255,255,255,0.8)] pointer-events-none"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
