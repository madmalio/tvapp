import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Pause, Volume2, VolumeX, Maximize, Minimize, Download } from "lucide-react";
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
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const isDragging = useRef(false);

  const { data: recording, error } = useApi<Recording>(`/api/recordings/${id}`);

  useEffect(() => {
    if (!recording?.file_path) return;

    const video = videoRef.current;
    if (!video) return;

    // Initialize state from video element
    setIsMuted(video.muted);
    setVolume(video.volume);

    const manifestUrl = getApiUrl(`/${recording.file_path.replace(/\\/g, '/')}`);

    let hls: Hls | null = null;
    
    if (recording.file_path.endsWith('.mp4')) {
      video.src = manifestUrl;
      video.play().catch(console.error);
    } else if (Hls.isSupported()) {
      hls = new Hls({ 
        maxBufferLength: 60,       // Try to keep 60 seconds ahead
        maxMaxBufferLength: 600,   // Let it buffer up to 10 minutes ahead if bandwidth allows!
        maxBufferSize: 60 * 1024 * 1024, // Allow up to 60MB of video in memory for instant local scrubbing
        progressive: true,         // Render chunks immediately as they download instead of waiting for the full chunk
        enableWorker: true,        // Use a background web worker to handle the TS-to-MP4 conversion faster
        startPosition: 0           // Always start VOD recordings from the beginning
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
    const onVolumeChange = () => {
      setIsMuted(video.muted);
      setVolume(video.volume);
    };
    const onTimeUpdate = () => {
      if (!isDragging.current) {
        setProgress(video.currentTime);
      }
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

  const handleSeekStart = () => {
    isDragging.current = true;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProgress(Number(e.target.value));
  };

  const handleSeekEnd = () => {
    isDragging.current = false;
    if (videoRef.current) {
      videoRef.current.currentTime = progress;
    }
  };

  const handleVolumeSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current) {
      const vol = Number(e.target.value);
      videoRef.current.volume = vol;
      videoRef.current.muted = vol === 0;
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

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
  const volumePercent = isMuted ? 0 : volume * 100;

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
        {recording?.file_path ? (
          <a href={getApiUrl(`/${recording.file_path}`)} download className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
            <Download className="w-6 h-6" />
          </a>
        ) : (
          <div className="w-10"></div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 inset-x-0 p-4 sm:p-6 bg-gradient-to-t from-black/90 to-transparent flex flex-col gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        
        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <span className="text-white text-xs font-medium w-12 text-right">{formatTime(progress)}</span>
          <div className="flex-1 relative flex items-center h-4 group/scrubber cursor-pointer">
            <div className="absolute inset-x-0 h-1.5 bg-neutral-600 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div 
              className="absolute w-3 h-3 bg-white rounded-full shadow scale-0 group-hover/scrubber:scale-125 transition-transform pointer-events-none" 
              style={{ left: `calc(${progressPercent}% - 6px)` }} 
            />
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={progress}
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              onChange={handleSeek}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="text-white text-xs font-medium w-12">{formatTime(duration)}</span>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
              {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7" />}
            </button>
            <div className="flex items-center gap-2 group/vol">
              <button onClick={toggleMute} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
                {isMuted || volume === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>
              <div className="w-0 opacity-0 group-hover/vol:w-24 group-hover/vol:opacity-100 transition-all duration-300 relative flex items-center h-4 cursor-pointer">
                <div className="absolute inset-x-0 h-1.5 bg-neutral-600 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${volumePercent}%` }} />
                </div>
                <div 
                  className="absolute w-3 h-3 bg-white rounded-full shadow pointer-events-none" 
                  style={{ left: `calc(${volumePercent}% - 6px)` }} 
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeSeek}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </div>
          <button onClick={toggleFullscreen} className="p-2 text-white hover:bg-white/20 rounded-full transition-colors cursor-pointer">
            {isFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}
