import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getApiUrl } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { 
  ArrowLeft, 
  Menu, 
  X, 
  Maximize, 
  Minimize, 
  Video, 
  VideoOff,
  RotateCw,
  Volume2, 
  VolumeX,
  Play,
  Pause,
  PictureInPicture2
} from "lucide-react";
import { lockToLandscape, unlockScreenOrientation } from "../lib/orientation";
import { usePlayer } from "../context/PlayerContext";

type SourceRow = {
  id: number;
  name: string;
  type: string;
  url: string;
  epg_url?: string;
};

// =========================================================
// Global In-Memory Camera Stream Cache for 0ms transitions & Auto-Recovery
// =========================================================
export type CameraState = "connecting" | "connected" | "offline";

type CachedStream = {
  source: SourceRow;
  mediaStream: MediaStream;
  pc?: RTCPeerConnection;
  streamId?: string;
  sessionId?: string;
  subscribers: Map<string, (stream: MediaStream) => void>;
  stateSubscribers: Map<string, (state: CameraState) => void>;
  state: CameraState;
  connected: boolean;
  connecting: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
};

const cameraStreamCache = new Map<number, CachedStream>();

function setStreamState(entry: CachedStream, state: CameraState) {
  entry.state = state;
  entry.stateSubscribers.forEach((cb) => cb(state));
}

// Global heartbeat for all active camera streams
if (typeof window !== "undefined") {
  setInterval(() => {
    cameraStreamCache.forEach((entry) => {
      if (entry.streamId && entry.subscribers.size > 0 && entry.connected) {
        fetch(getApiUrl(`/api/stream/heartbeat/${entry.streamId}`)).catch(() => {});
      }
    });
  }, 25000);
}

export function getActiveStream(sourceId: number): CachedStream | undefined {
  const entry = cameraStreamCache.get(sourceId);
  if (
    entry &&
    entry.connected &&
    entry.mediaStream &&
    entry.mediaStream.getTracks().some((t) => t.readyState === "live") &&
    entry.pc &&
    entry.pc.connectionState !== "closed" &&
    entry.pc.connectionState !== "failed" &&
    entry.pc.connectionState !== "disconnected"
  ) {
    return entry;
  }
  return undefined;
}

function cleanupPeerConnection(entry: CachedStream) {
  if (entry.pc) {
    try {
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    } catch {}
    entry.pc = undefined;
  }
  if (entry.mediaStream) {
    try {
      entry.mediaStream.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
    } catch {}
    entry.mediaStream = new MediaStream();
  }
  entry.connected = false;
  entry.connecting = false;
}

function stopCameraSession(entry: CachedStream) {
  cleanupPeerConnection(entry);
  if (entry.sessionId) {
    fetch(getApiUrl(`/api/stream/stop/${entry.sessionId}`), { method: "DELETE" }).catch(() => {});
    entry.sessionId = undefined;
    entry.streamId = undefined;
  }
}

function getWebrtcUrl(streamId: string): string {
  const serverIp = localStorage.getItem('tvapp_server_ip') || '';
  if (serverIp) {
    try {
      const url = serverIp.startsWith('http') ? new URL(serverIp) : new URL(`http://${serverIp}`);
      return `http://${url.hostname}:8889/${streamId}/whep`;
    } catch {}
  }
  return `http://${window.location.hostname}:8889/${streamId}/whep`;
}

