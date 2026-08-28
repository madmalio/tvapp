import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { 
  ArrowLeft, 
  Menu, 
  X, 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Minimize, 
  History, 
  Settings,
  PictureInPicture2,
  Video,
  Maximize2
} from "lucide-react";
import Hls from "hls.js";
import { getApiUrl, fetchWithCache } from "../lib/api";
import { useSpeedTest, StreamQuality } from "../hooks/useSpeedTest";
import { lockToLandscape, unlockScreenOrientation } from "../lib/orientation";
import { usePlayer, ChannelInfo, CameraInfo } from "../context/PlayerContext";
import { useApi } from "../hooks/useApi";
import { acquireCameraStream, releaseCameraStream, getActiveStream, CameraState } from "./Cameras";

const CATEGORIES = ['All', 'Movies', 'News', 'Sports', 'Kids', 'Entertainment', 'Docs & Learning', 'Music', 'Local', 'Other'];

function mapCategory(rawGroup: string, channelName: string = ""): string {
  const lowerGroup = (rawGroup || "").toLowerCase();
  const lowerName = (channelName || "").toLowerCase();
  const target = lowerGroup ? `${lowerGroup} ${lowerName}` : lowerName;

  if (target.match(/movie|cinema|film|box office|hbo|cinemax|starz|tcm|showtime|amc|paramount/)) return 'Movies';
  if (target.match(/news|weather|breaking|journal|cnn|fox news|msnbc|bbc|bloomberg|cnbc/)) return 'News';
  if (target.match(/sport|espn|nfl|nba|mlb|nhl|wwe|racing|golf|tennis|nascar|ufc|boxing/)) return 'Sports';
  if (target.match(/kid|child|family|animation|cartoon|disney|nick|pbs kids/)) return 'Kids';
  if (target.match(/music|mtv|vh1|concert|radio|vevo/)) return 'Music';
  if (target.match(/doc|history|science|discovery|nature|learning|animal planet|nat geo/)) return 'Docs & Learning';
  if (target.match(/nbc|abc|cbs|fox|cw|pbs|local|us|uk|region|city/)) return 'Local';
  if (target.match(/comedy|drama|reality|tv show|sitcom|entertainment/)) return 'Entertainment';
  
  return 'Other';
}

const MAX_RELOADS = 3;

