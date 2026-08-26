import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import ChannelList from "./components/ChannelList";
import EpgGrid from "./components/EpgGrid";
import VideoPlayer from "./components/VideoPlayer";
import Settings from "./components/Settings";
import Cameras from "./components/Cameras";
import MiniPlayer from "./components/MiniPlayer";
import { PlayerProvider } from "./context/PlayerContext";
import { useSpeedTest } from "./hooks/useSpeedTest";

export default function App() {
  useSpeedTest(); // Triggers the global speed test on first load
  const location = useLocation();
  const isPlayer = location.pathname.startsWith('/player') || (location.pathname.startsWith('/cameras/') && location.pathname !== '/cameras');

  return (
    <PlayerProvider>
      <div className="relative h-screen w-screen bg-neutral-950 text-white overflow-hidden">
        {!isPlayer && <Sidebar />}
        <main className="absolute inset-0 flex flex-col min-w-0">
          <Routes>
            <Route path="/channels" element={<ChannelList />} />
            <Route path="/guide" element={<EpgGrid />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/cameras/:cameraId" element={<Cameras />} />
            <Route path="/player/:channelId" element={<VideoPlayer />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/channels" replace />} />
          </Routes>
        </main>
        <MiniPlayer />
      </div>
    </PlayerProvider>
  );
}
