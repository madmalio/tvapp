import { useEffect, useState, useMemo, useRef, startTransition, memo } from "react";
import { Link } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight, Tv } from "lucide-react";
import { getApiUrl, fetchWithCache } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { lockToLandscape } from "../lib/orientation";

type Source = { id: number; name: string; type: string; url: string; epg_url: string; };

type Channel = {
  id: number;
  source_id: number;
  name: string;
  stream_url: string;
  logo_url?: string;
  group_title?: string;
};

type EPGEntry = {
  id: number;
  channel_id: number;
  title: string;
  description: string;
  poster_url?: string;
  start_time: string;
  end_time: string;
};

const CATEGORIES = ['All', 'Movies', 'News', 'Sports', 'Kids', 'Entertainment', 'Docs & Learning', 'Music', 'Local', 'Other'];

function mapCategory(rawGroup: string, channelName: string = ""): string {
  if (channelName) {
    const lowerName = channelName.toLowerCase();
    if (lowerName.match(/nbc|abc|cbs|fox|cw|pbs/)) return 'Local';
  }
  if (!rawGroup) return 'Other';
  const lower = rawGroup.toLowerCase();
  if (lower.match(/movie|cinema|film|box office/)) return 'Movies';
  if (lower.match(/news|weather|breaking|journal/)) return 'News';
  if (lower.match(/sport|espn|nfl|nba|mlb|nhl|wwe|racing/)) return 'Sports';
  if (lower.match(/kid|child|family|animation|cartoon|disney|nick/)) return 'Kids';
  if (lower.match(/comedy|drama|reality|tv show|sitcom|entertainment/)) return 'Entertainment';
  if (lower.match(/doc|history|science|discovery|nature|learning/)) return 'Docs & Learning';
  if (lower.match(/music|mtv|vh1|concert|radio/)) return 'Music';
  if (lower.match(/local|us|uk|region|city/)) return 'Local';
  return 'Other';
}

const ChannelCarousel = memo(function ChannelCarousel({ groupName, channels, onHover }: { groupName: string; channels: Channel[]; onHover: (ch: Channel) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = direction === "left" ? -600 : 600;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <div className="flex flex-col relative group/carousel">
      <div className="flex justify-between items-end mb-3 md:mb-4 px-4 sm:px-6 md:pl-28 md:pr-12">
        <h3 className="text-lg sm:text-xl font-semibold text-white tracking-tight">{groupName}</h3>
        <div className="hidden md:flex space-x-2 opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 pr-8 md:pr-12 absolute right-0 top-0">
          <button 
            onClick={() => scroll("left")}
            className="p-2 rounded-full bg-neutral-800/80 text-white hover:bg-blue-600 transition-colors focus:outline-none cursor-pointer"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button 
            onClick={() => scroll("right")}
            className="p-2 rounded-full bg-neutral-800/80 text-white hover:bg-blue-600 transition-colors focus:outline-none cursor-pointer"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 md:pb-6 pt-1 md:pt-2 px-4 sm:px-6 md:pr-12 no-scrollbar snap-x snap-mandatory scroll-smooth"
      >
        <div className="hidden md:block md:w-24 shrink-0 snap-start"></div>
        {channels.map((ch) => (
          <Link
            key={ch.id}
            to={`/player/${ch.id}`}
            state={{ from: '/channels' }}
            onClick={() => lockToLandscape()}
            onMouseEnter={() => onHover(ch)}
            onFocus={() => onHover(ch)}
            className="group relative flex-none w-[220px] sm:w-[280px] aspect-video bg-neutral-900 rounded-xl overflow-hidden snap-start transition-all duration-300 hover:scale-105 hover:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-neutral-950 shadow-lg border-2 border-transparent hover:border-blue-500 hover:shadow-[0_0_20px_rgba(59,130,246,0.6)]"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity z-10" />
            
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 sm:p-6 z-20">
              {ch.logo_url ? (
                <img
                  src={ch.logo_url}
                  alt={ch.name}
                  className="w-full h-full object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-110"
                />
              ) : (
                <>
                  <span className="text-4xl sm:text-5xl text-neutral-600 group-hover:text-neutral-400 transition-colors mb-2">📺</span>
                  <span className="text-neutral-400 font-medium text-center truncate w-full px-2 text-sm">{ch.name}</span>
                </>
              )}
            </div>
          </Link>
        ))}
        {/* Right padding spacer */}
        <div className="w-4 md:w-1 shrink-0"></div>
      </div>
    </div>
  );
});

