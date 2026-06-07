import { useState, useEffect, useRef } from 'react';
import { Clock, Play, Trash2, X } from 'lucide-react';
import { getHistory, saveHistory, clearHistory as clearStorageHistory } from '../services/storage';

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

export default function HistoryView({ isActive, onPlayVideo }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (isActive) {
      getHistory().then(data => {
        if (data) setHistory(data);
      });
    }
  }, [isActive]);

  const clearHistory = async () => {
    if (confirm('Are you sure you want to clear your entire watch history?')) {
      setHistory([]);
      await clearStorageHistory();
    }
  };

  const deleteItem = async (id) => {
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    await saveHistory(updatedHistory);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-6 animate-page-fade max-w-6xl mx-auto w-full pb-4">
      <div className="flex-none flex justify-between items-end border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-3xl font-semibold mb-2 text-zinc-100 tracking-tight">Watch History</h2>
          <p className="text-zinc-500">Recently played videos.</p>
        </div>
        {history.length > 0 && (
          <button 
            onClick={clearHistory}
            className="flex items-center gap-2 text-red-500 hover:text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-lg transition-colors"
          >
            <Trash2 size={18} />
            <span>Clear History</span>
          </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {history.length === 0 ? (
          <div className="w-full flex flex-col items-center justify-center min-h-[40vh] glass rounded-3xl bg-zinc-900/30 border border-zinc-800/80 shadow-2xl p-8 text-center animate-page-fade">
            <div className="w-20 h-20 bg-zinc-800/80 rounded-full flex items-center justify-center mb-6 shadow-inner ring-1 ring-white/5">
              <Clock size={32} className="text-zinc-400" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">No Watch History</h2>
            <p className="text-zinc-400 mt-3 max-w-md leading-relaxed">Videos you watch will magically appear here. We save your exact progress so you can always pick up exactly where you left off.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {history.map((item, idx) => {
              const isFinished = item.duration && item.progress ? (item.progress / item.duration) > 0.95 : false;
              const hasProgress = item.progress > 0 && !isFinished;
              
              return (
              <div key={`${item.id}-${idx}`} className="glass rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 group hover:bg-zinc-800/50 transition-colors duration-300 ease-out relative">
                <div className="w-full sm:w-48 aspect-video bg-zinc-800 rounded-lg overflow-hidden relative flex-shrink-0 border border-zinc-700">
                  <ThumbnailImage 
                    src={`https://img.youtube.com/vi/${item.id}/maxresdefault.jpg`} 
                    videoId={item.id}
                    alt={item.title}
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" 
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out pointer-events-none" />
                </div>
                <div className="flex-1 min-w-0 py-1 w-full">
                  <h4 className="font-semibold text-base sm:text-lg text-zinc-100 line-clamp-2 sm:truncate" title={item.title || item.id}>
                    {item.title || `Video ID: ${item.id}`}
                  </h4>
                  <div className="flex items-center gap-2 text-zinc-500 text-xs sm:text-sm mt-1 sm:mt-1.5 flex-wrap">
                    <Clock size={14} />
                    <span>{formatDate(item.timestamp)}</span>
                    {hasProgress && (
                      <>
                        <span className="opacity-50">•</span>
                        <span className="text-brand-500">Resumes at {Math.floor(item.progress / 60)}:{Math.floor(item.progress % 60).toString().padStart(2, '0')}</span>
                      </>
                    )}
                    {isFinished && (
                      <>
                        <span className="opacity-50">•</span>
                        <span className="text-zinc-500">Watched</span>
                      </>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 sm:gap-3 mt-3 sm:mt-4 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out">
                    <button 
                      onClick={() => onPlayVideo(item.id, item.playlistId, false)}
                      className="bg-brand-500 hover:bg-brand-400 text-white rounded-full py-1.5 px-4 sm:px-5 text-xs sm:text-sm font-semibold shadow-md flex items-center justify-center gap-2 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] flex-1 sm:flex-none"
                    >
                      <Play size={14} fill="currentColor" />
                      {hasProgress ? 'Resume' : (isFinished ? 'Start over' : 'Play')}
                    </button>
                    {hasProgress && (
                      <button 
                        onClick={() => onPlayVideo(item.id, item.playlistId, true)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full py-1.5 px-4 sm:px-5 text-xs sm:text-sm font-medium border border-zinc-700 transition-all duration-300 ease-out hover:scale-[1.02] active:scale-[0.98] flex-1 sm:flex-none text-center"
                      >
                        Start over
                      </button>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => deleteItem(item.id)}
                  className="absolute top-2 right-2 sm:relative sm:top-auto sm:right-auto p-2 sm:p-3 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all duration-300 ease-out sm:ml-4 sm:self-center opacity-100 sm:opacity-0 group-hover:opacity-100 z-10 bg-surface/80 sm:bg-transparent backdrop-blur-md sm:backdrop-blur-none"
                  title="Remove from history"
                >
                  <X size={18} className="sm:w-5 sm:h-5" />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
