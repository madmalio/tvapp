import sys

def main():
    with open('web/src/components/VideoPlayer.tsx', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Imports
    if 'import { usePlayer, ChannelInfo, CameraInfo }' not in content:
        content = content.replace(
            'import { usePlayer, ChannelInfo } from "../context/PlayerContext";',
            'import { usePlayer, ChannelInfo, CameraInfo } from "../context/PlayerContext";'
        )

    if 'Maximize2' not in content:
        content = content.replace(
            '  PictureInPicture2,\n} from "lucide-react";',
            '  PictureInPicture2,\n  Video,\n  Maximize2\n} from "lucide-react";'
        )

    # 2. Add Component
    overlay_component = """
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isMounted = true;
    const mediaStream = new MediaStream();
    const pc = new RTCPeerConnection({ iceServers: [] });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (event) => {
      mediaStream.addTrack(event.track);
      if (video && isMounted) {
        video.srcObject = mediaStream;
        video.muted = true;
        video.play().catch(() => {});
      }
    };

    let streamId = "";
    async function init() {
      try {
        const startRes = await fetch(getApiUrl("/api/stream/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: camera.url, tuner_type: "rtsp", quality: "720p_std" }),
        });
        const startData = await startRes.json();
        streamId = startData.id;

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
        console.warn("[PinnedCamera] Connection error:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      pc.close();
      if (streamId) {
        fetch(getApiUrl(`/api/stream/stop/${streamId}`), { method: "DELETE" }).catch(() => {});
      }
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
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[9px] font-bold text-white tracking-wider">LIVE</span>
        </div>
      </div>

      {showMenu && (
        <div className="absolute inset-0 bg-neutral-950/95 p-2 overflow-y-auto z-40 flex flex-col gap-1">
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

export default function VideoPlayer() {"""

    if 'function PinnedCameraOverlay' not in content:
        content = content.replace('export default function VideoPlayer() {', overlay_component)

    # 3. Add States
    if 'cameraPipEnabled' not in content:
        content = content.replace(
            'const { playChannel } = usePlayer();',
            'const { playChannel, cameraPipEnabled, pipCamera, setPipCamera } = usePlayer();\\n  const [showCameraMenu, setShowCameraMenu] = useState(false);\\n  const { data: sources } = useApi<CameraInfo[]>("/api/sources");\\n  const rtspCameras = useMemo(() => sources?.filter(s => s.type === "rtsp") || [], [sources]);'
        )

    # 4. Render Overlay
    overlay_render = """        />

        {/* Pinned Security Camera PiP Overlay */}
        {pipCamera && (
          <PinnedCameraOverlay
            camera={pipCamera}
            allCameras={rtspCameras}
            onSwitchCamera={(c) => setPipCamera(c)}
            onClose={() => setPipCamera(null)}
            onExpand={() => navigate(`/cameras/${pipCamera.id}`)}
          />
        )}"""
    if 'PinnedCameraOverlay' not in content:
        content = content.replace('        />', overlay_render, 1)

    # 5. Add Button
    button_code = """              {/* Security Camera PiP Overlay Toggle */}
              {cameraPipEnabled && rtspCameras.length > 0 && (
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
"""
    if 'Security Camera PiP Overlay Toggle' not in content:
        content = content.replace('              {/* Native OS Picture in Picture (Desktop only) */}', button_code + '              {/* Native OS Picture in Picture (Desktop only) */}')

    with open('web/src/components/VideoPlayer.tsx', 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
