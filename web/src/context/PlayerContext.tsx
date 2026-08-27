import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type ChannelInfo = {
  id: number;
  name: string;
  stream_url: string;
  logo_url?: string;
  group_title?: string;
  tuner_type?: string;
  source_id?: number;
};

export type CameraInfo = {
  id: number;
  name: string;
  type: string;
  url: string;
  epg_url?: string;
};

type PlayerContextType = {
  activeChannel: ChannelInfo | null;
  activeCamera: CameraInfo | null;
  pipCamera: CameraInfo | null;
  isMiniPlayerOpen: boolean;
  miniPlayerEnabled: boolean;
  cameraPipEnabled: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playChannel: (channel: ChannelInfo) => void;
  playCamera: (camera: CameraInfo) => void;
  setPipCamera: (camera: CameraInfo | null) => void;
  setMiniPlayerEnabled: (enabled: boolean) => void;
  setCameraPipEnabled: (enabled: boolean) => void;
  stopPlayback: () => void;
  setIsPlaying: (playing: boolean) => void;
  setIsMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  expandMiniPlayer: () => void;
  closeMiniPlayer: () => void;
};

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [activeChannel, setActiveChannel] = useState<ChannelInfo | null>(null);
  const [activeCamera, setActiveCamera] = useState<CameraInfo | null>(null);
  const [pipCamera, setPipCamera] = useState<CameraInfo | null>(null);
  const [isMiniPlayerOpen, setIsMiniPlayerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem("tvapp_muted") === "true");
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("tvapp_volume");
    return saved !== null ? parseFloat(saved) : 1;
  });

  const [miniPlayerEnabled, setMiniPlayerEnabled] = useState(() => {
    const saved = localStorage.getItem("tvapp_miniplayer_enabled");
    return saved !== null ? saved === "true" : true;
  });

  const [cameraPipEnabled, setCameraPipEnabled] = useState(() => {
    const saved = localStorage.getItem("tvapp_camera_pip_enabled");
    return saved !== null ? saved === "true" : true;
  });

  const location = useLocation();
  const navigate = useNavigate();

  const isFullPlayerRoute = 
    location.pathname.startsWith("/player/") || 
    (location.pathname.startsWith("/cameras/") && location.pathname !== "/cameras");

  // Manage mini-player visibility based on active playback, current route, screen size, and user preference
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && (window.innerWidth < 768 || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    if (isFullPlayerRoute || isMobile) {
      setIsMiniPlayerOpen(false);
      // On mobile, when leaving the full player, stop active playback cleanly
      if (!isFullPlayerRoute && isMobile && (activeChannel || activeCamera)) {
        setActiveChannel(null);
        setActiveCamera(null);
      }
    } else if ((activeChannel || activeCamera) && miniPlayerEnabled) {
      setIsMiniPlayerOpen(true);
    } else {
      setIsMiniPlayerOpen(false);
    }
  }, [isFullPlayerRoute, activeChannel, activeCamera, miniPlayerEnabled]);

  // Window resize handler to hide mini-player if resized to mobile
  useEffect(() => {
    const handleResize = () => {
      const isMobile = typeof window !== "undefined" && (window.innerWidth < 768 || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
      if (isMobile && isMiniPlayerOpen) {
        setIsMiniPlayerOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMiniPlayerOpen]);

  const setMiniPlayerEnabledState = useCallback((enabled: boolean) => {
    setMiniPlayerEnabled(enabled);
    localStorage.setItem("tvapp_miniplayer_enabled", enabled.toString());
    if (!enabled) {
      setIsMiniPlayerOpen(false);
    }
  }, []);

  const setCameraPipEnabledState = useCallback((enabled: boolean) => {
    setCameraPipEnabled(enabled);
    localStorage.setItem("tvapp_camera_pip_enabled", enabled.toString());
    if (!enabled) {
      setPipCamera(null);
    }
  }, []);

  const playChannel = useCallback((channel: ChannelInfo) => {
    setActiveCamera(null);
    setActiveChannel(channel);
    setIsPlaying(true);
    setIsMiniPlayerOpen(false);
  }, []);

  const playCamera = useCallback((camera: CameraInfo) => {
    setActiveChannel(null);
    setActiveCamera(camera);
    setIsPlaying(true);
    setIsMiniPlayerOpen(false);
  }, []);

  const stopPlayback = useCallback(() => {
    setActiveChannel(null);
    setActiveCamera(null);
    setPipCamera(null);
    setIsMiniPlayerOpen(false);
  }, []);

  const closeMiniPlayer = useCallback(() => {
    setActiveChannel(null);
    setActiveCamera(null);
    setIsMiniPlayerOpen(false);
  }, []);

  const expandMiniPlayer = useCallback(() => {
    if (activeChannel) {
      navigate(`/player/${activeChannel.id}`);
    } else if (activeCamera) {
      navigate(`/cameras/${activeCamera.id}`);
    }
    setIsMiniPlayerOpen(false);
  }, [activeChannel, activeCamera, navigate]);

  return (
    <PlayerContext.Provider
      value={{
        activeChannel,
        activeCamera,
        pipCamera,
        isMiniPlayerOpen,
        miniPlayerEnabled,
        cameraPipEnabled,
        isPlaying,
        isMuted,
        volume,
        playChannel,
        playCamera,
        setPipCamera,
        setMiniPlayerEnabled: setMiniPlayerEnabledState,
        setCameraPipEnabled: setCameraPipEnabledState,
        stopPlayback,
        setIsPlaying,
        setIsMuted,
        setVolume,
        expandMiniPlayer,
        closeMiniPlayer,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
}
