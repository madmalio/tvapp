import { useEffect, useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";

type Channel = {
  id: number;
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

function mapCategory(rawGroup: string): string {
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

function ChannelCarousel({ groupName, channels, onHover }: { groupName: string; channels: Channel[]; onHover: (ch: Channel) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = direction === "left" ? -600 : 600;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <div className="flex flex-col relative group/carousel">
      <div className="flex justify-between items-end mb-4 pr-8 md:pr-12 pl-24 md:pl-28">
        <h3 className="text-xl font-semibold text-white tracking-tight">{groupName}</h3>
        <div className="flex space-x-2 opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-300 pr-8 md:pr-12 absolute right-0 top-0">
          <button 
            onClick={() => scroll("left")}
            className="p-2 rounded-full bg-neutral-800/80 text-white hover:bg-blue-600 transition-colors focus:outline-none"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button 
            onClick={() => scroll("right")}
            className="p-2 rounded-full bg-neutral-800/80 text-white hover:bg-blue-600 transition-colors focus:outline-none"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-6 pt-2 pr-8 md:pr-12 no-scrollbar snap-x snap-mandatory scroll-smooth"
      >
        <div className="w-20 md:w-24 shrink-0 snap-start"></div>
        {channels.map((ch) => (
          <Link
            key={ch.id}
            to={`/player/${ch.id}`}
            state={{ from: '/channels' }}
            onMouseEnter={() => onHover(ch)}
            onFocus={() => onHover(ch)}
            className="group relative flex-none w-[280px] aspect-video bg-neutral-900 rounded-xl overflow-hidden snap-start transition-all duration-300 hover:scale-105 hover:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-neutral-950 shadow-lg border-2 border-transparent hover:border-blue-500 hover:shadow-[0_0_20px_rgba(59,130,246,0.6)]"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity z-10" />
            
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-20">
              {ch.logo_url ? (
                <img
                  src={ch.logo_url}
                  alt={ch.name}
                  className="w-full h-full object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-110"
                />
              ) : (
                <>
                  <span className="text-5xl text-neutral-600 group-hover:text-neutral-400 transition-colors mb-2">📺</span>
                  <span className="text-neutral-400 font-medium text-center truncate w-full px-2">{ch.name}</span>
                </>
              )}
            </div>
          </Link>
        ))}
        {/* Right padding spacer since browsers ignore padding-right on scroll containers */}
        <div className="w-1 shrink-0"></div>
      </div>
    </div>
  );
}

export default function ChannelList() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/channels")
      .then((r) => r.json())
      .then((data) => {
        setChannels(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const [activeCategory, setActiveCategory] = useState<string>('All');

  const { heroChannel, filteredChannels, availableCategories } = useMemo(() => {
    if (channels.length === 0) return { heroChannel: null, filteredChannels: [], availableCategories: [] };
    const hero = channels.find(c => c.logo_url) || channels[0];
    
    const present = new Set<string>();
    present.add('All');
    channels.forEach(ch => present.add(mapCategory(ch.group_title || "")));
    const avail = CATEGORIES.filter(cat => present.has(cat));
    
    const filtered = activeCategory === 'All' 
      ? channels 
      : channels.filter(ch => mapCategory(ch.group_title || "") === activeCategory);
      
    return { heroChannel: hero, filteredChannels: filtered, availableCategories: avail };
  }, [channels, activeCategory]);

  const [hoveredChannel, setHoveredChannel] = useState<Channel | null>(null);
  const [heroProgram, setHeroProgram] = useState<EPGEntry | null>(null);
  const [isFetchingProgram, setIsFetchingProgram] = useState(true);
  const [heroReady, setHeroReady] = useState(false);

  useEffect(() => {
    if (heroChannel && !hoveredChannel) {
      setHoveredChannel(heroChannel);
    }
  }, [heroChannel, hoveredChannel]);

  const activeHeroChannel = hoveredChannel || heroChannel;

  useEffect(() => {
    if (!activeHeroChannel) return;
    setIsFetchingProgram(true);
    
    const now = new Date();
    const start = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString();
    
    fetch(`/api/epg?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(async (data: EPGEntry[]) => {
        if (!data || data.length === 0) {
          setHeroProgram(null);
          return;
        }
        
        const liveShow = data.find(e => 
          e.channel_id === activeHeroChannel.id && 
          new Date(e.start_time) <= now && 
          new Date(e.end_time) > now
        );
        
        setHeroProgram(liveShow || null);
        
        const posterUrl = liveShow?.poster_url;
        if (posterUrl) {
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = posterUrl;
          });
        }
      })
      .catch(console.error)
      .finally(() => {
        setIsFetchingProgram(false);
        setHeroReady(true);
      });
  }, [activeHeroChannel]);

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
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative no-scrollbar animate-in fade-in duration-500">
      {/* Hero Section */}
      {activeHeroChannel && (
        <div className="relative h-[65vh] min-h-[500px] w-full flex items-end pb-16 pr-8 md:pr-12 pl-24 md:pl-28 shrink-0 overflow-hidden">
          
          {/* Background Image / Ambient Gradients */}
          <div className="absolute inset-0 bg-neutral-950 overflow-hidden">
            {(!isFetchingProgram && !heroProgram?.poster_url) && (
              <>
                <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[80%] rounded-full bg-blue-900/30 blur-[120px] mix-blend-screen" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[70%] rounded-full bg-purple-900/20 blur-[100px] mix-blend-screen" />
              </>
            )}

            {heroProgram?.poster_url && (
              <img 
                src={heroProgram.poster_url} 
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
                className="h-16 mb-6 object-contain drop-shadow-lg" 
              />
            )}
            
            {heroProgram ? (
              <div key={heroProgram.id}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="flex items-center text-xs font-bold uppercase tracking-wider text-red-500 bg-red-500/10 px-2 py-1 rounded">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mr-2" />
                    Live
                  </span>
                  <span className="text-sm font-medium text-blue-300 bg-blue-500/10 px-2 py-1 rounded">
                    {new Date(heroProgram.start_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {new Date(heroProgram.end_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                  </span>
                </div>
                
                <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-4 tracking-tight drop-shadow-2xl leading-tight">
                  {heroProgram.title}
                </h1>
                
                <p className="text-lg md:text-xl text-neutral-300 mb-8 max-w-2xl line-clamp-3 leading-relaxed drop-shadow-md">
                  {heroProgram.description || `Start watching the best of ${activeHeroChannel.group_title || "Live TV"} right now on your personal media center.`}
                </p>
              </div>
            ) : (
              <div key={activeHeroChannel.id}>
                <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-4 tracking-tight drop-shadow-2xl leading-tight">
                  {activeHeroChannel.name}
                </h1>
                <p className="text-lg md:text-xl text-neutral-300 mb-8 max-w-2xl line-clamp-2 leading-relaxed drop-shadow-md">
                  Start watching the best of {activeHeroChannel.group_title || "Live TV"} right now on your personal media center.
                </p>
              </div>
            )}

            <Link
              to={`/player/${activeHeroChannel.id}`}
              state={{ from: '/channels' }}
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-black hover:bg-neutral-200 hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] font-semibold rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
            >
              <Play className="w-5 h-5 mr-2 fill-black" />
              Watch Now
            </Link>
          </div>
        </div>
      )}

      {/* Channel Groups */}
      <div className="pb-24 -mt-10 relative z-20 space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-2 pl-24 md:pl-28 pr-8 md:pr-12 custom-scrollbar">
          {availableCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
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