export default function ChannelList() {
  const { data: sourcesData } = useApi<Source[]>('/api/sources');
  const sources = useMemo(() => sourcesData?.filter(s => s.type !== 'rtsp') || [], [sourcesData]);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithCache(getApiUrl("/api/channels"))
      .then((data) => {
        setChannels(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (sources && sources.length > 0 && activeSourceId === null) {
      setActiveSourceId(sources[0].id);
    }
  }, [sources, activeSourceId]);

  const [activeCategory, setActiveCategory] = useState<string>('All');

  const sourceChannels = useMemo(() => {
    if (!activeSourceId) return [];
    return channels.filter(c => c.source_id === activeSourceId);
  }, [channels, activeSourceId]);

  const availableCategories = useMemo(() => {
    return CATEGORIES.filter(cat => 
      cat === 'All' || sourceChannels.some(c => mapCategory(c.group_title || "", c.name || "") === cat)
    );
  }, [sourceChannels]);

  const filteredChannels = useMemo(() => {
    let list = sourceChannels;
    if (activeCategory !== 'All') {
      list = list.filter(c => mapCategory(c.group_title || "", c.name || "") === activeCategory);
    }
    return list;
  }, [sourceChannels, activeCategory]);

  const heroChannel = useMemo(() => {
    return filteredChannels.find(c => c.logo_url) || filteredChannels[0];
  }, [filteredChannels]);

  const [hoveredChannel, setHoveredChannel] = useState<Channel | null>(null);
  
  useEffect(() => {
    setHoveredChannel(null);
  }, [activeSourceId, activeCategory]);

  const [epgData, setEpgData] = useState<EPGEntry[]>([]);
  const [epgLoaded, setEpgLoaded] = useState(false);
  
  useEffect(() => {
    if (heroChannel && !hoveredChannel) {
      setHoveredChannel(heroChannel);
    }
  }, [heroChannel, hoveredChannel]);

  const activeHeroChannel = hoveredChannel || heroChannel;

  useEffect(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0); // Align to the start of the hour for stable cache keys
    const start = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString();
    
    fetchWithCache(getApiUrl(`/api/epg?start=${start}&end=${end}`))
      .then(data => {
        setEpgData(data || []);
        setEpgLoaded(true);
      })
      .catch(err => {
        console.error(err);
        setEpgLoaded(true);
      });
  }, []);

  const heroProgram = useMemo(() => {
    if (!activeHeroChannel) return null;
    const now = new Date();
    return epgData.find(e => 
      e.channel_id === activeHeroChannel.id && 
      new Date(e.start_time) <= now && 
      new Date(e.end_time) > now
    ) || null;
  }, [activeHeroChannel, epgData]);

  const isFetchingProgram = !epgLoaded;
  const heroReady = epgLoaded;

  if (loading || !heroReady) {
    return (
      <div className="flex-1 flex items-center justify-center bg-neutral-950">
        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 rounded-2xl p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold mb-3 text-white">No Channels Found</h2>
          <p className="text-neutral-400 mb-6">
            You haven't loaded any channels yet. Head over to the settings to add your IPTV playlist.
          </p>
          <Link 
            to="/settings" 
            className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative no-scrollbar animate-in fade-in duration-500 pb-20 md:pb-0">
      
      {/* Top Source Tabs */}
      {sources && sources.length > 1 && (
        <div className="relative pt-4 pb-2 px-4 sm:px-6 md:pl-28 md:pr-12 z-50 flex gap-2 overflow-x-auto no-scrollbar">
          {sources.map(src => (
            <button
              key={src.id}
              onClick={() => startTransition(() => setActiveSourceId(src.id))}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors backdrop-blur-md border shrink-0 cursor-pointer ${
                activeSourceId === src.id 
                  ? 'bg-blue-600/90 text-white border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
                  : 'bg-neutral-900/50 text-neutral-400 border-neutral-800 hover:text-white hover:bg-neutral-800'
              }`}
            >
              <Tv className="w-4 h-4" />
              {src.name}
            </button>
          ))}
        </div>
      )}

      {/* Hero Section */}
      {activeHeroChannel && (
        <div className="relative min-h-[380px] sm:min-h-[460px] md:min-h-[500px] md:h-[65vh] w-full flex items-end pt-6 md:pt-0 pb-10 sm:pb-14 md:pb-16 px-4 sm:px-6 md:pl-28 md:pr-12 shrink-0 overflow-hidden">
          
          {/* Background Image / Ambient Gradients */}
          <div className="absolute inset-0 bg-neutral-950 overflow-hidden">
            {(!isFetchingProgram && !(heroProgram?.poster_url || activeHeroChannel.logo_url)) && (
              <>
                <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[80%] rounded-full bg-blue-900/30 blur-[120px] mix-blend-screen" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[70%] rounded-full bg-purple-900/20 blur-[100px] mix-blend-screen" />
              </>
            )}

            {(heroProgram?.poster_url || activeHeroChannel.logo_url) && (
              <img 
                src={heroProgram?.poster_url || activeHeroChannel.logo_url} 
                alt="Poster" 
                className="absolute inset-0 w-full h-full object-cover object-top opacity-60 transition-none"
                loading="eager"
                decoding="async"
              />
            )}
          </div>
          
          <div className="absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/80 to-transparent z-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent z-0" />
          
          <div className="relative z-10 max-w-3xl">
            {activeHeroChannel.logo_url && (
              <img 
                key={activeHeroChannel.logo_url}
                src={activeHeroChannel.logo_url} 
                alt="Logo" 
                className="h-10 sm:h-12 md:h-16 mb-4 md:mb-6 object-contain drop-shadow-lg" 
              />
            )}
            
            {heroProgram ? (
              <div key={heroProgram.id}>
                <div className="flex items-center gap-2 sm:gap-3 mb-3 md:mb-4 flex-wrap">
                  <span className="flex items-center text-xs font-bold uppercase tracking-wider text-red-500 bg-red-500/10 px-2 py-1 rounded">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mr-2" />
                    Live
                  </span>
                  <span className="text-xs sm:text-sm font-medium text-blue-300 bg-blue-500/10 px-2 py-1 rounded">
                    {new Date(heroProgram.start_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {new Date(heroProgram.end_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                  </span>
                </div>
                
                <h1 className="text-3xl sm:text-5xl md:text-7xl font-extrabold text-white mb-3 md:mb-4 tracking-tight drop-shadow-2xl leading-tight">
                  {heroProgram.title}
                </h1>
                
                <p className="text-sm sm:text-base md:text-xl text-neutral-300 mb-6 md:mb-8 max-w-2xl line-clamp-2 sm:line-clamp-3 leading-relaxed drop-shadow-md">
                  {heroProgram.description || `Start watching the best of ${activeHeroChannel.group_title || "Live TV"} right now on your personal media center.`}
                </p>
              </div>
            ) : (
              <div key={activeHeroChannel.id}>
                <h1 className="text-3xl sm:text-5xl md:text-7xl font-extrabold text-white mb-3 md:mb-4 tracking-tight drop-shadow-2xl leading-tight">
                  {activeHeroChannel.name}
                </h1>
                <p className="text-sm sm:text-base md:text-xl text-neutral-300 mb-6 md:mb-8 max-w-2xl line-clamp-2 leading-relaxed drop-shadow-md">
                  Start watching the best of {activeHeroChannel.group_title || "Live TV"} right now on your personal media center.
                </p>
              </div>
            )}

            <Link
              to={`/player/${activeHeroChannel.id}`}
              state={{ from: '/channels' }}
              onClick={() => lockToLandscape()}
              className="inline-flex items-center justify-center px-6 sm:px-8 py-3 sm:py-4 bg-white text-black hover:bg-neutral-200 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] font-semibold rounded-full transition-all duration-300 hover:scale-105 active:scale-95 text-sm sm:text-base cursor-pointer"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5 mr-2 fill-black" />
              Watch Now
            </Link>
          </div>
        </div>
      )}

      {/* Channel Groups */}
      <div className="pb-24 -mt-6 md:-mt-10 relative z-20 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-2 px-4 sm:px-6 md:pl-28 md:pr-12 no-scrollbar">
          {availableCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeCategory === cat 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700 backdrop-blur-sm'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <ChannelCarousel 
          key={activeCategory} 
          groupName={activeCategory === 'All' ? 'All Channels' : activeCategory} 
          channels={filteredChannels} 
          onHover={setHoveredChannel}
        />
      </div>
    </div>
  );
}