async function startCameraConnection(entry: CachedStream) {
  if (entry.connecting || entry.subscribers.size === 0) return;
  entry.connecting = true;
  setStreamState(entry, "connecting");

  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = undefined;
  }

  // Clean up any stale peer connection first
  cleanupPeerConnection(entry);
  entry.connecting = true;

  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    entry.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      if (!entry.mediaStream.getTracks().some(t => t.id === event.track.id)) {
        entry.mediaStream.addTrack(event.track);
        setStreamState(entry, "connected");
        entry.subscribers.forEach((cb) => cb(entry.mediaStream));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        cleanupPeerConnection(entry);
        setStreamState(entry, "offline");
        scheduleRetry(entry, 8000);
      }
    };

    // Ensure backend stream session is active
    let streamId = entry.streamId;
    if (!streamId) {
      const startRes = await fetch(getApiUrl("/api/stream/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: entry.source.url, tuner_type: "rtsp", quality: "720p_std" }),
      });
      if (!startRes.ok) {
        throw new Error(`Start stream HTTP ${startRes.status}`);
      }
      const startData = await startRes.json();
      streamId = startData.id;
      entry.streamId = streamId;
      entry.sessionId = streamId;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // WHEP handshake loop (retries up to 25 times, 350ms delay)
    let connected = false;
    let attempts = 0;
    while (!connected && attempts < 25 && entry.subscribers.size > 0 && entry.connecting) {
      attempts++;
      try {
        const res = await fetch(getWebrtcUrl(streamId!), {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (res.ok) {
          const answerSdp = await res.text();
          await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
          connected = true;
          entry.connected = true;
          entry.connecting = false;
          setStreamState(entry, "connected");
          entry.subscribers.forEach((cb) => cb(entry.mediaStream));
          return;
        }
      } catch (e) {
        // retry
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    if (!connected) {
      throw new Error("WHEP handshake timeout");
    }
  } catch (err) {
    cleanupPeerConnection(entry);
    entry.connecting = false;
    setStreamState(entry, "offline");
    scheduleRetry(entry, 8000);
  }
}

function scheduleRetry(entry: CachedStream, delayMs = 8000) {
  if (entry.subscribers.size === 0) return;
  if (entry.retryTimer) return;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = undefined;
    if (entry.subscribers.size > 0 && !entry.connected && !entry.connecting) {
      startCameraConnection(entry);
    }
  }, delayMs);
}

export function retryCameraStream(sourceId: number) {
  const entry = cameraStreamCache.get(sourceId);
  if (!entry) return;
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = undefined;
  }
  entry.connecting = false;
  startCameraConnection(entry);
}

export function acquireCameraStream(
  source: SourceRow,
  subscriberId: string,
  onStreamReady: (stream: MediaStream) => void,
  onStateChange?: (state: CameraState) => void
) {
  let entry = cameraStreamCache.get(source.id);
  if (!entry) {
    entry = {
      source,
      mediaStream: new MediaStream(),
      subscribers: new Map([[subscriberId, onStreamReady]]),
      stateSubscribers: onStateChange ? new Map([[subscriberId, onStateChange]]) : new Map(),
      state: "connecting",
      connected: false,
      connecting: false,
    };
    cameraStreamCache.set(source.id, entry);
    if (onStateChange) onStateChange("connecting");
    startCameraConnection(entry);
    return;
  }

  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = undefined;
  }

  entry.subscribers.set(subscriberId, onStreamReady);
  if (onStateChange) {
    entry.stateSubscribers.set(subscriberId, onStateChange);
    onStateChange(entry.state);
  }

  if (entry.connected && entry.mediaStream.getTracks().some(t => t.readyState === "live")) {
    onStreamReady(entry.mediaStream);
  } else {
    if (!entry.connecting) {
      startCameraConnection(entry);
    }
  }
}

export function releaseCameraStream(sourceId: number, subscriberId: string) {
  const entry = cameraStreamCache.get(sourceId);
  if (!entry) return;
  entry.subscribers.delete(subscriberId);
  entry.stateSubscribers.delete(subscriberId);

  if (entry.subscribers.size === 0) {
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer);
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = undefined;
    }
    // Keep stream in memory for 15 seconds to allow fast re-entry
    entry.cleanupTimer = setTimeout(() => {
      const current = cameraStreamCache.get(sourceId);
      if (current && current.subscribers.size === 0) {
        stopCameraSession(current);
        cameraStreamCache.delete(sourceId);
      }
    }, 15000);
  }
}

