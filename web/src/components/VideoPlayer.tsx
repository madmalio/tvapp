import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";

type ChannelInfo = {
  id: number;
  name: string;
  stream_url: string;
  group_title?: string;
};

const MAX_RELOADS = 3;

export default function VideoPlayer() {
  const { channelId } = useParams<{ channelId: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [status, setStatus] = useState("Loading...");
  const hlsRef = useRef<Hls | null>(null);
  const reloadAttemptsRef = useRef(0);
  const positionRef = useRef(0);

  const getProxyUrl = useCallback(() => {
    if (!channel) return "";
    return `/api/proxy?url=${encodeURIComponent(channel.stream_url)}`;
  }, [channel]);

  useEffect(() => {
    if (!channelId) return;
    reloadAttemptsRef.current = 0;
    fetch(`/api/channels/${channelId}`)
      .then((r) => r.json())
      .then((ch) => setChannel(ch))
      .catch(() => setStatus("Channel not found"));
  }, [channelId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel) return;

    startPlayback(video, getProxyUrl());

    function onTimeUpdate() {
      positionRef.current = video?.currentTime || 0;
    }
    video.addEventListener("timeupdate", onTimeUpdate);

    function startPlayback(v: HTMLVideoElement, url: string) {
      if (!url) return;
      setStatus("Loading...");

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 4,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 4,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 6,
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
              fetch(`/api/channels/${channelId}?force=true`)
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
          v.play().catch(() => setStatus("Play button required"));
        });
      } else {
        v.src = url;
        v.play().catch(() => setStatus("Play button required"));
      }
    }

    return () => {
      const hls = hlsRef.current;
      hlsRef.current = null;
      if (hls) hls.destroy();
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [channel, getProxyUrl]);

  return (
    <div className="flex-1 flex flex-col bg-black relative group overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain bg-black z-0"
        controls
        autoPlay
        playsInline
      />

      {/* Status Overlays */}
      {status === "Loading..." || status === "Recovering..." ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 bg-black/40 backdrop-blur-sm">
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

      {/* Cinematic Overlays (Fades out when not hovering) */}
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10 flex flex-col justify-between">
        <div className="h-32 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-start p-6">
          {/* Top gradient area */}
        </div>
        
        <div className="h-48 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-end p-8 md:p-12">
          {channel && (
            <div className="pointer-events-auto">
              <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight drop-shadow-lg mb-2">
                {channel.name}
              </h2>
              {channel.group_title && (
                <p className="text-blue-400 font-medium text-lg drop-shadow-md">
                  {channel.group_title}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
