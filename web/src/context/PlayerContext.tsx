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
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  playChannel: (channel: ChannelInfo) => void;
  playCamera: (camera: CameraInfo) => void;
  setPipCamera: (camera: CameraInfo | null) => void;
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

  const location = useLocation();
  const navigate = useNavigate();

  const isFullPlayerRoute = 
    location.pathname.startsWith("/player/") || 
    (location.pathname.startsWith("/cameras/") && location.pathname !== "/cameras");

  // Manage mini-player visibility based on active playback and current route
  useEffect(() => {
    if (isFullPlayerRoute) {
      setIsMiniPlayerOpen(false);
    } else if (activeChannel || activeCamera) {
      setIsMiniPlayerOpen(true);
    } else {
      setIsMiniPlayerOpen(false);
    }
  }, [isFullPlayerRoute, activeChannel, activeCamera]);

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
        isPlaying,
        isMuted,
        volume,
        playChannel,
        playCamera,
        setPipCamera,
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
