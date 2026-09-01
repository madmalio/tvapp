import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { getApiUrl } from "./lib/api";
import Sidebar from "./components/Sidebar";
import ChannelList from "./components/ChannelList";
import EpgGrid from "./components/EpgGrid";
import VideoPlayer from "./components/VideoPlayer";
import Settings from "./components/Settings";
import Cameras from "./components/Cameras";
import Recordings from "./components/Recordings";
import RecordingPlayer from "./components/RecordingPlayer";
import MiniPlayer from "./components/MiniPlayer";
import { PlayerProvider } from "./context/PlayerContext";
import { useSpeedTest } from "./hooks/useSpeedTest";
import ProfileSelection from "./components/ProfileSelection";
import Setup from "./components/Setup";
import { useApi } from "./hooks/useApi";

type Profile = { id: number; name: string; avatar_url: string; is_admin: boolean; has_pin?: boolean; };

export default function App() {
  useSpeedTest(); // Triggers the global speed test on first load
  const location = useLocation();

  const { data: profiles, loading: profilesLoading, refetch: refetchProfiles } = useApi<Profile[]>('/api/profiles');
  const [activeProfileId, setActiveProfileId] = useState<string | null>(localStorage.getItem('tvapp_active_profile_id'));

  useEffect(() => {
    const ping = () => {
      fetch(getApiUrl('/api/system/ping'), { method: 'POST' }).catch(() => {});
    };
    ping();
    const interval = window.setInterval(ping, 30000);
    return () => clearInterval(interval);
  }, []);

  const isPlayer = location.pathname.startsWith('/player') || (location.pathname.startsWith('/cameras/') && location.pathname !== '/cameras');

  if (profilesLoading) {
    return <div className="min-h-screen bg-neutral-950 flex items-center justify-center text-white">Loading...</div>;
  }

  // First-time setup
  if (profiles && profiles.length === 0) {
    return <Setup onComplete={() => window.location.reload()} />;
  }

  // If we have profiles, but no active profile is selected, show Profile Selection
  if (profiles && profiles.length > 0 && !activeProfileId) {
    return <ProfileSelection profiles={profiles} onSelect={(id) => {
      localStorage.setItem('tvapp_active_profile_id', id.toString());
      setActiveProfileId(id.toString());
      window.location.reload(); // Reload to apply headers across all hooks
    }} onProfileCreated={refetchProfiles} />;
  }

  return (
    <PlayerProvider>
      <div className="relative h-screen w-screen bg-neutral-950 text-white overflow-hidden">
        <main className="absolute inset-0 flex flex-col min-w-0">
          <Routes>
            <Route path="/channels" element={<ChannelList />} />
            <Route path="/guide" element={<EpgGrid />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/cameras/:cameraId" element={<Cameras />} />
            <Route path="/player/:channelId" element={<VideoPlayer />} />
            <Route path="/player/recording/:id" element={<RecordingPlayer />} />
            <Route path="/recordings" element={<Recordings />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/channels" replace />} />
          </Routes>
        </main>
        {!isPlayer && <Sidebar />}
        <MiniPlayer />
      </div>
    </PlayerProvider>
  );
}
