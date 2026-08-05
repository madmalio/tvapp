import { createContext, useContext, useRef, useCallback } from "react";
import Hls from "hls.js";

type HlsContextValue = {
  attach: (video: HTMLVideoElement, url: string) => void;
  detach: () => void;
};

const HlsContext = createContext<HlsContextValue | null>(null);

export function HlsProvider({ children }: { children: React.ReactNode }) {
  const hlsRef = useRef<Hls | null>(null);

  const attach = useCallback((video: HTMLVideoElement, url: string) => {
    detach();
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    }
  }, []);

  const detach = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  return (
    <HlsContext.Provider value={{ attach, detach }}>
      {children}
    </HlsContext.Provider>
  );
}

export function useHls() {
  const ctx = useContext(HlsContext);
  if (!ctx) throw new Error("useHls must be used within HlsProvider");
  return ctx;
}
