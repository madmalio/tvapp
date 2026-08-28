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

    const subId = \pip-\\;
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
          <span className={\w-1.5 h-1.5 rounded-full \\} />
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
              className={\	ext-left text-xs p-1.5 rounded transition-colors \\}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
