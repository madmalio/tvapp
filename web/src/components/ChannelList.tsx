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

function ChannelCarousel({ groupName, channels }: { groupName: string; channels: Channel[] }) {
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
            className="group relative flex-none w-[280px] aspect-video bg-neutral-900 rounded-xl overflow-hidden snap-start transition-all duration-300 hover:scale-105 hover:z-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-neutral-950 shadow-lg hover:shadow-blue-500/20"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity z-10" />
            
            <div className="absolute inset-0 flex items-center justify-center p-6">
              {ch.logo_url ? (
                <img
                  src={ch.logo_url}
                  alt={ch.name}
                  className="w-full h-full object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-110"
                />
              ) : (
                <span className="text-5xl text-neutral-600 group-hover:text-neutral-400 transition-colors">📺</span>
              )}
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 p-4 z-20 translate-y-2 group-hover:translate-y-0 transition-transform">
              <p className="text-white font-medium truncate text-lg drop-shadow-md">{ch.name}</p>
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

  const { heroChannel, groupedChannels } = useMemo(() => {
    if (channels.length === 0) return { heroChannel: null, groupedChannels: {} };
    const hero = channels.find(c => c.logo_url) || channels[0];
    const groups: Record<string, Channel[]> = {};
    
    channels.forEach(ch => {
      const group = ch.group_title || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(ch);
    });
    
    return { heroChannel: hero, groupedChannels: groups };
  }, [channels]);

  if (loading) {
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
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative no-scrollbar">
      {/* Hero Section */}
      {heroChannel && (
        <div className="relative h-[60vh] min-h-[400px] w-full flex items-end pb-12 pr-8 md:pr-12 pl-24 md:pl-28 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/40 to-neutral-900/20 mix-blend-overlay" />
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/60 to-transparent" />
          
          <div className="relative z-10 max-w-2xl">
            {heroChannel.logo_url && (
              <img src={heroChannel.logo_url} alt="Logo" className="h-20 mb-6 object-contain" />
            )}
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-4 tracking-tight">
              {heroChannel.name}
            </h1>
            <p className="text-lg text-neutral-300 mb-8 max-w-xl line-clamp-2">
              Start watching the best of {heroChannel.group_title || "Live TV"} right now on your personal media center.
            </p>
            <Link
              to={`/player/${heroChannel.id}`}
              className="inline-flex items-center justify-center px-8 py-4 bg-white text-black hover:bg-neutral-200 font-semibold rounded-full transition-transform hover:scale-105 active:scale-95"
            >
              <Play className="w-5 h-5 mr-2 fill-black" />
              Watch Now
            </Link>
          </div>
        </div>
      )}

      {/* Channel Groups */}
      <div className="pb-24 -mt-8 relative z-20 space-y-12">
        {Object.entries(groupedChannels).map(([groupName, groupChannels]) => (
          <ChannelCarousel key={groupName} groupName={groupName} channels={groupChannels} />
        ))}
      </div>
    </div>
  );
}
