import { useState } from 'react';
import { Play, PlaySquare, History as HistoryIcon, Settings as SettingsIcon } from 'lucide-react';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import PlayerView from './views/PlayerView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

function NavLink({ activeTab, tabId, onClick, icon: Icon, label }) {
  const isActive = activeTab === tabId;
  
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-colors ${
        isActive 
          ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm' 
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border border-transparent'
      }`}
    >
      <Icon size={18} className="sm:w-4 sm:h-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('player');
  const [playRequest, setPlayRequest] = useState(null);

  const handlePlayVideo = (videoId, playlistId, forceStart = false) => {
    setPlayRequest({ videoId, playlistId, forceStart, timestamp: Date.now() });
    setActiveTab('player');
  };

  return (
    <div className="flex flex-col w-full h-full bg-background relative">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--color-border)] bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div 
          className="flex items-center gap-3 w-[140px] sm:w-[200px] cursor-pointer group"
          onClick={() => {
            setActiveTab('player');
            window.dispatchEvent(new Event('focustube_refresh_feed'));
          }}
        >
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-brand-500 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/20 text-white shrink-0">
            <Play size={18} className="sm:w-5 sm:h-5 ml-0.5" fill="currentColor" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-100 tracking-tight">FocusTube</h1>
        </div>
        <nav className="flex items-center gap-2">
          <NavLink activeTab={activeTab} tabId="player" onClick={() => setActiveTab('player')} icon={PlaySquare} label="Player" />
          <NavLink activeTab={activeTab} tabId="history" onClick={() => setActiveTab('history')} icon={HistoryIcon} label="History" />
          <NavLink activeTab={activeTab} tabId="settings" onClick={() => setActiveTab('settings')} icon={SettingsIcon} label="Settings" />
        </nav>
      </header>

      {/* Main Content - Views stay mounted so they preserve state, just hidden visually */}
      <main className="flex-1 min-h-0 w-full mx-auto px-4 md:px-8 pt-4 md:pt-8 flex flex-col relative">
        <div className={`flex-1 min-h-0 flex-col w-full h-full ${activeTab === 'player' ? 'flex' : 'hidden'}`}>
          <PlayerView isActive={activeTab === 'player'} playRequest={playRequest} />
        </div>
        <div className={`flex-1 min-h-0 flex-col w-full h-full ${activeTab === 'history' ? 'flex' : 'hidden'}`}>
          <HistoryView isActive={activeTab === 'history'} onPlayVideo={handlePlayVideo} />
        </div>
        <div className={`flex-1 min-h-0 flex-col w-full h-full ${activeTab === 'settings' ? 'flex' : 'hidden'}`}>
          <SettingsView isActive={activeTab === 'settings'} />
        </div>
      </main>
      <Analytics />
      <SpeedInsights />
    </div>
  );
}

export default App;