// =========================================================
// Pinned Camera PiP Overlay inside TV Player
// =========================================================
function PinnedCameraOverlay({
  camera,
  allCameras,
  onSwitchCamera,
  onClose,
  onExpand,
}: {
  camera: CameraInfo;
  allCameras: CameraInfo[];
  onSwitchCamera: (cam: CameraInfo) => void;
  onClose: () => void;
  onExpand: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>("connecting");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const subId = `pip-${camera.id}`;;
    let isMounted = true;

    // Check if stream already exists in memory
    const cached = getActiveStream(camera.id);
    if (cached && cached.mediaStream.getTracks().length > 0) {
      video.srcObject = cached.mediaStream;
      video.muted = true;
      video.play().then(() => {
        if (isMounted) setCameraState("connected");
      }).catch(() => {});
    }

    acquireCameraStream(
      camera as any,
      subId,
      (stream) => {
        if (isMounted && video) {
          video.srcObject = stream;
          video.muted = true;
          video.play().then(() => {
            if (isMounted) setCameraState("connected");
          }).catch(() => {});
        }
      },
      (state) => {
        if (isMounted) setCameraState(state);
      }
    );

    return () => {
      isMounted = false;
      releaseCameraStream(camera.id, subId);
    };
  }, [camera]);

  return (
    <div
      className="absolute top-16 right-4 sm:top-20 sm:right-8 z-30 w-52 sm:w-72 aspect-video rounded-xl overflow-hidden shadow-2xl border-2 border-blue-500/80 bg-black group/pin select-none transition-all"
      onClick={(e) => e.stopPropagation()}
    >
      <video ref={videoRef} className="w-full h-full object-contain bg-black pointer-events-none" autoPlay playsInline muted />
      
      {/* Header Bar */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/80 opacity-0 group-hover/pin:opacity-100 transition-opacity p-2 flex flex-col justify-between">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] sm:text-xs font-bold text-white truncate drop-shadow">{camera.name}</span>
          <div className="flex items-center gap-1">
            {allCameras.length > 1 && (
              <button onClick={() => setShowMenu(!showMenu)} className="p-1 rounded bg-black/60 hover:bg-neutral-800 text-white" title="Switch Camera">
                <Video className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onExpand} className="p-1 rounded bg-black/60 hover:bg-neutral-800 text-white" title="Open Full Camera">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1 rounded bg-black/60 hover:bg-red-900 text-red-400" title="Close Camera PiP">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        {/* Live Badge */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm self-start">
          <span className={`w-1.5 h-1.5 rounded-full ${cameraState === 'connected' ? 'bg-red-500 animate-pulse' : cameraState === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-neutral-500'}`} />
          <span className="text-[9px] font-bold text-white tracking-wider">
            {cameraState === 'connected' ? 'LIVE' : cameraState === 'connecting' ? 'CONNECT' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {showMenu && (
        <div className="absolute inset-0 bg-neutral-950/95 p-2 overflow-y-auto custom-scrollbar z-40 flex flex-col gap-1">
          <div className="text-[11px] font-bold text-neutral-400 mb-1">Select Camera</div>
          {allCameras.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSwitchCamera(c); setShowMenu(false); }}
              className={`text-left text-xs p-1.5 rounded transition-colors ${c.id === camera.id ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-neutral-800'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundCameraPreloader({ camera }: { camera: CameraInfo }) {
  useEffect(() => {
    const subId = `preloader-${camera.id}`;
    acquireCameraStream(
      camera as any,
      subId,
      () => {}, 
      () => {}
    );
    return () => releaseCameraStream(camera.id, subId);
  }, [camera]);
  return null;
}


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
  
  const { playChannel, cameraPipEnabled, pipCamera, setPipCamera } = usePlayer();
  const [showCameraMenu, setShowCameraMenu] = useState(false);
  const { data: sources } = useApi<CameraInfo[]>("/api/sources");
  const rtspCameras = useMemo(() => sources?.filter(s => s.type === "rtsp") || [], [sources]);

  const [lastPipCamera, setLastPipCamera] = useState<CameraInfo | null>(null);
  useEffect(() => {
    if (pipCamera) setLastPipCamera(pipCamera);
  }, [pipCamera]);
  
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

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const toggleNativePip = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
      } else if (typeof (video as any).webkitSetPresentationMode === 'function') {
        const current = (video as any).webkitPresentationMode;
        (video as any).webkitSetPresentationMode(current === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      }
    } catch (err) {
      console.warn("Native PiP error:", err);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLeavePiP = () => {
      if (isPlaying) {
        // Prevent browser from automatically pausing when closing PiP via 'X'
        // We use a small timeout because the browser often issues the pause() command AFTER this event
        setTimeout(() => {
          const v = videoRef.current;
          if (v && v.paused) {
            v.play().then(() => {
              setIsPlaying(true);
              if (isAtLiveEdge) {
                let edge: number | null = null;
                if (hlsRef.current) {
                  edge = hlsRef.current.liveSyncPosition;
                } else if (v.seekable && v.seekable.length > 0) {
                  edge = v.seekable.end(v.seekable.length - 1);
                }
                if (edge !== null) {
                  v.currentTime = edge;
                }
              }
            }).catch(() => {});
          }
        }, 10);
      }
    };
    
    video.addEventListener('leavepictureinpicture', handleLeavePiP);
    return () => video.removeEventListener('leavepictureinpicture', handleLeavePiP);
  }, [isPlaying, isAtLiveEdge]);

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
    const now = new Date();
    now.setMinutes(0, 0, 0); // Align to the start of the hour for stable cache keys
    const start = new Date(now.getTime() - 3600000).toISOString();
    const end = new Date(now.getTime() + 3600000).toISOString();

    Promise.all([
      fetchWithCache(getApiUrl('/api/channels')),
      fetchWithCache(getApiUrl(`/api/epg?start=${start}&end=${end}`))
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
        playChannel(ch);
        const mapped = mapCategory(ch.group_title || "", ch.name || "");
        if (CATEGORIES.includes(mapped)) {
          setActiveCategory(prev => prev === mapped ? prev : mapped);
        } else {
          setActiveCategory(prev => prev === 'All' ? prev : 'All');
        }
        return;
      }
    }
    
    fetchWithCache(getApiUrl(`/api/channels/${channelId}`))
      .then(ch => {
        setChannel(prev => prev?.id === ch.id ? prev : ch);
        playChannel(ch);
        const mapped = mapCategory(ch.group_title || "", ch.name || "");
        if (CATEGORIES.includes(mapped)) {
          setActiveCategory(prev => prev === mapped ? prev : mapped);
        } else {
          setActiveCategory(prev => prev === 'All' ? prev : 'All');
        }
      })
      .catch(() => setStatus("Channel not found"));
  }, [channelId, allChannels, playChannel]);

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

    const category = mapCategory(channel.group_title || "", channel.name || "");
    const isMusic = category === "Music";
    const isNews = category === "News";
    const isSports = category === "Sports";
    
    // FFmpeg cleanly handles the heavy ad-insertion discontinuities (#EXT-X-DISCONTINUITY) 
    // that plague PlutoTV News/Sports, and fixes audio drift on Music channels.
    const shouldRunFFmpeg = channel.tuner_type === "hdhomerun" || isMusic || isNews || isSports;

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

  // Automatic landscape orientation on mount & restore on unmount
  useEffect(() => {
    lockToLandscape(containerRef.current, videoRef.current);
    return () => {
      unlockScreenOrientation();
    };
  }, []);

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    lockToLandscape(containerRef.current, videoRef.current);
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(console.error);
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
      lockToLandscape(container, videoRef.current);
    } else {
      document.exitFullscreen().catch(console.error);
      unlockScreenOrientation();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (isFull) {
        lockToLandscape(containerRef.current, videoRef.current);
      }
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
      onClick={handleMouseMove}
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

      {/* Pinned Security Camera PiP Overlay */}
      {!isMobile && cameraPipEnabled && !pipCamera && rtspCameras.length > 0 && (
        <BackgroundCameraPreloader camera={lastPipCamera || rtspCameras[0]} />
      )}
      {!isMobile && pipCamera && (
        <PinnedCameraOverlay
          camera={pipCamera}
          allCameras={rtspCameras}
          onSwitchCamera={(c) => setPipCamera(c)}
          onClose={() => setPipCamera(null)}
          onExpand={() => navigate(`/cameras/${pipCamera.id}`)}
        />
      )}

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
          <p className={`text-white font-medium backdrop-blur-md px-6 py-2 rounded-full shadow-lg transition-all duration-300 ${status.toLowerCase().includes('error') || status.toLowerCase().includes('fail') ? 'bg-red-600/90' : 'bg-neutral-900/80 border border-neutral-700'}`}>
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
        <div className="h-auto min-h-[4.5rem] sm:h-44 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-start p-3 sm:p-6 md:p-8 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          {channel && (
            <div className="pointer-events-auto flex items-center gap-2 sm:gap-4 max-w-full min-w-0" onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={(e) => { e.stopPropagation(); navigate(backUrl); }}
                className="p-2 sm:p-3 bg-neutral-900/50 hover:bg-neutral-800 text-white rounded-full backdrop-blur-sm transition-colors flex items-center justify-center shrink-0 shadow-lg cursor-pointer"
                title="Exit Player"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              {channel.logo_url && (
                <img 
                  src={channel.logo_url} 
                  alt={channel.name}
                  className="h-7 sm:h-12 md:h-14 object-contain drop-shadow-xl shrink-0"
                />
              )}
              <div className="min-w-0">
                <h2 className="text-base sm:text-2xl md:text-4xl font-bold text-white tracking-tight drop-shadow-lg truncate">
                  {programTitle || channel.name}
                </h2>
              </div>
            </div>
          )}
        </div>

        {/* Custom Bottom Controls */}
        <div className="h-auto min-h-[4.5rem] sm:h-44 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-end p-3 sm:p-6 md:p-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          <div className="w-full flex items-center justify-between gap-1 sm:gap-3 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <button 
                onClick={togglePlay} 
                className="text-white hover:text-blue-400 transition-colors focus:outline-none cursor-pointer p-1"
              >
                {isPlaying ? <Pause className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 fill-current" /> : <Play className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 fill-current" />}
              </button>
              
              <button 
                onClick={jumpToLive}
                className={`flex items-center gap-1 sm:gap-2 transition-colors focus:outline-none cursor-pointer ${isAtLiveEdge ? 'text-white/90' : 'text-neutral-500 hover:text-white'}`}
                title="Jump to Live"
              >
                <span className={`w-2 h-2 rounded-full ${isAtLiveEdge ? 'bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)] animate-pulse' : 'bg-neutral-600'}`}></span>
                <span className="font-bold text-[11px] sm:text-sm tracking-wider">LIVE</span>
              </button>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-2 md:gap-4 shrink-0">
              <div className="flex items-center gap-1 sm:gap-3 group/volume">
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }}
                  className="text-white hover:text-blue-400 transition-colors focus:outline-none cursor-pointer p-1.5 sm:p-2"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" /> : <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />}
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
                  style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(isMuted ? 0 : volume) * 100}%, #525252 ${(isMuted ? 0 : volume) * 100}%, #525252 100%)`
                  }}
                  className="hidden sm:block w-20 md:w-24 h-1.5 md:h-2 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 md:[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-3 md:[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                />
              </div>

              {channel?.tuner_type === "hdhomerun" && (
                <div className="relative">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowQualityMenu(!showQualityMenu); }}
                    className="text-white hover:text-blue-400 transition-colors focus:outline-none p-1.5 sm:p-2 rounded-full cursor-pointer"
                    title="Stream Quality"
                  >
                    <Settings className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                  
                  {showQualityMenu && (
                    <div 
                      className="absolute bottom-full right-0 mb-4 w-52 sm:w-56 bg-neutral-900/95 backdrop-blur-xl border border-neutral-700/50 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 z-50 pointer-events-auto"
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
                          className={`px-3 py-2 text-sm text-left rounded-xl transition-colors cursor-pointer ${
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
                  className="p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
                  title="Last Channel"
                >
                  <History className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}

              {/* Security Camera PiP Overlay Toggle */}
              {!isMobile && cameraPipEnabled && rtspCameras.length > 0 && (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pipCamera) {
                        setPipCamera(null);
                        setShowCameraMenu(false);
                      } else if (rtspCameras.length === 1) {
                        setPipCamera(rtspCameras[0]);
                      } else {
                        setShowCameraMenu(!showCameraMenu);
                      }
                    }}
                    className={`p-1.5 sm:p-2 rounded-full transition-colors flex items-center justify-center focus:outline-none cursor-pointer ${
                      pipCamera ? "text-blue-400 bg-blue-600/20" : "text-white hover:text-blue-400"
                    }`}
                    title={pipCamera ? "Close Camera PiP" : "Camera Picture-in-Picture"}
                  >
                    <Video className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>

                  {showCameraMenu && !pipCamera && (
                    <div 
                      className="absolute bottom-full right-0 mb-3 w-48 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="text-[11px] font-bold text-neutral-400 px-2 py-1 uppercase tracking-wider">
                        Pin Camera
                      </div>
                      {rtspCameras.map((cam) => (
                        <button
                          key={cam.id}
                          onClick={() => {
                            setPipCamera(cam);
                            setShowCameraMenu(false);
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-blue-600 hover:text-white rounded-lg transition-colors truncate cursor-pointer"
                        >
                          {cam.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Native OS Picture in Picture (Desktop only) */}
              {!isMobile && (
                <button
                  onClick={toggleNativePip}
                  className="hidden md:flex p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors items-center justify-center focus:outline-none cursor-pointer"
                  title="Picture in Picture"
                >
                  <PictureInPicture2 className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}

              {/* More Channels integrated into controls */}
              <button 
                onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
                className="p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
                title="More Channels"
              >
                <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>

              <button 
                onClick={toggleFullscreen}
                className="text-white hover:text-blue-400 transition-colors p-1.5 sm:p-2 focus:outline-none cursor-pointer"
              >
                {isFullscreen ? <Minimize className="w-5 h-5 sm:w-7 sm:h-7" /> : <Maximize className="w-5 h-5 sm:w-7 sm:h-7" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-out Drawer */}
      <div 
        className={`absolute inset-y-0 right-0 w-full max-w-xs sm:w-80 md:w-96 bg-neutral-950/95 backdrop-blur-xl border-l border-neutral-800 z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
      >
        <div className="p-4 sm:p-6 border-b border-neutral-800/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between mb-2 sm:mb-4">
            <h3 className="font-bold text-lg sm:text-xl text-white">Channels</h3>
            <button onClick={() => setDrawerOpen(false)} className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors cursor-pointer">
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
          
          <div className={`flex overflow-x-auto gap-2 pb-2 pointer-events-auto ${isMobile ? 'no-scrollbar' : 'custom-scrollbar'}`}>
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



