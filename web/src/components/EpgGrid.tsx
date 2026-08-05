import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";

type Channel = {
  id: number;
  name: string;
  logo_url?: string;
  group_title: string;
};

type EPGEntry = {
  id: number;
  channel_id: number;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
};

const PIXELS_PER_MINUTE = 8;

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

export default function EpgGrid() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [entries, setEntries] = useState<EPGEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProgram, setSelectedProgram] = useState<{ entry: EPGEntry, channel: Channel } | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('All');

  // Calculate the current time position (updates every minute)
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Track the current hour to trigger background refreshes
  const currentHour = currentTime.getHours();

  // Dynamic guide duration (starts at 6 hours, grows as you scroll right)
  const [durationHours, setDurationHours] = useState(6);

  useEffect(() => {
    if (channels.length === 0) setLoading(true);
    // Load from 2 hours ago up to durationHours
    const now = new Date();
    const start = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const end = new Date(now.getTime() + (durationHours - 2) * 60 * 60 * 1000).toISOString();

    Promise.all([
      fetch("/api/channels").then(r => r.json()),
      fetch(`/api/epg?start=${start}&end=${end}`).then(r => r.json())
    ]).then(([chData, epgData]) => {
      setChannels(chData || []);
      setEntries(epgData || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [currentHour, durationHours]);

  const epgByChannel = useMemo(() => {
    const map: Record<number, EPGEntry[]> = {};
    entries.forEach(e => {
      if (!map[e.channel_id]) map[e.channel_id] = [];
      map[e.channel_id].push(e);
    });
    return map;
  }, [entries]);

  // Find the earliest start time across all entries to align the grid
  const gridStartTime = useMemo(() => {
    // Current time rounded down to the nearest half hour
    const earliest = new Date(currentTime);
    earliest.setMinutes(earliest.getMinutes() < 30 ? 0 : 30, 0, 0);
    // Pull it back half an hour so the current show isn't glued to the very left edge
    earliest.setMinutes(earliest.getMinutes() - 30);
    return earliest;
  }, [currentHour]);

  const currentTimeOffset = (currentTime.getTime() - gridStartTime.getTime()) / 60000;
  const currentTimePixels = Math.max(0, currentTimeOffset) * PIXELS_PER_MINUTE;

  const gridContent = useMemo(() => {
    const filteredChannels = activeCategory === 'All' 
      ? channels 
      : channels.filter(ch => mapCategory(ch.group_title) === activeCategory);

    return filteredChannels.map((ch) => {
      const chEntries = epgByChannel[ch.id] || [];
      if (chEntries.length === 0) return null; // Hide channels with no EPG data

      return (
        <div key={ch.id} className="flex group hover:bg-neutral-900/30 transition-colors border-b border-neutral-800/30 h-20">
          {/* Channel Header (Sticky Left) */}
          <div className="w-24 h-20 shrink-0 bg-neutral-950 group-hover:bg-neutral-900 sticky left-0 z-20 flex items-center justify-center border-r border-neutral-800 shadow-lg p-1">
            <Link to={`/player/${ch.id}`} className="flex items-center justify-center w-full h-full group/link" title={ch.name}>
              {ch.logo_url ? (
                <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-contain rounded" />
              ) : (
                <div className="w-full h-full rounded bg-neutral-900 flex items-center justify-center text-neutral-500 font-semibold text-xs overflow-hidden text-center leading-tight p-1">{ch.name.substring(0, 15)}</div>
              )}
            </Link>
          </div>

          {/* Programs Row */}
          <div className="flex relative items-center overflow-hidden" style={{ width: (durationHours * 2) * 30 * PIXELS_PER_MINUTE }}>
            {chEntries.map((e) => {
              const start = new Date(e.start_time);
              const end = new Date(e.end_time);
              
              const offsetMinutes = (start.getTime() - gridStartTime.getTime()) / 60000;
              const durationMinutes = (end.getTime() - start.getTime()) / 60000;
              
              if (offsetMinutes < 0 && offsetMinutes + durationMinutes <= 0) return null;

              const leftOffset = Math.max(0, offsetMinutes) * PIXELS_PER_MINUTE;
              const width = (offsetMinutes < 0 ? durationMinutes + offsetMinutes : durationMinutes) * PIXELS_PER_MINUTE;

              const isActive = currentTime >= start && currentTime < end;
              const isPast = currentTime >= end;

              let backgroundStyle = {};
              if (isActive) {
                const visibleStartMinutes = Math.max(0, offsetMinutes);
                const minutesPassedInVisibleBox = currentTimeOffset - visibleStartMinutes;
                const visibleDurationMinutes = width / PIXELS_PER_MINUTE;
                // Avoid division by zero edge case
                const percent = visibleDurationMinutes > 0 
                  ? (minutesPassedInVisibleBox / visibleDurationMinutes) * 100 
                  : 0;
                  
                backgroundStyle = {
                  background: `linear-gradient(to right, rgba(37, 99, 235, 0.25) ${percent}%, rgba(38, 38, 38, 0.8) ${percent}%)`
                };
              } else if (isPast) {
                backgroundStyle = { background: 'rgba(37, 99, 235, 0.25)' };
              } else {
                backgroundStyle = { background: 'rgba(38, 38, 38, 0.8)' };
              }

              const Wrapper: any = isActive ? Link : 'button';
              const wrapperProps: any = isActive 
                ? { to: `/player/${ch.id}` }
                : { onClick: () => setSelectedProgram({ entry: e, channel: ch }) };

              return (
                <div
                  key={e.id}
                  className="absolute h-full py-1 pr-1"
                  style={{ left: leftOffset, width }}
                >
                  <Wrapper
                    {...wrapperProps}
                    className="block text-left w-full h-full rounded-md p-2 overflow-hidden transition-all group/prog border border-transparent backdrop-blur-sm shadow-sm hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:bg-neutral-800/80 focus:outline-none"
                    style={backgroundStyle}
                  >
                    <h4 className={`font-medium text-sm truncate leading-tight mb-1 ${isActive ? 'text-blue-100 font-bold' : 'text-white'}`}>{e.title}</h4>
                    <p className={`text-xs truncate ${isActive ? 'text-blue-300' : 'text-neutral-400 group-hover/prog:text-blue-200'}`}>
                      {start.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {end.toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                    </p>
                  </Wrapper>
                </div>
              );
            })}
            
            {/* Ghost container to push width for the row if programs are absolute */}
            <div style={{ width: (durationHours * 2) * 30 * PIXELS_PER_MINUTE }} className="h-20 shrink-0 pointer-events-none" />
          </div>
        </div>
      );
    });
  }, [channels, epgByChannel, gridStartTime, currentTime, currentTimeOffset, durationHours, activeCategory]);

  const availableCategories = useMemo(() => {
    const present = new Set<string>();
    present.add('All');
    channels.forEach(ch => present.add(mapCategory(ch.group_title)));
    return CATEGORIES.filter(cat => present.has(cat));
  }, [channels]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 pl-20 bg-neutral-950 h-full">
        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (channels.length === 0 || entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 pl-20 bg-neutral-950 h-full">
        <div className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 rounded-2xl p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold mb-3 text-white">No Guide Data</h2>
          <p className="text-neutral-400 mb-6">
            Configure your XMLTV EPG source in Settings to populate the guide. You may need to load the playlist again to map the channels first.
          </p>
          <Link to="/settings" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors">
            Go to Settings
          </Link>
        </div>
      </div>
    );
  }

  // Generate time headers for the duration
  const timeHeaders = Array.from({ length: durationHours * 2 }).map((_, i) => {
    const t = new Date(gridStartTime);
    t.setMinutes(t.getMinutes() + i * 30);
    return {
      label: t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      date: t
    };
  });

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollWidth, clientWidth } = e.currentTarget;
    if (scrollLeft + clientWidth >= scrollWidth - 100) {
      setDurationHours(prev => Math.min(prev + 2, 24)); // add 2 hours when reaching the end, cap at 24
    }
  };

  return (
    <div className="flex-1 flex flex-col pl-20 bg-neutral-950 overflow-hidden h-full">
      <div className="p-6 pb-4 shrink-0 flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-white tracking-tight">Live TV Guide</h2>
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {availableCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-neutral-800/50 text-neutral-400 hover:text-white hover:bg-neutral-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto relative bg-neutral-900/20 custom-scrollbar" onScroll={handleScroll}>
        <div className="min-w-max flex flex-col">
          
          {/* Timeline Header */}
          <div className="flex sticky top-0 z-30 bg-neutral-950/95 backdrop-blur-md border-b border-neutral-800 shadow-xl">
            {/* Corner block for channel column */}
            <div className="w-24 shrink-0 border-r border-neutral-800 bg-neutral-950/95 sticky left-0 z-40 backdrop-blur-md"></div>
            
            {/* Time labels */}
            <div className="flex">
              {timeHeaders.map((th, i) => (
                <div 
                  key={i} 
                  className="shrink-0 text-sm font-semibold text-neutral-400 px-4 py-3 border-r border-neutral-800/50"
                  style={{ width: 30 * PIXELS_PER_MINUTE }}
                >
                  {th.label}
                </div>
              ))}
            </div>
            
            {/* Current Time Indicator Line (Header part) */}
            {currentTimeOffset >= 0 && currentTimeOffset <= (durationHours * 60) && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10 shadow-[0_0_8px_rgba(59,130,246,0.8)] pointer-events-none"
                style={{ left: 96 /* width of channel box */ + currentTimePixels }}
              >
                <div className="absolute -top-1 -translate-x-1/2 bg-blue-500 w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
              </div>
            )}
          </div>

          {/* Channels & Programs */}
          <div className="flex flex-col pb-24 relative">
            {/* Current Time Indicator Line (Grid part) */}
            {currentTimeOffset >= 0 && currentTimeOffset <= (durationHours * 60) && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-blue-500/80 z-10 shadow-[0_0_8px_rgba(59,130,246,0.5)] pointer-events-none"
                style={{ left: 96 /* width of channel box */ + currentTimePixels }}
              ></div>
            )}

            {gridContent}
          </div>

        </div>
      </div>
      
      {/* Program Details Modal */}
      {selectedProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity" onClick={() => setSelectedProgram(null)}>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-neutral-800">
              <div className="flex items-center gap-4 mb-4">
                {selectedProgram.channel.logo_url && (
                  <img src={selectedProgram.channel.logo_url} alt={selectedProgram.channel.name} className="w-16 h-12 object-contain bg-white/5 rounded shrink-0" />
                )}
                <div>
                  <h3 className="text-xl font-bold text-white leading-tight">{selectedProgram.entry.title}</h3>
                  <p className="text-blue-400 font-medium text-sm mt-1">
                    {new Date(selectedProgram.entry.start_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {new Date(selectedProgram.entry.end_time).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                  </p>
                </div>
              </div>
              <p className="text-neutral-300 text-sm leading-relaxed max-h-48 overflow-y-auto custom-scrollbar pr-2">
                {selectedProgram.entry.description || "No description available for this program."}
              </p>
            </div>
            <div className="p-4 bg-neutral-950 flex justify-end gap-3">
              <button 
                onClick={() => setSelectedProgram(null)}
                className="px-5 py-2 rounded-lg font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              >
                Close
              </button>
              {new Date(selectedProgram.entry.start_time) > currentTime ? (
                <button disabled className="px-5 py-2 rounded-lg font-medium bg-blue-600/30 text-blue-300 cursor-not-allowed border border-blue-500/20">
                  Record (Coming Soon)
                </button>
              ) : (
                <button disabled className="px-5 py-2 rounded-lg font-medium bg-neutral-800/50 text-neutral-500 cursor-not-allowed border border-neutral-700/30">
                  Catch Up Unavailable
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
