import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import Hls from "hls.js";
import { getApiUrl } from "../lib/api";
import { useApi } from "../hooks/useApi";

type Recording = {
  id: number;
  title: string;
  file_path: string;
};

export default function RecordingPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const { data: recording, error } = useApi<Recording>(`/api/recordings/${id}`);

  useEffect(() => {
    if (!recording?.file_path) return;

    const video = videoRef.current;
    if (!video) return;

    const manifestUrl = getApiUrl(`/${recording.file_path.replace(/\\/g, '/')}`);

    let hls: Hls | null = null;
    
    if (recording.file_path.endsWith('.mp4')) {
      video.src = manifestUrl;
      video.play().catch(console.error);
    } else if (Hls.isSupported()) {
      hls = new Hls({ 
        maxBufferLength: 30, 
        maxMaxBufferLength: 60,
        startPosition: 0 // Always start VOD recordings from the beginning
      });
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(console.error);
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = manifestUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch(console.error);
      });
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [recording]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolumeChange = () => setIsMuted(video.muted);
    const onTimeUpdate = () => {
      setProgress(video.currentTime);
      setDuration(video.duration || 0);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  const togglePlay = () => {
    if (videoRef.current?.paused) {
      videoRef.current.play();
    } else {
      videoRef.current?.pause();
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Number(e.target.value);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (error) {
    return <div className="p-8 text-red-500">Error loading recording.</div>;
  }

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-[100] flex flex-col group">
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        playsInline
      />
      
      {/* Top Bar */}
      <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <button onClick={() => navigate(-1)} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h2 className="text-white font-semibold shadow-black drop-shadow-md truncate max-w-[60vw]">
          {recording?.title || "Loading..."}
        </h2>
        <div className="w-10"></div> {/* spacer for centering */}
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        
        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <span className="text-white text-xs font-medium w-12 text-right">{formatTime(progress)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={progress}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-neutral-600 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
          />
          <span className="text-white text-xs font-medium w-12">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
              {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7" />}
            </button>
            <button onClick={toggleMute} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
              {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </button>
          </div>
          <button onClick={toggleFullscreen} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}
