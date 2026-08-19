import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { getApiUrl } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { Video, AlertCircle } from "lucide-react";

type SourceRow = {
  id: number;
  name: string;
  type: string;
  url: string;
  epg_url?: string;
};

function sanitizePathName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function CameraPlayer({ source }: { source: SourceRow }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const pathName = sanitizePathName(`cam_${source.id}_${source.name}`);
    
    // Proxy the MediaMTX stream through the backend to avoid firewall issues
    const targetUrl = `http://127.0.0.1:8888/${pathName}/index.m3u8`;
    const streamUrl = getApiUrl(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);

    let hls: Hls | null = null;

    if (Hls.isSupported()) {
      hls = new Hls({
        liveDurationInfinity: true,
        maxLiveSyncPlaybackRate: 1.5,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(`Stream error: ${data.details}`);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(e => console.warn("Auto-play prevented", e));
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(e => console.warn("Auto-play prevented", e));
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [source]);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl flex flex-col group">
      <div className="relative aspect-video bg-black flex items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center text-red-500 gap-2 p-4 text-center">
            <AlertCircle className="w-8 h-8" />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            controls
            muted
            playsInline
          />
        )}
      </div>
      <div className="p-4 bg-neutral-900/80 backdrop-blur-md flex items-center gap-3 border-t border-neutral-800">
        <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
          <Video className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-white font-medium">{source.name}</h3>
          <p className="text-xs text-neutral-400">Live RTSP Stream</p>
        </div>
      </div>
    </div>
  );
}

export default function Cameras() {
  const { data: sources, loading, error } = useApi<SourceRow[]>("/api/sources");

  const cameras = sources?.filter(s => s.type === 'rtsp') || [];

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 text-neutral-100 overflow-hidden pl-20 pt-6">
      <div className="px-8 pb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Video className="w-8 h-8 text-blue-500" />
          Security Cameras
        </h1>
        <p className="text-neutral-400 mt-2">Live feeds from your local RTSP cameras</p>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {loading && <div className="text-neutral-500">Loading cameras...</div>}
        {error && <div className="text-red-500">Failed to load cameras: {error.message}</div>}
        
        {!loading && !error && cameras.length === 0 && (
          <div className="max-w-xl bg-neutral-900/50 border border-neutral-800 rounded-2xl p-12 text-center">
            <Video className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-white mb-2">No Cameras Configured</h3>
            <p className="text-neutral-400 mb-6">You haven't added any security cameras yet.</p>
            <p className="text-sm text-neutral-500">Go to Settings &rarr; RTSP Cameras to add your first feed.</p>
          </div>
        )}

        {cameras.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl pb-20">
            {cameras.map(cam => (
              <CameraPlayer key={cam.id} source={cam} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