// =========================================================
// Focused Camera Player (Exact match to VideoPlayer.tsx UI)
// =========================================================
function CameraPlayerView({
  camera,
  allCameras,
  onSelectCamera,
  onClose,
}: {
  camera: SourceRow;
  allCameras: SourceRow[];
  onSelectCamera: (cam: SourceRow) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const { playCamera } = usePlayer();

  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("tvapp_camera_volume");
    return saved !== null ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(() => {
    const saved = localStorage.getItem("tvapp_camera_muted");
    return saved !== null ? saved === "true" : true;
  });

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

  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleNativePip = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      } else if (typeof (video as any).webkitSetPresentationMode === "function") {
        const current = (video as any).webkitPresentationMode;
        (video as any).webkitSetPresentationMode(current === "picture-in-picture" ? "inline" : "picture-in-picture");
      }
    } catch (err) {
      console.warn("Native PiP error:", err);
    }
  }, []);

  // Sync volume and mute directly with the HTML5 video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
    localStorage.setItem("tvapp_camera_volume", volume.toString());
    localStorage.setItem("tvapp_camera_muted", isMuted.toString());
  }, [volume, isMuted]);

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
  }, [handleMouseMove, camera]);

  // Automatic landscape orientation on focus mount & restore on unmount
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
      video.play().catch(console.error);
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

  // Keyboard navigation matching VideoPlayer.tsx (ArrowUp / ArrowDown for switching)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (allCameras.length === 0) return;
        const currentIndex = allCameras.findIndex((c) => c.id === camera.id);
        if (currentIndex === -1) return;

        let newIndex = currentIndex;
        if (e.key === "ArrowUp") {
          newIndex = currentIndex < allCameras.length - 1 ? currentIndex + 1 : 0;
        } else if (e.key === "ArrowDown") {
          newIndex = currentIndex > 0 ? currentIndex - 1 : allCameras.length - 1;
        }

        const newCam = allCameras[newIndex];
        if (newCam) {
          onSelectCamera(newCam);
        }
      } else if (e.key === "Escape" || e.key === "Backspace") {
        if (drawerOpen) {
          setDrawerOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [camera, allCameras, drawerOpen, onSelectCamera, onClose]);

  const [cameraState, setCameraState] = useState<CameraState>("connecting");

  // Acquire or reuse stream from in-memory cache
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const subId = `focus-${camera.id}`;
    let isMounted = true;
    playCamera(camera);

    // Check if stream already exists in memory (from grid or cache)
    const cached = getActiveStream(camera.id);
    if (cached && cached.mediaStream.getTracks().length > 0) {
      video.srcObject = cached.mediaStream;
      video.volume = volume;
      video.muted = isMuted;
      video.play().then(() => {
        if (isMounted) {
          
          setIsPlaying(true);
          setCameraState("connected");
        }
      }).catch(() => {
        video.muted = true;
        video.play().catch(() => {});
        if (isMounted) {
          
          setCameraState("connected");
        }
      });
    } else {
      
      setCameraState("connecting");
    }

    acquireCameraStream(
      camera,
      subId,
      (stream) => {
        if (isMounted && video) {
          video.srcObject = stream;
          video.volume = volume;
          video.muted = isMuted;
          video.play().then(() => {
            
            setIsPlaying(true);
            setCameraState("connected");
          }).catch(() => {
            video.muted = true;
            video.play().catch(() => {});
            
            setCameraState("connected");
          });
        }
      },
      (state) => {
        if (isMounted) {
          setCameraState(state);
        }
      }
    );

    return () => {
      isMounted = false;
      releaseCameraStream(camera.id, subId);
    };
  }, [camera]);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col bg-black relative overflow-hidden cursor-default group h-screen w-screen"
      onMouseMove={handleMouseMove}
      onClick={handleMouseMove}
    >
      {/* Video Display (Native HTML5 video, no iframe, no browser controls popup) */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black z-0"
        autoPlay
        playsInline
        onPlay={() => {
          setIsPlaying(true);
          setCameraState("connected");
        }}
        onPause={() => setIsPlaying(false)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setIsMuted(e.currentTarget.muted);
        }}
      />

      {/* Offline Player Overlay */}
      {cameraState === "offline" && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/90 p-6 pointer-events-auto">
          <div className="flex flex-col items-center text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-4 shadow-xl">
              <VideoOff className="w-8 h-8 text-neutral-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-1.5">Camera Offline</h3>
            <p className="text-xs text-neutral-400 mb-6">
              Unable to establish connection to this camera. Scanning automatically in background...
            </p>
            <button
              onClick={() => retryCameraStream(camera.id)}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer active:scale-95"
            >
              <RotateCw className="w-4 h-4" />
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Connecting Spinner Overlay */}
      {cameraState === "connecting" && !isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 bg-black/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-white font-medium text-sm drop-shadow-md">Connecting to camera...</p>
          </div>
        </div>
      )}

      {/* Cinematic Overlays (Auto hides - exact match to VideoPlayer.tsx) */}
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 z-10 flex flex-col justify-between ${
          showOverlay ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-auto min-h-[4.5rem] sm:h-44 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-start p-3 sm:p-6 md:p-8 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          <div className="pointer-events-auto flex items-center gap-2 sm:gap-4 max-w-full min-w-0" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="p-2 sm:p-3 bg-neutral-900/50 hover:bg-neutral-800 text-white rounded-full backdrop-blur-sm transition-colors flex items-center justify-center shrink-0 shadow-lg cursor-pointer"
              title="Exit Player"
            >
              <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="min-w-0">
              <h2 className="text-base sm:text-2xl md:text-4xl font-bold text-white tracking-tight drop-shadow-lg truncate">
                {camera.name}
              </h2>
            </div>
          </div>
        </div>

        {/* Custom Bottom Controls (exact match to VideoPlayer.tsx) */}
        <div className="h-auto min-h-[4.5rem] sm:h-44 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-end p-3 sm:p-6 md:p-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          <div className="w-full flex items-center justify-between gap-1 sm:gap-3 pointer-events-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <button 
                onClick={togglePlay} 
                className="text-white hover:text-blue-400 transition-colors focus:outline-none cursor-pointer p-1"
              >
                {isPlaying ? <Pause className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 fill-current" /> : <Play className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 fill-current" />}
              </button>

              <div className="flex items-center gap-1 sm:gap-2 transition-colors">
                <span className={`w-2 h-2 rounded-full ${cameraState === "connected" ? "bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)] animate-pulse" : cameraState === "connecting" ? "bg-amber-400 animate-pulse" : "bg-neutral-500"}`}></span>
                <span className="font-bold text-[11px] sm:text-sm tracking-wider text-white/90">
                  {cameraState === "connected" ? "LIVE" : cameraState === "connecting" ? "CONNECTING" : "OFFLINE"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-2 md:gap-4 shrink-0">
              {/* Audio Controls */}
              <div className="flex items-center gap-1 sm:gap-3 group/volume">
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    const nextMuted = !isMuted;
                    setIsMuted(nextMuted);
                    if (videoRef.current) {
                      videoRef.current.muted = nextMuted;
                      if (!nextMuted) {
                        videoRef.current.play().catch(() => {});
                      }
                    }
                  }}
                  className="p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5 sm:w-6 sm:h-6 text-red-400" />
                  ) : (
                    <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
                  )}
                </button>

                <div className="w-16 sm:w-24 md:w-28 flex items-center">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      e.stopPropagation();
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      setIsMuted(val === 0);
                    }}
                    className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Native OS Picture in Picture */}
              {!isMobile && (
                <button
                  onClick={toggleNativePip}
                  className="hidden md:flex p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors items-center justify-center focus:outline-none cursor-pointer"
                  title="Picture in Picture"
                >
                  <PictureInPicture2 className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}

              {/* More Cameras button */}
              <button 
                onClick={(e) => { e.stopPropagation(); setDrawerOpen(true); }}
                className="p-1.5 sm:p-2 text-white hover:text-blue-400 rounded-full transition-colors flex items-center justify-center focus:outline-none cursor-pointer"
                title="More Cameras"
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

      {/* Slide-out Drawer (exact match to VideoPlayer.tsx) */}
      <div 
        className={`absolute inset-y-0 right-0 w-full max-w-xs sm:w-80 md:w-96 bg-neutral-950/95 backdrop-blur-xl border-l border-neutral-800 z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 border-b border-neutral-800/50 flex flex-col shrink-0">
          <div className="flex items-center justify-between mb-2 sm:mb-4">
            <h3 className="font-bold text-lg sm:text-xl text-white">Cameras</h3>
            <button onClick={() => setDrawerOpen(false)} className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors cursor-pointer">
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {allCameras.map((cam) => (
            <button 
              key={cam.id}
              onClick={() => { onSelectCamera(cam); setDrawerOpen(false); }}
              className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 group hover:bg-neutral-800/80 hover:scale-[1.02] text-left cursor-pointer ${
                cam.id === camera.id 
                  ? 'bg-blue-900/20 border border-blue-500/30' 
                  : 'border border-transparent'
              }`}
            >
              <div className="w-14 h-14 shrink-0 bg-neutral-900 rounded-lg p-1.5 flex items-center justify-center shadow-inner">
                <Video className="w-6 h-6 text-neutral-400 group-hover:text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate text-sm ${cam.id === camera.id ? 'text-blue-400' : 'text-neutral-200 group-hover:text-white'}`}>
                  {cam.name}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================
// Cameras Grid Card (Exact match to ChannelList.tsx card)
// =========================================================
function CameraCard({
  source,
  onSelect,
}: {
  source: SourceRow;
  onSelect: (source: SourceRow) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraState, setCameraState] = useState<CameraState>("connecting");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const subId = `card-${source.id}`;
    let isMounted = true;

    // Check if stream already exists
    const cached = getActiveStream(source.id);
    if (cached && cached.mediaStream.getTracks().length > 0) {
      video.srcObject = cached.mediaStream;
      video.play().then(() => {
        if (isMounted) setCameraState("connected");
      }).catch(() => {});
    }

    acquireCameraStream(
      source,
      subId,
      (stream) => {
        if (isMounted && video) {
          video.srcObject = stream;
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
      releaseCameraStream(source.id, subId);
    };
  }, [source]);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    retryCameraStream(source.id);
  };

  return (
    <div
      tabIndex={0}
      onClick={() => {
        if (cameraState !== "offline") {
          lockToLandscape();
          onSelect(source);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (cameraState !== "offline") {
            lockToLandscape();
            onSelect(source);
          }
        }
      }}
      className={`group relative w-full sm:w-[calc(50%-12px)] lg:w-[320px] aspect-video bg-neutral-900 rounded-xl overflow-hidden snap-start transition-all duration-300 shadow-lg border-2 ${
        cameraState === "offline"
          ? "border-neutral-800 hover:border-neutral-700 opacity-90"
          : "border-transparent hover:border-blue-500 hover:scale-105 hover:z-10 hover:shadow-[0_0_20px_rgba(59,130,246,0.6)] cursor-pointer"
      } shrink-0`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity z-10 pointer-events-none" />

      <video
        ref={videoRef}
        className="w-full h-full object-contain absolute inset-0 bg-black pointer-events-none"
        autoPlay
        playsInline
        muted
        onPlaying={() => setCameraState("connected")}
      />

      {/* Connecting Spinner */}
      {cameraState === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/85 z-15 pointer-events-none gap-2">
          <div className="w-8 h-8 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-[11px] font-medium text-neutral-300 tracking-wide">Connecting stream...</span>
        </div>
      )}

      {/* Offline Card State with Retry Button */}
      {cameraState === "offline" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/90 z-15 p-4 text-center">
          <div className="w-9 h-9 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-2 shadow-inner">
            <VideoOff className="w-4 h-4 text-neutral-400" />
          </div>
          <p className="text-xs font-semibold text-neutral-200 mb-0.5">Camera Offline</p>
          <p className="text-[10px] text-neutral-500 mb-2.5">Auto-scanning every 8s...</p>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-medium transition-all duration-150 shadow-md cursor-pointer active:scale-95"
          >
            <RotateCw className="w-3 h-3" />
            Retry Now
          </button>
        </div>
      )}

      {/* Card Overlay Info */}
      <div className="absolute inset-0 flex flex-col justify-between p-3.5 z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/70 backdrop-blur-sm self-start border border-white/5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              cameraState === "connected"
                ? "bg-red-500 animate-pulse"
                : cameraState === "connecting"
                ? "bg-amber-400 animate-pulse"
                : "bg-neutral-500"
            }`}
          />
          <span className="text-[10px] font-bold text-white tracking-wider uppercase">
            {cameraState === "connected" ? "LIVE" : cameraState === "connecting" ? "CONNECTING" : "OFFLINE"}
          </span>
        </div>

        <div>
          <span className="text-white font-semibold text-sm drop-shadow-md truncate block">
            {source.name}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Cameras() {
  const { cameraId } = useParams<{ cameraId?: string }>();
  const navigate = useNavigate();
  const { data: sources, loading, error } = useApi<SourceRow[]>("/api/sources");
  const cameras = sources?.filter((s) => s.type === "rtsp") || [];

  const selectedCamera = cameraId 
    ? cameras.find((c) => c.id === parseInt(cameraId)) || null 
    : null;

  return (
    <>
      {/* Grid View (kept mounted in background so all camera feeds remain live and instant) */}
      <div 
        className={`flex-1 overflow-y-auto overflow-x-hidden relative no-scrollbar px-4 sm:px-6 md:pl-28 md:pr-12 pt-6 sm:pt-8 pb-20 md:pb-8 ${
          selectedCamera ? 'hidden' : 'block animate-in fade-in duration-300'
        }`}
      >
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-white tracking-tight drop-shadow-lg">
            Security Cameras
          </h1>
          <p className="text-neutral-400 mt-1 sm:mt-2 text-sm sm:text-base md:text-lg">
            Live feeds from your RTSP security cameras
          </p>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-red-500 py-8">Failed to load cameras: {error}</div>
        )}

        {!loading && !error && cameras.length === 0 && (
          <div className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 rounded-2xl p-8 sm:p-12 max-w-md text-center mx-auto">
            <Video className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-3 text-white">No Cameras Found</h2>
            <p className="text-neutral-400 mb-6 text-sm sm:text-base">
              You haven't added any security cameras yet. Head over to Settings to add an RTSP camera stream.
            </p>
          </div>
        )}

        {cameras.length > 0 && (
          <div className="flex flex-wrap gap-4 sm:gap-6 pb-24">
            {cameras.map((cam) => (
              <CameraCard
                key={cam.id}
                source={cam}
                onSelect={(c) => navigate(`/cameras/${c.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Focus View (Overlaid on top when a camera is selected) */}
      {selectedCamera && (
        <div className="fixed inset-0 z-50 bg-black">
          <CameraPlayerView
            camera={selectedCamera}
            allCameras={cameras}
            onSelectCamera={(cam) => navigate(`/cameras/${cam.id}`)}
            onClose={() => navigate("/cameras")}
          />
        </div>
      )}
    </>
  );
}


