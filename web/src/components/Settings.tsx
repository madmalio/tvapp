import { useState } from "react";

export default function Settings() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [epgUrl, setEpgUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPlaylist() {
    if (!playlistUrl) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/playlists/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const channels = await res.json();
      setMessage(`Loaded ${channels.length} channels`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setMessage(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadEpg() {
    if (!epgUrl) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/epg/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: epgUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = await res.json();
      const count = entries ? entries.length : 0;
      setMessage(`Loaded ${count} EPG entries`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setMessage(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function scanDevices() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/devices");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const devices = await res.json();
      setMessage(`Found ${devices.length} HDHomeRun device(s)`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setMessage(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pl-20 space-y-6">
      <h2 className="text-lg font-semibold">Settings</h2>

      <section className="bg-neutral-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-300">IPTV Playlist</h3>
        <input
          type="url"
          value={playlistUrl}
          onChange={(e) => setPlaylistUrl(e.target.value)}
          placeholder="https://example.com/playlist.m3u"
          className="w-full bg-neutral-700 rounded px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={loadPlaylist}
          disabled={loading || !playlistUrl}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          {loading ? "Loading..." : "Load Playlist"}
        </button>
      </section>

      <section className="bg-neutral-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-300">EPG Source</h3>
        <input
          type="url"
          value={epgUrl}
          onChange={(e) => setEpgUrl(e.target.value)}
          placeholder="https://example.com/guide.xml"
          className="w-full bg-neutral-700 rounded px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={loadEpg}
          disabled={loading || !epgUrl}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          {loading ? "Loading..." : "Load EPG"}
        </button>
      </section>

      <section className="bg-neutral-800 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium text-neutral-300">HDHomeRun</h3>
        <button
          onClick={scanDevices}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-600 text-white text-sm px-4 py-2 rounded transition-colors"
        >
          {loading ? "Scanning..." : "Scan for Devices"}
        </button>
      </section>

      {message && (
        <p className="text-sm text-neutral-400 bg-neutral-800 rounded px-4 py-2">
          {message}
        </p>
      )}
    </div>
  );
}
