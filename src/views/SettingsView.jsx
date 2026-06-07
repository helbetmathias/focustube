import { useState, useEffect } from 'react';
import { Shield, Play, Music, MessageCircle, FastForward, Bell, Clock, Star, Sparkles } from 'lucide-react';
import { getTimeSaved } from '../services/storage';

const CATEGORIES = [
  { id: 'sponsor', label: 'Sponsor', desc: 'Paid promotion or sponsorships', icon: Shield },
  { id: 'intro', label: 'Intermission/Intro Animation', desc: 'Title cards or intros', icon: Play },
  { id: 'outro', label: 'Endcards/Credits', desc: 'Outros or credits', icon: Play },
  { id: 'interaction', label: 'Interaction Reminder', desc: 'Subscribe, like, etc.', icon: MessageCircle },
  { id: 'selfpromo', label: 'Unpaid/Self Promotion', desc: 'Promoting own products', icon: FastForward },
  { id: 'music_offtopic', label: 'Music: Non-Music Section', desc: 'Non-music sections in music videos', icon: Music },
  { id: 'poi_highlight', label: 'Highlight', desc: 'Jump to the most interesting part', icon: Star },
];

const DEFAULT_SETTINGS = {
  sponsor: 'auto',
  intro: 'auto',
  outro: 'auto',
  interaction: 'auto',
  selfpromo: 'auto',
  music_offtopic: 'ignore',
  poi_highlight: 'manual',
};

const formatTimeSaved = (seconds) => {
  if (!seconds || seconds <= 0) return '0 seconds';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m > 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (h === 0 && s > 0) parts.push(`${s} second${s !== 1 ? 's' : ''}`);
  
  return parts.join(' and ');
};

