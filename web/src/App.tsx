import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import ChannelList from "./components/ChannelList";
import EpgGrid from "./components/EpgGrid";
import VideoPlayer from "./components/VideoPlayer";
import Settings from "./components/Settings";

export default function App() {
  return (
    <div className="relative h-screen w-screen bg-neutral-950 text-white overflow-hidden">
      <Sidebar />
      <main className="absolute inset-0 flex flex-col min-w-0">
        <Routes>
          <Route path="/channels" element={<ChannelList />} />
          <Route path="/guide" element={<EpgGrid />} />
          <Route path="/player/:channelId" element={<VideoPlayer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/channels" replace />} />
        </Routes>
      </main>
    </div>
  );
}
