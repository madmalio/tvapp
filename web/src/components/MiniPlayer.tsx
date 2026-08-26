import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2, X, Play, Pause, Volume2, VolumeX, Radio, Video } from "lucide-react";
import Hls from "hls.js";
import { usePlayer } from "../context/PlayerContext";
import { getApiUrl } from "../lib/api";

export default function MiniPlayer() {
  const {
    activeChannel,
    activeCamera,
    isMiniPlayerOpen,
    isPlaying,
    isMuted,
    volume,
    setIsPlaying,
    setIsMuted,
    setVolume,
    expandMiniPlayer,
    closeMiniPlayer,
  } = usePlayer();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [showControls, setShowControls] = useState(false);

  const getProxyUrl = useCallback((rawUrl: string) => {
    return getApiUrl(`/api/proxy?url=${encodeURIComponent(rawUrl)}`);
  }, []);

  // TV Channel Playback
  useEffect(() => {
    if (!isMiniPlayerOpen || !activeChannel) return;

    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = isMuted;

    if (activeChannel.tuner_type === "hdhomerun") {
      const streamUrl = getApiUrl(`/api/stream/start?url=${encodeURIComponent(activeChannel.stream_url)}&tuner_type=hdhomerun&quality=720p_std`);
      video.src = streamUrl;
      video.play().catch(() => {});
      return;
    }

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        xhrSetup: (xhr, url) => {
          if (!url.startsWith(getApiUrl("/api/proxy")) && !url.startsWith(window.location.origin)) {
            xhr.open("GET", getProxyUrl(url), true);
          }
        },
      });

      hlsRef.current = hls;
      const initialProxyUrl = getProxyUrl(activeChannel.stream_url);
      hls.loadSource(initialProxyUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (isPlaying) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = getProxyUrl(activeChannel.stream_url);
      if (isPlaying) {
        video.play().catch(() => {});
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isMiniPlayerOpen, activeChannel, getProxyUrl]);

  // RTSP Camera WebRTC Playback
  useEffect(() => {
    if (!isMiniPlayerOpen || !activeCamera) return;

    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;
    const mediaStream = new MediaStream();
    const pc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = pc;

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      mediaStream.addTrack(event.track);
      if (video && isMounted) {
        video.srcObject = mediaStream;
        video.volume = volume;
        video.muted = isMuted;
        video.play().catch(() => {});
      }
    };

    async function initCamera() {
      try {
        const startRes = await fetch(getApiUrl("/api/stream/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: activeCamera!.url, tuner_type: "rtsp", quality: "720p_std" }),
        });
        const startData = await startRes.json();
        const streamId = startData.id;
        sessionIdRef.current = streamId;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        let connected = false;
        let attempts = 0;
        while (!connected && attempts < 20 && isMounted) {
          attempts++;
          try {
            const res = await fetch(`http://${window.location.hostname}:8889/${streamId}/whep`, {
              method: "POST",
              headers: { "Content-Type": "application/sdp" },
              body: offer.sdp,
            });
            if (res.ok) {
              const answerSdp = await res.text();
              await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSdp }));
              connected = true;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err) {
        console.warn("[MiniPlayer] Camera connect error:", err);
      }
    }

    initCamera();

    return () => {
      isMounted = false;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (sessionIdRef.current) {
        fetch(getApiUrl(`/api/stream/stop/${sessionIdRef.current}`), { method: "DELETE" }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [isMiniPlayerOpen, activeCamera, volume, isMuted]);

  // Volume & Mute Sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [setIsPlaying]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    localStorage.setItem("tvapp_muted", nextMuted.toString());
  }, [isMuted, setIsMuted]);

  if (!isMiniPlayerOpen || (!activeChannel && !activeCamera)) {
    return null;
  }

  const title = activeChannel?.name || activeCamera?.name || "Live Stream";
  const logo = activeChannel?.logo_url;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-3 sm:right-6 z-40 w-64 sm:w-80 aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-700/80 bg-neutral-950 group select-none animate-in slide-in-from-bottom-5 fade-in duration-300"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      onClick={expandMiniPlayer}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black pointer-events-none"
        autoPlay
        playsInline
      />

      {/* Floating Controls Overlay */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/80 flex flex-col justify-between p-2.5 sm:p-3 transition-opacity duration-200 cursor-pointer ${
          showControls ? "opacity-100" : "opacity-0 sm:opacity-0"
        }`}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {logo ? (
              <img src={logo} alt={title} className="w-5 h-5 object-contain rounded shrink-0 bg-white/10 p-0.5" />
            ) : activeCamera ? (
              <Video className="w-4 h-4 text-blue-400 shrink-0" />
            ) : (
              <Radio className="w-4 h-4 text-purple-400 shrink-0" />
            )}
            <span className="text-xs font-semibold text-white truncate drop-shadow-md">
              {title}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={expandMiniPlayer}
              className="p-1 rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800/80 transition-colors"
              title="Expand to Full View"
            >
              <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <button
              onClick={closeMiniPlayer}
              className="p-1 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-800/80 transition-colors"
              title="Close Stream"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>

        {/* Bottom Playback Controls */}
        <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-full bg-white/20 hover:bg-blue-600 text-white transition-colors"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={toggleMute}
              className="p-1.5 rounded-full text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-white tracking-wider uppercase">LIVE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
