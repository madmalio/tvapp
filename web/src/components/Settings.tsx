import { useState, useEffect, useCallback } from "react";
import { 
  Server, 
  Settings as SettingsIcon, 
  Video, 
  HardDrive, 
  Sliders, 
  Tv, 
  Radio, 
  Plus, 
  Trash2, 
  Edit2, 
  RefreshCw, 
  GripVertical,
  CheckCircle2,
  AlertCircle,
  Link2,
  X
} from "lucide-react";
import { getApiUrl, clearApiCache } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { usePlayer } from "../context/PlayerContext";

type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences';
type Source = { id: number; name: string; type: string; url: string; epg_url: string; };

type Toast = {
  id: string;
  type: 'success' | 'error' | 'info' | 'loading';
  title: string;
  message?: string;
};

function formatSourceSummary(src: Source): string {
  if (src.type === 'hdhomerun') {
    const cleanHost = src.url.replace(/^https?:\/\//, '').split('/')[0];
    return `HDHR Tuner (${cleanHost})`;
  }
  try {
    const u = new URL(src.url);
    const domain = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    const file = parts.length > 0 ? parts[parts.length - 1] : '';
    const cleanFile = file.length > 16 ? file.slice(0, 14) + '…' : file;
    const epgLabel = src.epg_url ? 'XMLTV' : 'No EPG';
    return `${domain}${cleanFile ? ` / ${cleanFile}` : ''} • ${epgLabel}`;
  } catch {
    const raw = src.url.replace(/^https?:\/\//, '');
    return raw.length > 30 ? raw.slice(0, 28) + '…' : raw;
  }
}

function formatRtspSummary(url: string): string {
  const sanitized = url.replace(/^rtsp:\/\/[^@]+@/, 'rtsp://');
  return sanitized.length > 34 ? sanitized.slice(0, 32) + '…' : sanitized;
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('iptv');
  
  const { 
    miniPlayerEnabled, 
    setMiniPlayerEnabled,
    cameraPipEnabled,
    setCameraPipEnabled
  } = usePlayer();
  
  // IPTV Multi-Source State
  const { data: sources, refetch: refetchSources } = useApi<Source[]>('/api/sources');
  const [loading, setLoading] = useState(false);
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<number>>(new Set());
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [draggedSourceId, setDraggedSourceId] = useState<number | null>(null);
  const [draggableId, setDraggableId] = useState<number | null>(null);
  
  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null);
  
  // Form State
  const [formSource, setFormSource] = useState<Partial<Source>>({ type: 'iptv' });

  // Server State
  const [serverIp, setServerIp] = useState(localStorage.getItem('tvapp_server_ip') || "");
  const [epgSyncTime, setEpgSyncTime] = useState("03:00");
  const [ffmpegPath, setFfmpegPath] = useState("");

  // DVR State (Placeholders)
  const [dvrPath, setDvrPath] = useState("");
  const [prePadding, setPrePadding] = useState("2");
  const [postPadding, setPostPadding] = useState("5");

  // Preferences State
  const [defaultLaunch, setDefaultLaunch] = useState("guide");
  const [defaultVolume, setDefaultVolume] = useState("50");

  // Load backend settings
  useEffect(() => {
    fetch(getApiUrl("/api/settings"))
      .then(r => r.json())
      .then(data => {
        if (data.epg_sync_time) setEpgSyncTime(data.epg_sync_time);
      })
      .catch(console.error);
  }, []);

  async function saveServerSettings() {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epg_sync_time: epgSyncTime
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast({
        type: 'success',
        title: 'Server Settings Saved',
        message: `EPG background sync scheduled for ${epgSyncTime} daily.`
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to Save Settings',
        message: err.message
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveSource(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const isUpdate = !!formSource.id;
      const url = isUpdate ? `/api/sources/${formSource.id}` : `/api/sources`;
      const method = isUpdate ? 'PUT' : 'POST';
      
      const res = await fetch(getApiUrl(url), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formSource)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      addToast({
        type: 'success',
        title: isUpdate ? 'Source Updated' : 'Source Added',
        message: `${formSource.name || 'Source'} saved. Syncing channels and EPG data in background...`
      });
      clearApiCache();
      setShowAddModal(false);
      refetchSources();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Error Saving Source',
        message: err.message
      });
    } finally {
      setLoading(false);
    }
  }

  async function deleteSource(id: number) {
    setLoading(true);
    const targetSource = sources?.find(s => s.id === id);
    try {
      const res = await fetch(getApiUrl(`/api/sources/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast({
        type: 'success',
        title: 'Source Deleted',
        message: `${targetSource?.name || 'Source'} and its associated channels have been removed.`
      });
      clearApiCache();
      setShowDeleteModal(null);
      refetchSources();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Error Deleting Source',
        message: err.message
      });
    } finally {
      setLoading(false);
    }
  }

  async function refreshSingleSource(src: Source) {
    setRefreshingSourceIds(prev => new Set(prev).add(src.id));
    const toastId = addToast({
      type: 'loading',
      title: `Refreshing ${src.name}...`,
      message: 'Fetching latest playlist channels & XMLTV guide data'
    }, 0);

    try {
      const res = await fetch(getApiUrl(`/api/sources/${src.id}/refresh`), {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Allow backend sync to process
      await new Promise(r => setTimeout(r, 1200));

      removeToast(toastId);
      addToast({
        type: 'success',
        title: `${src.name} Refreshed`,
        message: 'Channels and guide data synced successfully.'
      });
      clearApiCache();
      refetchSources();
    } catch (err: any) {
      removeToast(toastId);
      addToast({
        type: 'error',
        title: `Failed to Refresh ${src.name}`,
        message: err.message
      });
    } finally {
      setRefreshingSourceIds(prev => {
        const next = new Set(prev);
        next.delete(src.id);
        return next;
      });
    }
  }

  async function refreshAllSources() {
    setIsRefreshingAll(true);
    const iptvSources = sources?.filter(s => s.type !== 'rtsp') || [];
    setRefreshingSourceIds(new Set(iptvSources.map(s => s.id)));

    const toastId = addToast({
      type: 'loading',
      title: 'Refreshing All Tuners & Sources...',
      message: 'Syncing channels and EPG entries for all active providers'
    }, 0);

    try {
      const res = await fetch(getApiUrl("/api/sources/refresh-all"), {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await new Promise(r => setTimeout(r, 2000));

      removeToast(toastId);
      addToast({
        type: 'success',
        title: 'All Sources Refreshed',
        message: `Successfully synced ${iptvSources.length} tuner source${iptvSources.length === 1 ? '' : 's'}.`
      });
      clearApiCache();
      refetchSources();
    } catch (err: any) {
      removeToast(toastId);
      addToast({
        type: 'error',
        title: 'Refresh All Failed',
        message: err.message
      });
    } finally {
      setIsRefreshingAll(false);
      setRefreshingSourceIds(new Set());
    }
  }

  const handleDrop = async (e: React.DragEvent, dropSourceId: number) => {
    e.preventDefault();
    if (draggedSourceId === null || draggedSourceId === dropSourceId || !sources) return;

    const newSources = [...sources];
    const dragIdx = newSources.findIndex(s => s.id === draggedSourceId);
    const dropIdx = newSources.findIndex(s => s.id === dropSourceId);
    
    if (dragIdx === -1 || dropIdx === -1) return;

    const [draggedItem] = newSources.splice(dragIdx, 1);
    newSources.splice(dropIdx, 0, draggedItem);
    
    setLoading(true);
    try {
      const ids = newSources.map(s => s.id);
      const res = await fetch(getApiUrl("/api/sources/order"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids)
      });
      if (!res.ok) throw new Error("Failed to save order");
      
      clearApiCache();
      refetchSources();
      addToast({
        type: 'success',
        title: 'Source Order Updated',
        message: 'New tab priority order saved.'
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Error Saving Order',
        message: err.message
      });
    } finally {
      setLoading(false);
      setDraggedSourceId(null);
    }
  };

  const tabs = [
    { id: 'iptv', label: 'IPTV & Tuners', icon: Tv },
    { id: 'server', label: 'Server', icon: Server },
    { id: 'rtsp', label: 'RTSP Cameras', icon: Video },
    { id: 'dvr', label: 'DVR Settings', icon: HardDrive },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
  ];

  return (
    <div className="flex-1 flex flex-col bg-neutral-900 text-neutral-100 overflow-x-hidden md:pl-20 pb-16 md:pb-0 pt-3 sm:pt-6 w-full max-w-full">
      
      {/* Header */}
      <div className="px-3 sm:px-6 md:px-8 pb-3 sm:pb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold flex items-center gap-2 sm:gap-3">
          <SettingsIcon className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
          Settings
        </h1>
        <p className="text-neutral-400 mt-0.5 sm:mt-1 text-xs sm:text-sm">Manage your television and server configuration</p>
      </div>

      {/* Tabs */}
      <div className="px-3 sm:px-6 md:px-8 border-b border-neutral-800 flex gap-2 sm:gap-6 overflow-x-auto no-scrollbar py-0.5">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`pb-2.5 sm:pb-4 px-1 sm:px-0 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-medium transition-colors border-b-2 cursor-pointer whitespace-nowrap shrink-0 ${
                isActive 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-3 sm:p-6 md:p-8 w-full max-w-full">
        <div className="max-w-3xl space-y-4 sm:space-y-6 pb-20 w-full">
          
          {(() => {
            const iptvSources = sources?.filter(s => s.type !== 'rtsp') || [];
            const rtspSources = sources?.filter(s => s.type === 'rtsp') || [];
            return (
              <>

          {/* IPTV Tab */}
          {activeTab === 'iptv' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              
              <div className="flex justify-between items-center gap-2 mb-3 sm:mb-6">
                <div className="min-w-0">
                  <h3 className="text-base sm:text-xl font-semibold text-white truncate">Configured Sources</h3>
                  <p className="text-[11px] sm:text-sm text-neutral-400 mt-0.5 truncate">Playlists and HDHomeRun tuners</p>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                  {iptvSources.length > 0 && (
                    <button
                      onClick={refreshAllSources}
                      disabled={isRefreshingAll}
                      className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 hover:text-white text-xs sm:text-sm font-medium px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg flex items-center gap-1.5 transition-all border border-neutral-700 hover:border-neutral-600 shadow-md cursor-pointer"
                      title="Refresh all playlists and guide data"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRefreshingAll ? 'animate-spin' : ''}`} />
                      <span className="hidden xs:inline sm:inline">{isRefreshingAll ? 'Refreshing...' : 'Refresh All'}</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setFormSource({ type: 'iptv' }); setShowAddModal(true); }}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/20 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span>Add Source</span>
                  </button>
                </div>
              </div>

              {iptvSources.length === 0 ? (
                <div className="bg-neutral-800/30 border border-neutral-700/50 border-dashed rounded-2xl p-6 sm:p-12 text-center">
                  <Tv className="w-10 h-10 sm:w-12 sm:h-12 text-neutral-600 mx-auto mb-3 sm:mb-4" />
                  <p className="text-neutral-400 text-xs sm:text-base">No sources configured yet. Add an IPTV playlist or HDHomeRun tuner to get started.</p>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:gap-3">
                  {iptvSources.map((src) => {
                    const isRefreshing = refreshingSourceIds.has(src.id);
                    return (
                      <div 
                        key={src.id} 
                        draggable={draggableId === src.id}
                        onDragStart={(e) => {
                          setDraggedSourceId(src.id!);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => handleDrop(e, src.id!)}
                        className={`bg-neutral-800/60 backdrop-blur-md rounded-xl p-2.5 sm:p-4 border shadow-md transition-colors ${
                          draggedSourceId === src.id ? 'border-blue-500 opacity-50' : 'border-neutral-700/60 hover:border-blue-500/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <div 
                              className="hidden sm:block cursor-move p-1 text-neutral-600 hover:text-white transition-colors pointer-events-auto shrink-0"
                              onMouseEnter={() => setDraggableId(src.id)}
                              onMouseLeave={() => setDraggableId(null)}
                            >
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <div className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${src.type === 'hdhomerun' ? 'bg-green-500/10 text-green-400' : 'bg-purple-500/10 text-purple-400'}`}>
                              {src.type === 'hdhomerun' ? <Server className="w-4 h-4 sm:w-5 sm:h-5" /> : <Radio className="w-4 h-4 sm:w-5 sm:h-5" />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-white font-medium text-sm sm:text-base truncate">{src.name}</h4>
                                <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded border ${src.type === 'hdhomerun' ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-purple-400 bg-purple-500/10 border-purple-500/20'}`}>
                                  {src.type === 'hdhomerun' ? 'HDHR' : 'M3U'}
                                </span>
                                {isRefreshing && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                    Syncing
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => { setFormSource(src); setShowAddModal(true); }}
                              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-700/70 rounded-lg transition-colors cursor-pointer"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </button>
                            <button
                              onClick={() => refreshSingleSource(src)}
                              disabled={isRefreshing}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                isRefreshing 
                                  ? 'text-blue-400 bg-blue-900/30' 
                                  : 'text-blue-400 hover:text-blue-300 hover:bg-blue-900/30'
                              }`}
                              title="Force Refresh"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                            </button>
                            <button
                              onClick={() => setShowDeleteModal(src.id)}
                              className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Mobile: Concatenated single-line info pill */}
                        <div className="sm:hidden mt-2 pt-1.5 border-t border-neutral-700/30 flex items-center gap-1.5 text-[11px] text-neutral-400 bg-neutral-900/60 px-2 py-1 rounded-md">
                          <Link2 className="w-3 h-3 text-blue-400 shrink-0" />
                          <span className="truncate">{formatSourceSummary(src)}</span>
                        </div>

                        {/* Tablet / Desktop: Full URL and EPG details */}
                        <div className="hidden sm:block mt-1.5 pt-1.5 border-t border-neutral-700/30 text-xs text-neutral-400 space-y-0.5 pl-0.5">
                          <p className="truncate text-neutral-400"><span className="text-neutral-500 font-medium">URL:</span> {src.url}</p>
                          {src.epg_url && <p className="truncate text-neutral-500"><span className="text-neutral-600 font-medium">EPG:</span> {src.epg_url}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Server Tab */}
          {activeTab === 'server' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-neutral-700/50 shadow-md">
                <h3 className="text-base sm:text-lg font-medium text-white mb-3 sm:mb-4">Backend Configuration</h3>
                
                <div className="space-y-3.5 sm:space-y-5">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Server IP Address</label>
                    <input
                      type="text"
                      value={serverIp}
                      onChange={(e) => {
                        setServerIp(e.target.value);
                        localStorage.setItem('tvapp_server_ip', e.target.value);
                      }}
                      placeholder="e.g. 192.168.1.100:8080"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] sm:text-xs text-neutral-500 mt-1">Required for Android/TV app. Leave blank to use localhost.</p>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Nightly Background Sync Time</label>
                    <input
                      type="time"
                      value={epgSyncTime}
                      onChange={(e) => setEpgSyncTime(e.target.value)}
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] sm:text-xs text-neutral-500 mt-1">The time of day when channels and EPG data are automatically refreshed.</p>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Custom FFmpeg Path</label>
                    <input
                      type="text"
                      value={ffmpegPath}
                      onChange={(e) => setFfmpegPath(e.target.value)}
                      placeholder="/usr/bin/ffmpeg"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] sm:text-xs text-neutral-500 mt-1">Leave blank to use system default. Required for RTSP transcodes and DVR.</p>
                  </div>
                </div>
                
                <div className="mt-5 sm:mt-6 pt-4 sm:pt-6 border-t border-neutral-700/50 flex justify-end">
                  <button 
                    onClick={saveServerSettings}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all cursor-pointer shadow-md"
                  >
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* RTSP Tab */}
          {activeTab === 'rtsp' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              
              <div className="flex justify-between items-center gap-2 mb-3 sm:mb-6">
                <div className="min-w-0">
                  <h3 className="text-base sm:text-xl font-semibold text-white truncate">Security Cameras</h3>
                  <p className="text-[11px] sm:text-sm text-neutral-400 mt-0.5 truncate">Manage live RTSP camera feeds</p>
                </div>
                <button
                  onClick={() => { setFormSource({ type: 'rtsp' }); setShowAddModal(true); }}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/20 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>Add Camera</span>
                </button>
              </div>

              {rtspSources.length === 0 ? (
                <div className="bg-neutral-800/30 border border-neutral-700/50 border-dashed rounded-2xl p-6 sm:p-12 text-center">
                  <Video className="w-10 h-10 sm:w-12 sm:h-12 text-neutral-600 mx-auto mb-3 sm:mb-4" />
                  <p className="text-neutral-400 text-xs sm:text-base">No cameras configured yet. Add an RTSP stream to get started.</p>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:gap-3">
                  {rtspSources.map((src) => (
                    <div 
                      key={src.id} 
                      draggable={draggableId === src.id}
                      onDragStart={(e) => {
                        setDraggedSourceId(src.id!);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => handleDrop(e, src.id!)}
                      className={`bg-neutral-800/60 backdrop-blur-md rounded-xl p-2.5 sm:p-4 border shadow-md transition-colors ${
                        draggedSourceId === src.id ? 'border-blue-500 opacity-50' : 'border-neutral-700/60 hover:border-blue-500/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <div 
                            className="hidden sm:block cursor-move p-1 text-neutral-600 hover:text-white transition-colors pointer-events-auto shrink-0"
                            onMouseEnter={() => setDraggableId(src.id)}
                            onMouseLeave={() => setDraggableId(null)}
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>
                          <div className="p-1.5 sm:p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                            <Video className="w-4 h-4 sm:w-5 sm:h-5" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-white font-medium text-sm sm:text-base truncate">{src.name}</h4>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button 
                            onClick={() => { setFormSource(src); setShowAddModal(true); }}
                            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-700/70 rounded-lg transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <SettingsIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          </button>
                          <button 
                            onClick={() => setShowDeleteModal(src.id!)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Mobile: Concatenated stream info */}
                      <div className="sm:hidden mt-2 pt-1.5 border-t border-neutral-700/30 flex items-center gap-1.5 text-[11px] text-neutral-400 bg-neutral-900/60 px-2 py-1 rounded-md">
                        <Video className="w-3 h-3 text-blue-400 shrink-0" />
                        <span className="truncate">{formatRtspSummary(src.url)}</span>
                      </div>

                      {/* Tablet / Desktop: Full URL */}
                      <div className="hidden sm:block mt-1.5 pt-1.5 border-t border-neutral-700/30 text-xs text-neutral-400 pl-0.5">
                        <p className="truncate text-neutral-400"><span className="text-neutral-500 font-medium">RTSP:</span> {src.url}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DVR Tab */}
          {activeTab === 'dvr' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-neutral-700/50 shadow-md">
                <h3 className="text-base sm:text-lg font-medium text-white mb-3 sm:mb-4 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
                  Recording Settings
                </h3>
                
                <div className="space-y-3.5 sm:space-y-5">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Recordings Directory</label>
                    <input
                      type="text"
                      value={dvrPath}
                      onChange={(e) => setDvrPath(e.target.value)}
                      placeholder="e.g. /var/media/recordings or D:\TVRecordings"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] sm:text-xs text-neutral-500 mt-1">Destination folder for scheduled and manual program captures.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Pre-Padding (Minutes)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={prePadding}
                        onChange={(e) => setPrePadding(e.target.value)}
                        className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Post-Padding (Minutes)</label>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={postPadding}
                        onChange={(e) => setPostPadding(e.target.value)}
                        className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-6 pt-4 sm:pt-6 border-t border-neutral-700/50 flex justify-end">
                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all cursor-pointer shadow-md">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-neutral-700/50 shadow-md">
                <h3 className="text-base sm:text-lg font-medium text-white mb-3 sm:mb-4">Application Behavior</h3>
                
                <div className="space-y-3.5 sm:space-y-5">
                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Default Launch Page</label>
                    <select
                      value={defaultLaunch}
                      onChange={(e) => setDefaultLaunch(e.target.value)}
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
                    >
                      <option value="guide">EPG Guide</option>
                      <option value="channels">Channel List</option>
                      <option value="player">Last Played Channel</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs sm:text-sm font-medium text-neutral-400 mb-1">Default Player Volume (%)</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={defaultVolume}
                      onChange={(e) => setDefaultVolume(e.target.value)}
                      style={{
                        background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${defaultVolume}%, #525252 ${defaultVolume}%, #525252 100%)`
                      }}
                      className="w-full h-2 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                    />
                    <div className="text-right text-[11px] sm:text-xs text-neutral-400 mt-1">{defaultVolume}%</div>
                  </div>
                </div>

                <div className="mt-6 pt-5 border-t border-neutral-700/50 space-y-4">
                  <h4 className="text-xs sm:text-sm font-semibold text-neutral-300 uppercase tracking-wider">
                    Picture-in-Picture (PiP) Options
                  </h4>

                  {/* In-App MiniPlayer Toggle */}
                  <div className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-neutral-900/60 border border-neutral-700/50">
                    <div className="pr-4">
                      <div className="text-xs sm:text-sm font-medium text-white">In-App MiniPlayer</div>
                      <div className="text-[11px] sm:text-xs text-neutral-400 mt-0.5">
                        Dock stream into a floating corner mini-player when browsing channels or the TV guide.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={miniPlayerEnabled}
                        onChange={(e) => {
                          setMiniPlayerEnabled(e.target.checked);
                          addToast({
                            type: 'success',
                            title: e.target.checked ? 'MiniPlayer Enabled' : 'MiniPlayer Disabled',
                            message: e.target.checked 
                              ? 'Streams will dock into a floating mini-player upon leaving player.' 
                              : 'Streams will stop when exiting full player.'
                          });
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-neutral-900/60 border border-neutral-700/50">
                    <div className="pr-4">
                      <div className="text-xs sm:text-sm font-medium text-white">Camera Picture-in-Picture</div>
                      <div className="text-[11px] sm:text-xs text-neutral-400 mt-0.5">
                        Show a floating overlay of any RTSP security camera on top of live TV broadcasts.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={cameraPipEnabled}
                        onChange={(e) => {
                          setCameraPipEnabled(e.target.checked);
                          addToast({
                            type: 'success',
                            title: e.target.checked ? 'Camera PiP Enabled' : 'Camera PiP Disabled',
                            message: e.target.checked 
                              ? 'Security cameras can now be pinned over TV broadcasts.' 
                              : 'Security cameras will no longer overlay TV broadcasts.'
                          });
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}
              </>
            );
          })()}

        </div>
      </div>

      {/* Add / Edit Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-3 sm:mb-4">
              {formSource.id 
                ? (formSource.type === 'rtsp' ? 'Edit Security Camera' : 'Edit Source') 
                : (formSource.type === 'rtsp' ? 'Add Security Camera' : 'Add Tuner Source')}
            </h2>
            
            <form onSubmit={saveSource} className="space-y-3.5">
              {formSource.type !== 'rtsp' && (
              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-1">Source Type</label>
                <select
                  value={formSource.type}
                  onChange={e => setFormSource({...formSource, type: e.target.value})}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500 appearance-none"
                  disabled={!!formSource.id}
                >
                  <option value="iptv">IPTV Playlist (M3U)</option>
                  <option value="hdhomerun">HDHomeRun Tuner</option>
                </select>
              </div>
            )}

              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-1">{formSource.type === 'rtsp' ? 'Camera Name' : 'Display Name'}</label>
                <input
                  type="text"
                  required
                  value={formSource.name || ''}
                  onChange={e => setFormSource({...formSource, name: e.target.value})}
                  placeholder={formSource.type === 'iptv' ? "e.g. Pluto TV" : formSource.type === 'rtsp' ? "e.g. Front Porch" : "e.g. Local Antenna"}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-1">{formSource.type === 'iptv' ? 'M3U Playlist URL' : formSource.type === 'rtsp' ? 'RTSP Stream URL' : 'Tuner IP Address'}</label>
                <input
                  type="text"
                  required
                  value={formSource.url || ''}
                  onChange={e => setFormSource({...formSource, url: e.target.value})}
                  placeholder={formSource.type === 'iptv' ? "https://..." : formSource.type === 'rtsp' ? "rtsp://user:pass@192.168.1.50/stream1" : "192.168.1.10"}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {formSource.type === 'iptv' && (
                <div>
                  <label className="block text-xs sm:text-sm text-neutral-400 mb-1">XMLTV EPG URL (Optional)</label>
                  <input
                    type="url"
                    value={formSource.epg_url || ''}
                    onChange={e => setFormSource({...formSource, epg_url: e.target.value})}
                    placeholder="https://..."
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2.5 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 rounded-lg transition-all cursor-pointer shadow-md"
                >
                  {loading ? "Saving..." : formSource.type === "rtsp" ? "Save Camera" : "Save Source"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">{sources?.find(s => s.id === showDeleteModal)?.type === 'rtsp' ? 'Delete Camera?' : 'Delete Source?'}</h2>
            <p className="text-neutral-400 mb-5 text-xs sm:text-sm">
              {sources?.find(s => s.id === showDeleteModal)?.type === 'rtsp' 
                ? 'Are you sure you want to delete this camera? This action cannot be undone.' 
                : 'Are you sure you want to delete this source? This will permanently remove all of its channels and EPG data from your database.'}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSource(showDeleteModal)}
                disabled={loading}
                className="bg-red-600 hover:bg-red-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 rounded-lg transition-all cursor-pointer shadow-md"
              >
                {loading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification Container */}
      <div className="fixed bottom-20 md:bottom-6 right-3 sm:right-6 left-3 sm:left-auto z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 sm:p-4 rounded-xl shadow-2xl backdrop-blur-xl border transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in ${
              t.type === 'success'
                ? 'bg-neutral-900/95 border-emerald-500/40 text-emerald-300 shadow-emerald-950/20'
                : t.type === 'error'
                ? 'bg-neutral-900/95 border-red-500/40 text-red-300 shadow-red-950/20'
                : t.type === 'loading'
                ? 'bg-neutral-900/95 border-blue-500/40 text-blue-300 shadow-blue-950/20'
                : 'bg-neutral-900/95 border-neutral-700 text-neutral-200'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />}
              {t.type === 'error' && <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />}
              {t.type === 'loading' && <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400 animate-spin" />}
              {t.type === 'info' && <Tv className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-xs sm:text-sm text-white">{t.title}</p>
              {t.message && <p className="text-[11px] sm:text-xs text-neutral-400 mt-0.5 break-words">{t.message}</p>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-neutral-400 hover:text-white p-1 -mr-1 -mt-1 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}

