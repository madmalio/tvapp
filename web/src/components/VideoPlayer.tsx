import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { ArrowLeft, Menu, X, Play, Pause, Volume2, VolumeX, Maximize, Minimize, History, Settings } from "lucide-react";
import Hls from "hls.js";
import { getApiUrl } from "../lib/api";
import { useSpeedTest, StreamQuality } from "../hooks/useSpeedTest";

type ChannelInfo = {
  id: number;
  name: string;
  stream_url: string;
  logo_url?: string;
  group_title?: string;
  tuner_type?: string;
  source_id?: number;
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

const MAX_RELOADS = 3;

export default function VideoPlayer() {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backUrl = location.state?.from || '/channels';
  const previousChannelId = location.state?.previousChannelId;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [programTitle, setProgramTitle] = useState<string>("");
  const [status, setStatus] = useState("Loading...");
  const hlsRef = useRef<Hls | null>(null);
  const reloadAttemptsRef = useRef(0);
  const positionRef = useRef(0);
  const streamSessionIdRef = useRef<string | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('tvapp_volume');
    return saved !== null ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(() => {
    const saved = localStorage.getItem('tvapp_muted');
    return saved === 'true';
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAtLiveEdge, setIsAtLiveEdge] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { preferredQuality, manuallySetQuality, speedMbps, isTesting } = useSpeedTest();
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [allChannels, setAllChannels] = useState<ChannelInfo[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [epgMap, setEpgMap] = useState<Record<number, string>>({});
  
  const [showOverlay, setShowOverlay] = useState(true);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(() => {
    setShowOverlay(true);
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = setTimeout(() => {
      setShowOverlay(false);
    }, 4000);
  }, []);

  useEffect(() => {
    handleMouseMove();
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, [handleMouseMove]);

  const getProxyUrl = useCallback(() => {
    if (!channel) return "";
    return getApiUrl(`/api/proxy?url=${encodeURIComponent(channel.stream_url)}`);
  }, [channel]);

  useEffect(() => {
    Promise.all([
      fetch(getApiUrl('/api/channels')).then(r => r.json()),
      fetch(getApiUrl(`/api/epg?start=${new Date(Date.now() - 3600000).toISOString()}&end=${new Date(Date.now() + 3600000).toISOString()}`)).then(r => r.json())
    ])
    .then(([allCh, epgData]) => {
      setAllChannels(allCh);
      const map: Record<number, string> = {};
      const now = new Date();
      if (epgData) {
        epgData.forEach((e: any) => {
          if (new Date(e.start_time) <= now && new Date(e.end_time) > now) {
            map[e.channel_id] = e.title;
          }
        });
      }
      setEpgMap(map);
    })
    .catch(console.error);
  }, []);

  useEffect(() => {
    if (!channelId) return;
    reloadAttemptsRef.current = 0;
    positionRef.current = 0;
    setIsAtLiveEdge(true);
    setIsPlaying(true);
    
    if (allChannels.length > 0) {
      const ch = allChannels.find(c => c.id === parseInt(channelId));
      if (ch) {
        setChannel(prev => prev?.id === ch.id ? prev : ch);
        const mapped = mapCategory(ch.group_title || "", ch.name || "");
        if (CATEGORIES.includes(mapped)) {
          setActiveCategory(prev => prev === mapped ? prev : mapped);
        } else {
          setActiveCategory(prev => prev === 'All' ? prev : 'All');
        }
        return;
      }
    }
    
    fetch(getApiUrl(`/api/channels/${channelId}`))
      .then(r => r.json())
      .then(ch => {
        setChannel(prev => prev?.id === ch.id ? prev : ch);
        const mapped = mapCategory(ch.group_title || "", ch.name || "");
        if (CATEGORIES.includes(mapped)) {
          setActiveCategory(prev => prev === mapped ? prev : mapped);
        } else {
          setActiveCategory(prev => prev === 'All' ? prev : 'All');
        }
      })
      .catch(() => setStatus("Channel not found"));
  }, [channelId, allChannels]);

  useEffect(() => {
    if (!channelId) return;
    const title = epgMap[parseInt(channelId)] || "";
    setProgramTitle(prev => prev === title ? prev : title);
  }, [channelId, epgMap]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    if (streamSessionIdRef.current) {
      fetch(getApiUrl(`/api/stream/stop/${streamSessionIdRef.current}`), { method: "DELETE" }).catch(console.error);
      streamSessionIdRef.current = null;
    }

    const isMusic = mapCategory(channel.group_title || "", channel.name || "") === "Music";
    const shouldRunFFmpeg = channel.tuner_type === "hdhomerun" || isMusic;

    if (shouldRunFFmpeg) {
      setStatus("Starting stream...");
      fetch(getApiUrl("/api/stream/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          url: channel.stream_url, 
          tuner_type: channel.tuner_type, 
          quality: channel.tuner_type === "hdhomerun" ? preferredQuality : (isMusic ? "music" : preferredQuality)
        })
      })
      .then(r => {
        if (!r.ok) throw new Error("Failed to start stream");
        return r.json();
      })
      .then(data => {
        streamSessionIdRef.current = data.id;
        startPlayback(video, getApiUrl(data.manifest_url));
      })
      .catch(err => {
        console.error(err);
        setStatus("Stream error");
      });
    } else {
      startPlayback(video, getProxyUrl());
    }
    function onTimeUpdate() {
      positionRef.current = video?.currentTime || 0;
    }
    video.addEventListener("timeupdate", onTimeUpdate);

    function startPlayback(v: HTMLVideoElement, url: string) {
      if (!url) return;
      setStatus("Loading...");

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true, // Offload remuxing to a web worker to prevent UI blocking/micro-pauses
          maxBufferLength: 90, // Buffer up to 90 seconds ahead
          maxMaxBufferLength: 180, // Allow large buffers if network is unstable
          maxBufferSize: 60 * 1024 * 1024, // 60MB max memory buffer
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 4,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 4,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 6,
          liveSyncDurationCount: 3, // Standard 12s HLS latency
          liveMaxLatencyDurationCount: 15,
          stretchShortVideoTrack: true,
          maxAudioFramesDrift: 100000,
          appendErrorMaxRetry: 3,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(v);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus("");
          const pos = positionRef.current;
          if (pos > 0) {
            v.currentTime = pos;
            positionRef.current = 0;
          }
          v.play().catch(() => setStatus("Play button required"));
        });

        hls.on(Hls.Events.ERROR, (_e, err) => {
          console.error("[hls]", err.type, err.details, err.fatal ? "FATAL" : "", err.url || "");
          if (err.fatal && reloadAttemptsRef.current < MAX_RELOADS) {
            reloadAttemptsRef.current++;
            console.log(`[hls] recovering (attempt ${reloadAttemptsRef.current}/${MAX_RELOADS})`);
            setStatus("Recovering...");
            positionRef.current = 0;
            const oldHls = hlsRef.current;
            hlsRef.current = null;
            if (oldHls) oldHls.destroy();
            
            // Fetch fresh session token before restarting
            setTimeout(() => {
              if (!channelId) return;
              fetch(getApiUrl(`/api/channels/${channelId}?force=true`))
                .then((r) => r.json())
                .then((ch) => setChannel(ch))
                .catch(() => startPlayback(v, getProxyUrl())); // Fallback to current URL if fetch fails
            }, 2000);
          } else if (err.fatal) {
            hls.destroy();
            hlsRef.current = null;
            setStatus("Playback failed");
            v.src = url;
            v.play().catch(() => {});
          }
        });
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = url;
        v.addEventListener("loadedmetadata", () => {
          setStatus("");
          v.play().then(() => setIsPlaying(true)).catch(() => setStatus("Play button required"));
        });
      } else {
        v.src = url;
        v.play().then(() => setIsPlaying(true)).catch(() => setStatus("Play button required"));
      }
    }

    return () => {
      if (streamSessionIdRef.current) {
        fetch(getApiUrl(`/api/stream/stop/${streamSessionIdRef.current}`), { method: "DELETE" }).catch(console.error);
        streamSessionIdRef.current = null;
      }
      const hls = hlsRef.current;
      hlsRef.current = null;
      if (hls) {
        hls.detachMedia();
        hls.destroy();
      }
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeAttribute('src');
      video.load();
    };
  }, [channel, preferredQuality, getProxyUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
    localStorage.setItem('tvapp_volume', volume.toString());
    localStorage.setItem('tvapp_muted', isMuted.toString());
  }, [volume, isMuted]);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleFullscreen = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        console.error("Error attempting to enable fullscreen:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const jumpToLive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    
    let edge: number | null = null;
    if (hlsRef.current) {
      edge = hlsRef.current.liveSyncPosition;
    } else if (video.seekable && video.seekable.length > 0) {
      edge = video.seekable.end(video.seekable.length - 1);
    }

    if (edge !== null) {
      video.currentTime = edge;
      setIsAtLiveEdge(true);
      if (video.paused) {
        video.play().then(() => setIsPlaying(true)).catch(console.error);
      }
    }
  }, []);

  const currentSourceId = channel?.source_id;
  const sourceChannels = useMemo(() => {
    if (!currentSourceId) return allChannels;
    return allChannels.filter(c => c.source_id === currentSourceId);
  }, [allChannels, currentSourceId]);

  const availableCategories = useMemo(() => {
    return CATEGORIES.filter(cat => 
      cat === 'All' || sourceChannels.some(ch => mapCategory(ch.group_title || "", ch.name || "") === cat)
    );
  }, [sourceChannels]);

  const filteredChannels = useMemo(() => {
    return activeCategory === 'All' 
      ? sourceChannels 
      : sourceChannels.filter(ch => mapCategory(ch.group_title || "", ch.name || "") === activeCategory);
  }, [sourceChannels, activeCategory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (!channelId || filteredChannels.length === 0) return;
        
        const currentIndex = filteredChannels.findIndex(ch => ch.id === parseInt(channelId));
        if (currentIndex === -1) return;

        let newIndex = currentIndex;
        if (e.key === 'ArrowUp') {
          // Channel Up (next index in list)
          newIndex = currentIndex < filteredChannels.length - 1 ? currentIndex + 1 : 0;
        } else if (e.key === 'ArrowDown') {
          // Channel Down (previous index in list)
          newIndex = currentIndex > 0 ? currentIndex - 1 : filteredChannels.length - 1;
        }

        const newChannel = filteredChannels[newIndex];
        if (newChannel) {
          navigate(`/player/${newChannel.id}`, {
            state: { ...location.state, previousChannelId: channelId }
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [channelId, filteredChannels, navigate, location.state]);

  return (
    <div 
      ref={containerRef}
      className="flex-1 flex flex-col bg-black relative overflow-hidden cursor-default group"
      onMouseMove={handleMouseMove}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black z-0"
        autoPlay
        playsInline
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          setIsAtLiveEdge(false);
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setIsMuted(e.currentTarget.muted);
        }}
      />

      {/* Status Overlays */}
      {status === "Loading..." || status === "Recovering..." || status === "Starting stream..." ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 bg-black">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
            <p className="text-white font-medium drop-shadow-md">{status}</p>
          </div>
        </div>
      ) : status ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <p className="text-white font-medium bg-red-600/90 backdrop-blur-md px-6 py-2 rounded-full shadow-lg">
            {status}
          </p>
        </div>
      ) : null}

      {/* Cinematic Overlays (Auto hides) */}
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 z-10 flex flex-col justify-between ${
          showOverlay ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-48 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-start p-6 md:p-8">
          {channel && (
            <div className="pointer-events-auto flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={(e) => { e.stopPropagation(); navigate(backUrl); }}
                className="p-3 bg-neutral-900/50 hover:bg-neutral-800 text-white rounded-full backdrop-blur-sm transition-colors flex items-center justify-center mr-2 shadow-lg cursor-pointer"
                title="Exit Player"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              {channel.logo_url && (
                <img 
                  src={channel.logo_url} 
                  alt={channel.name}
                  className="h-12 md:h-14 object-contain drop-shadow-xl"
                />
              )}
              <div>
                <h2 className="text-2xl md:text-4xl font-bold text-white tracking-tight drop-shadow-lg">
                  {programTitle || channel.name}
                </h2>
              </div>
            </div>
          )}
        </div>

        {/* Custom Bottom Controls */}
        <div className="h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-end p-6 md:p-8">
          <div className="w-full flex items-center justify-between pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-4 md:gap-6">
              <button 
                onClick={togglePlay} 
                className="text-white hover:text-blue-400 transition-colors focus:outline-none"
              >
                {isPlaying ? <Pause className="w-8 h-8 md:w-10 md:h-10 fill-current" /> : <Play className="w-8 h-8 md:w-10 md:h-10 fill-current" />}
              </button>
              
              <button 
                onClick={jumpToLive}
                className={`flex items-center gap-2 transition-colors focus:outline-none ${isAtLiveEdge ? 'text-white/90' : 'text-neutral-500 hover:text-white cursor-pointer'}`}
                title="Jump to Live"
              >
                <span className={`w-2 h-2 rounded-full ${isAtLiveEdge ? 'bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)] animate-pulse' : 'bg-neutral-600'}`}></span>
                <span className="font-bold text-sm tracking-wider">LIVE</span>
              </button>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
              <div className="hidden md:flex items-center gap-3 group/volume mr-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                  className="text-white hover:text-blue-400 transition-colors focus:outline-none"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                </button>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.05" 
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    e.stopPropagation();
                    const val = parseFloat(e.target.value);
                    setVolume(val);
                    if (val > 0) setIsMuted(false);
                  }}
                  className="w-20 md:w-24 h-1.5 md:h-2 bg-neutral-600 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 md:[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-3 md:[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                />
              </div>

              {channel?.tuner_type === "hdhomerun" && (
                <div className="relative">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowQualityMenu(!showQualityMenu); }}
                    className="text-white hover:text-blue-400 transition-colors focus:outline-none p-2 rounded-full"
                    title="Stream Quality"
                  >
                    <Settings className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                  
                  {showQualityMenu && (
                    <div 
                      className="absolute bottom-full right-0 mb-4 w-56 bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/50 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-50 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="text-xs font-semibold text-neutral-400 px-3 py-2 uppercase tracking-wider">
                        Quality {isTesting ? "(Testing network...)" : (speedMbps ? `(Auto: ${Math.round(speedMbps)} Mbps)` : "")}
                      </div>
                      {(['source', '1080p_high', '1080p_std', '720p_high', '720p_std', '480p_high', '480p_std', '360p_low'] as StreamQuality[]).map((q) => (
                        <button
                          key={q}
                          onClick={(e) => {
                            e.stopPropagation();
                            manuallySetQuality(q);
                            setShowQualityMenu(false);
                          }}
                          className={`px-3 py-2 text-sm text-left rounded-xl transition-colors ${
                            preferredQuality === q 
                              ? 'bg-blue-600 text-white font-medium' 
                              : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                          }`}
                        >
                          {q === 'source' ? 'Source (Original)' : q.replace('_', ' ').toUpperCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Last Channel Button */}
              {previousChannelId && (
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    navigate(`/player/${previousChannelId}`, { state: { ...location.state, previousChannelId: channelId } }); 
                  }}
                  className="p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none mr-1"
                  title="Last Channel"
                >
                  <History className="w-6 h-6" />
                </button>
              )}

              {/* More Channels integrated into controls */}
              <button 
                onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
                className="p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none"
                title="More Channels"
              >
                <Menu className="w-6 h-6" />
              </button>

              <button 
                onClick={toggleFullscreen}
                className="text-white hover:text-blue-400 transition-colors p-2 focus:outline-none"
              >
                {isFullscreen ? <Minimize className="w-7 h-7" /> : <Maximize className="w-7 h-7" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-out Drawer */}
      <div 
        className={`absolute inset-y-0 right-0 w-80 md:w-96 bg-neutral-950/95 backdrop-blur-xl border-l border-neutral-800 z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
      >
        <div className="p-6 border-b border-neutral-800/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-xl text-white">Channels</h3>
            <button onClick={() => setDrawerOpen(false)} className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="flex overflow-x-auto gap-2 pb-2 custom-scrollbar pointer-events-auto">
            {availableCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? "bg-white text-black"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {filteredChannels.map(ch => (
            <Link 
              key={ch.id}
              to={`/player/${ch.id}`}
              state={{ ...location.state, previousChannelId: channelId }}
              onClick={() => setDrawerOpen(false)}
              className={`flex items-center gap-4 p-3 rounded-xl transition-all duration-200 group hover:bg-neutral-800/80 hover:scale-[1.02] ${
                ch.id === parseInt(channelId || '0') 
                  ? 'bg-blue-900/20 border border-blue-500/30' 
                  : 'border border-transparent'
              }`}
            >
              <div className="w-14 h-14 shrink-0 bg-neutral-900 rounded-lg p-1.5 flex items-center justify-center shadow-inner">
                {ch.logo_url ? (
                  <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-contain drop-shadow-md" />
                ) : (
                  <span className="text-xs font-bold text-neutral-500">{ch.name.substring(0, 3)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate text-sm ${ch.id === parseInt(channelId || '0') ? 'text-blue-400' : 'text-neutral-200 group-hover:text-white'}`}>
                  {epgMap[ch.id] || "No Data"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