const getInitialSettings = () => {
  try {
    const stored = localStorage.getItem('sponsorblock_categories');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const newSettings = { ...DEFAULT_SETTINGS };
        CATEGORIES.forEach(cat => {
          newSettings[cat.id] = parsed.includes(cat.id) ? 'auto' : 'ignore';
        });
        localStorage.setItem('sponsorblock_categories', JSON.stringify(newSettings));
        return newSettings;
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch(e) {}
  return DEFAULT_SETTINGS;
};

const getInitialNotifications = () => {
  const notifs = localStorage.getItem('puretube_notifications');
  return notifs !== null ? notifs === 'true' : true;
};

const getInitialAmbient = () => {
  const ambient = localStorage.getItem('puretube_ambient');
  return ambient !== null ? ambient === 'true' : false; // Default off per user request
};

export default function SettingsView({ isActive }) {
  const [settings, setSettings] = useState(getInitialSettings);
  const [notifications, setNotifications] = useState(getInitialNotifications);
  const [ambient, setAmbient] = useState(getInitialAmbient);
  const [timeSaved, setTimeSaved] = useState(0);

  useEffect(() => {
    if (isActive) {
      getTimeSaved().then(time => {
        setTimeSaved(time);
      });
    }
  }, [isActive]);

  const updateAction = (id, action) => {
    const newSettings = { ...settings, [id]: action };
    setSettings(newSettings);
    localStorage.setItem('sponsorblock_categories', JSON.stringify(newSettings));
    window.dispatchEvent(new Event('puretube_settings_updated'));
  };

  const toggleNotifications = () => {
    const newVal = !notifications;
    setNotifications(newVal);
    localStorage.setItem('puretube_notifications', String(newVal));
  };

  const toggleAmbient = () => {
    const newVal = !ambient;
    setAmbient(newVal);
    localStorage.setItem('puretube_ambient', String(newVal));
    window.dispatchEvent(new Event('puretube_settings_updated'));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 animate-page-fade max-w-6xl mx-auto w-full pb-4">
      <div className="flex-none flex justify-between items-end border-b border-zinc-800 pb-3">
        <div>
          <h2 className="text-2xl font-semibold mb-1 text-zinc-100 tracking-tight">Settings</h2>
          <p className="text-zinc-500 text-sm">Configure your SponsorBlock preferences and playback behavior.</p>
        </div>
      </div>
      
      <div className="flex-1 min-h-0 overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex flex-col justify-between gap-4 pb-2">
        
        {/* Stats Section */}
        <section>
          <div className="glass rounded-xl p-3 lg:p-4 flex items-center gap-5 transition-all">
            <div className="w-14 h-14 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-500">
              <Clock size={28} />
            </div>
            <div>
              <p className="text-zinc-400 text-sm font-medium">Time Saved by SponsorBlock</p>
              <p className="text-2xl lg:text-3xl font-bold text-zinc-100 mt-1">{formatTimeSaved(timeSaved)}</p>
            </div>
          </div>
        </section>

        {/* Global Settings */}
        <section>
          <h3 className="text-lg font-semibold mb-3 text-zinc-300">Global</h3>
          <div className="flex flex-col gap-2">
            <div 
              onClick={toggleNotifications}
              className="p-3 lg:p-4 glass rounded-xl cursor-pointer hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${notifications ? 'bg-brand-500/20 text-brand-500' : 'bg-zinc-800 text-zinc-500'}`}>
                  <Bell size={24} />
                </div>
                <div>
                  <h4 className="font-medium text-zinc-100">Toast Notifications</h4>
                  <p className="text-sm text-zinc-500 mt-1">Show a small popup when a segment is automatically skipped.</p>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 mt-1 ${notifications ? 'bg-brand-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifications ? 'translate-x-6' : ''}`} />
              </div>
            </div>

            <div 
              onClick={toggleAmbient}
              className="p-3 lg:p-4 glass rounded-xl cursor-pointer hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${ambient ? 'bg-brand-500/20 text-brand-500' : 'bg-zinc-800 text-zinc-500'}`}>
                  <Sparkles size={24} />
                </div>
                <div>
                  <h4 className="font-medium text-zinc-100">Ambient Theater Mode</h4>
                  <p className="text-sm text-zinc-500 mt-1">Cast a glowing aura around the player that matches the video's colors.</p>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 mt-1 ${ambient ? 'bg-brand-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${ambient ? 'translate-x-6' : ''}`} />
              </div>
            </div>
          </div>
        </section>

        {/* Category Settings - Symmetric Grid */}
        <section>
          <h3 className="text-lg font-semibold mb-3 text-zinc-300">Skip Categories</h3>
          <div className="grid gap-3 lg:gap-4 sm:grid-cols-2">
            {CATEGORIES.map((cat, idx) => {
              const action = settings[cat.id];
              const Icon = cat.icon;
              // If it's the last item and we have an odd number of items, center it across both columns
              const isLastOdd = idx === CATEGORIES.length - 1 && CATEGORIES.length % 2 !== 0;
              
              return (
                <div 
                  key={cat.id} 
                  className={`p-3 lg:p-4 glass rounded-xl lg:rounded-2xl flex flex-col gap-3 border-zinc-800/80 hover:border-zinc-700 transition-colors ${isLastOdd ? 'sm:col-span-2 sm:mx-auto sm:w-[calc(50%-0.5rem)] lg:w-[calc(50%-0.625rem)]' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400">
                      <Icon size={20} />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-zinc-100">{cat.label}</h4>
                      <p className="text-xs lg:text-sm text-zinc-500 mt-1 lg:mt-2 leading-relaxed">{cat.desc}</p>
                    </div>
                  </div>
                  <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800 mt-auto">
                    <button onClick={() => updateAction(cat.id, 'auto')} className={`flex-1 text-xs lg:text-sm py-1.5 lg:py-2 rounded-md font-medium transition-colors ${action === 'auto' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}>Auto</button>
                    <button onClick={() => updateAction(cat.id, 'manual')} className={`flex-1 text-xs lg:text-sm py-1.5 lg:py-2 rounded-md font-medium transition-colors ${action === 'manual' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}>Manual</button>
                    <button onClick={() => updateAction(cat.id, 'ignore')} className={`flex-1 text-xs lg:text-sm py-1.5 lg:py-2 rounded-md font-medium transition-colors ${action === 'ignore' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}>Ignore</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="text-center text-zinc-500 text-sm mt-4">
          Made by <a href="https://discord.com/users/741942954800709703" target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-brand-400 transition-colors font-medium">Mathy</a>
        </div>
      </div>
    </div>
  );
}
