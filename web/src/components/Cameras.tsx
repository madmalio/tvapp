import { useEffect, useRef, useState } from "react";
import { getApiUrl } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { Video, RefreshCw } from "lucide-react";

type SourceRow = {
  id: number;
  name: string;
  type: string;
  url: string;
};

function CameraPlayer({ source }: { source: SourceRow }) {
  const [error, setError] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const toggleExpand = () => {
    if (isExpanded) {
      setIframeKey(k => k + 1);
    }
    setIsExpanded(!isExpanded);
  };

  useEffect(() => {
    let active = true;
    setStreamId(null);
    setIsReady(false);
    fetch(getApiUrl("/api/stream/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: source.url, tuner_type: "rtsp", quality: "720p_std" })
    })
    .then(r => r.json())
    .then(data => {
      if (!active) {
        fetch(getApiUrl(/api/stream/stop/ + data.id), { method: "DELETE" }).catch(() => {});
        return;
      }
      sessionIdRef.current = data.id;
      setStreamId(data.id);
    })
    .catch(err => setError(err.message));

    return () => {
      active = false;
      if (sessionIdRef.current) {
        fetch(getApiUrl(/api/stream/stop/ + sessionIdRef.current), { method: "DELETE" }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [source, retryCount]);

  useEffect(() => {
    if (!streamId || error) return;
    
    let isMounted = true;
    let attempts = 0;
    const checkReady = () => {
      attempts++;
      if (attempts > 30) {
        if (isMounted) {
          setError("Stream failed to start (timed out)");
        }
        return;
      }
      fetch(getApiUrl(/api/go2rtc/api/streams?src= + streamId), { method: 'GET' })
        .then(res => {
          if (res.ok && isMounted) {
            setIsReady(true);
          } else if (isMounted) {
            setTimeout(checkReady, 1000);
          }
        })
        .catch(() => {
          if (isMounted) setTimeout(checkReady, 1000);
        });
    };
    checkReady();

    return () => { isMounted = false; };
  }, [streamId, error]);

  // Heartbeat to keep session alive
  useEffect(() => {
    if (!streamId) return;
    const interval = setInterval(() => {
      fetch(getApiUrl(/api/stream/heartbeat/ + streamId)).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [streamId]);

  const targetStreamId = isExpanded ? streamId : streamId + _sd;
  const webrtcUrl = streamId ? getApiUrl(/api/go2rtc/webrtc.html?src= + targetStreamId) : "";

  const containerClasses = isExpanded 
    ? "fixed inset-4 z-50 bg-black rounded-xl overflow-hidden shadow-2xl flex flex-col group"
    : "bg-black rounded-xl overflow-hidden shadow-xl group relative cursor-pointer transition-colors aspect-video";

  return (
    <>
      <div 
        className={containerClasses}
        onClick={!isExpanded ? toggleExpand : undefined}
      >
        <div className="relative w-full h-full flex items-center justify-center">
          {!isReady && !error ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-neutral-500 bg-black">
              <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-2" />
              <span className="text-sm">Connecting...</span>
            </div>
          ) : null}

          {error ? (
            <div 
              className="flex flex-col items-center text-red-500 gap-2 p-4 text-center z-20 bg-black/90 w-full h-full justify-center absolute inset-0 cursor-pointer hover:bg-neutral-900 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setError(null);
                setIsReady(false);
                setRetryCount(c => c + 1);
              }}
            >
              <RefreshCw className="w-6 h-6 mb-1" />
              <span className="text-sm font-medium">{error}</span>
              <span className="text-xs text-neutral-400">Click to retry</span>
            </div>
          ) : streamId && isReady ? (
            <>
              <iframe 
                key={iframeKey}
                src={webrtcUrl} 
                className="w-full h-full border-0 absolute inset-0" 
                allow="autoplay; fullscreen"
                allowFullScreen 
                scrolling="no"
                title={Camera  + source.name}
              />
              {!isExpanded && (
                <div className="absolute inset-0 z-10 cursor-pointer" onClick={toggleExpand} />
              )}
            </>
          ) : null}
          
          <div className="absolute top-3 left-3 px-2 py-1 bg-black/40 backdrop-blur-sm rounded flex items-center gap-2 pointer-events-none z-20">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white/90 text-xs font-medium tracking-wide shadow-sm">{source.name}</span>
          </div>

          <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all z-20">
            <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded border border-white/10 text-blue-400 text-xs font-bold">
              WebRTC
            </span>
            {isExpanded && (
              <button 
                onClick={toggleExpand}
                className="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded border border-white/10 text-white/90 cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div 
          className="fixed inset-0 bg-black/90 z-40 backdrop-blur-sm"
          onClick={toggleExpand}
        />
      )}
      {isExpanded && <div className="aspect-video hidden md:block" />}
    </>
  );
}

export default function Cameras() {
  const { data: sources, loading, error } = useApi<SourceRow[]>("/api/sources");
  const cameras = sources?.filter(s => s.type === 'rtsp') || [];

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 text-neutral-100 overflow-hidden pl-20 pt-6">
      <div className="px-8 pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Video className="w-8 h-8 text-blue-500" />
            Security Cameras
          </h1>
          <p className="text-neutral-400 mt-2">Live feeds from your local RTSP cameras</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        {loading && <div className="text-neutral-500">Loading cameras...</div>}
        {error && <div className="text-red-500">Failed to load cameras: {error}</div>}
        
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
