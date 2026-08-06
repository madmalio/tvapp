import { useState } from "react";
import { Server, Settings as SettingsIcon, Video, HardDrive, Sliders, Tv, Radio, Plus, Trash2, Edit2, RefreshCw } from "lucide-react";
import { getApiUrl } from "../lib/api";
import { useApi } from "../hooks/useApi";

type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences';
type Source = { id: number; name: string; type: string; url: string; epg_url: string; };

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('iptv');
  
  // IPTV Multi-Source State
  const { data: sources, refetch: refetchSources } = useApi<Source[]>('/api/sources');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null);
  
  // Form State
  const [formSource, setFormSource] = useState<Partial<Source>>({ type: 'iptv' });

  // Server State
  const [serverIp, setServerIp] = useState(localStorage.getItem('tvapp_server_ip') || "");
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("15");

  // DVR State (Placeholders)
  const [dvrPath, setDvrPath] = useState("");
  const [prePadding, setPrePadding] = useState("2");
  const [postPadding, setPostPadding] = useState("5");

  // Preferences State
  const [defaultLaunch, setDefaultLaunch] = useState("guide");
  const [defaultVolume, setDefaultVolume] = useState("50");

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
      
      setMessage(`Source saved. Background sync started.`);
      setShowAddModal(false);
      refetchSources();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteSource(id: number) {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/sources/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessage(`Source deleted.`);
      setShowDeleteModal(null);
      refetchSources();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const tabs = [
    { id: 'iptv', label: 'IPTV & Tuners', icon: Tv },
    { id: 'server', label: 'Server', icon: Server },
    { id: 'rtsp', label: 'RTSP Cameras', icon: Video },
    { id: 'dvr', label: 'DVR Settings', icon: HardDrive },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
  ];

  return (
    <div className="flex-1 flex flex-col bg-neutral-900 text-neutral-100 overflow-hidden pl-20 pt-6">
      
      {/* Header */}
      <div className="px-8 pb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-blue-500" />
          Settings
        </h1>
        <p className="text-neutral-400 mt-2">Manage your television and server configuration</p>
      </div>

      {/* Tabs */}
      <div className="px-8 border-b border-neutral-800 flex gap-6">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`pb-4 flex items-center gap-2 text-sm font-medium transition-colors border-b-2 ${
                isActive 
                  ? 'border-blue-500 text-blue-400' 
                  : 'border-transparent text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        <div className="max-w-3xl space-y-8 pb-20">
          
          {/* Notification Toast */}
          {message && (
            <div className="bg-blue-900/20 border border-blue-500/30 text-blue-300 rounded-xl px-4 py-3 text-sm flex items-center shadow-lg shadow-blue-900/10">
              <span className="relative flex h-3 w-3 mr-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
              {message}
            </div>
          )}

          {/* IPTV Tab */}
          {activeTab === 'iptv' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-white">Configured Sources</h3>
                <button
                  onClick={() => { setFormSource({ type: 'iptv' }); setShowAddModal(true); }}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-lg shadow-blue-900/20"
                >
                  <Plus className="w-4 h-4" />
                  Add Source
                </button>
              </div>

              {(!sources || sources.length === 0) ? (
                <div className="bg-neutral-800/30 border border-neutral-700/50 border-dashed rounded-2xl p-12 text-center">
                  <Tv className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                  <p className="text-neutral-400">No sources configured yet. Add an IPTV playlist or HDHomeRun tuner to get started.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {sources.map(src => (
                    <div key={src.id} className="bg-neutral-800/50 backdrop-blur-md rounded-xl p-5 border border-neutral-700/50 shadow-xl shadow-black/20 flex items-center justify-between group hover:border-blue-500/30 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-lg ${src.type === 'hdhomerun' ? 'bg-green-500/10 text-green-400' : 'bg-purple-500/10 text-purple-400'}`}>
                          {src.type === 'hdhomerun' ? <Server className="w-6 h-6" /> : <Radio className="w-6 h-6" />}
                        </div>
                        <div>
                          <h4 className="text-white font-medium text-lg">{src.name}</h4>
                          <p className="text-sm text-neutral-400 truncate max-w-md">{src.url}</p>
                          {src.epg_url && <p className="text-xs text-neutral-500 truncate max-w-md mt-0.5">EPG: {src.epg_url}</p>}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setFormSource(src); setShowAddModal(true); }}
                          className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setFormSource(src); saveSource({ preventDefault: () => {} } as any); }}
                          className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 rounded-lg transition-colors"
                          title="Force Refresh"
                        >
                          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => setShowDeleteModal(src.id)}
                          className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Server Tab */}
          {activeTab === 'server' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-6 border border-neutral-700/50 shadow-xl shadow-black/20">
                <h3 className="text-lg font-medium text-white mb-4">Backend Configuration</h3>
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Server IP Address</label>
                    <input
                      type="text"
                      value={serverIp}
                      onChange={(e) => {
                        setServerIp(e.target.value);
                        localStorage.setItem('tvapp_server_ip', e.target.value);
                      }}
                      placeholder="e.g. 192.168.1.100:8080"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-neutral-500 mt-2">Required for Android/TV app. Leave blank to use localhost.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Playlist Refresh Interval (Minutes)</label>
                    <input
                      type="number"
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(e.target.value)}
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Custom FFmpeg Path</label>
                    <input
                      type="text"
                      value={ffmpegPath}
                      onChange={(e) => setFfmpegPath(e.target.value)}
                      placeholder="/usr/bin/ffmpeg"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-neutral-500 mt-2">Leave blank to use system default. Required for RTSP transcodes and DVR.</p>
                  </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-neutral-700/50 flex justify-end">
                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-all">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* RTSP Tab */}
          {activeTab === 'rtsp' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-6 border border-neutral-700/50 flex flex-col items-center justify-center text-center py-12">
                <Video className="w-16 h-16 text-neutral-600 mb-4" />
                <h3 className="text-xl font-medium text-neutral-300 mb-2">RTSP Security Cameras</h3>
                <p className="text-neutral-500 max-w-md">Connect and manage local security cameras to view them directly on your TV. This feature is coming in a future update.</p>
              </div>
            </div>
          )}

          {/* DVR Tab */}
          {activeTab === 'dvr' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-6 border border-neutral-700/50 shadow-xl shadow-black/20">
                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-red-400" />
                  Recording Settings
                </h3>
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Storage Path</label>
                    <input
                      type="text"
                      value={dvrPath}
                      onChange={(e) => setDvrPath(e.target.value)}
                      placeholder="/mnt/dvr"
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1.5">Pre-padding (Minutes)</label>
                      <input
                        type="number"
                        value={prePadding}
                        onChange={(e) => setPrePadding(e.target.value)}
                        className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-400 mb-1.5">Post-padding (Minutes)</label>
                      <input
                        type="number"
                        value={postPadding}
                        onChange={(e) => setPostPadding(e.target.value)}
                        className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-neutral-700/50 flex justify-end">
                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-all">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Preferences Tab */}
          {activeTab === 'preferences' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-6 border border-neutral-700/50 shadow-xl shadow-black/20">
                <h3 className="text-lg font-medium text-white mb-4">Client Preferences</h3>
                
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Default Launch Page</label>
                    <select
                      value={defaultLaunch}
                      onChange={(e) => setDefaultLaunch(e.target.value)}
                      className="w-full bg-neutral-900/80 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none"
                    >
                      <option value="guide">EPG Guide</option>
                      <option value="channels">Channel List</option>
                      <option value="player">Last Played Channel</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1.5">Default Player Volume (%)</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={defaultVolume}
                      onChange={(e) => setDefaultVolume(e.target.value)}
                      className="w-full accent-blue-500"
                    />
                    <div className="text-right text-xs text-neutral-400 mt-1">{defaultVolume}%</div>
                  </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-neutral-700/50 flex justify-end">
                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-all">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Add/Edit Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-4">{formSource.id ? 'Edit Source' : 'Add Source'}</h2>
            
            <form onSubmit={saveSource} className="space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">Source Type</label>
                <select
                  value={formSource.type}
                  onChange={e => setFormSource({...formSource, type: e.target.value})}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none"
                  disabled={!!formSource.id}
                >
                  <option value="iptv">IPTV Playlist (M3U)</option>
                  <option value="hdhomerun">HDHomeRun Tuner</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">Display Name</label>
                <input
                  type="text"
                  required
                  value={formSource.name || ''}
                  onChange={e => setFormSource({...formSource, name: e.target.value})}
                  placeholder={formSource.type === 'iptv' ? "e.g. Pluto TV" : "e.g. Local Antenna"}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">{formSource.type === 'iptv' ? 'M3U Playlist URL' : 'Tuner IP Address (or auto-discovery URL)'}</label>
                <input
                  type="text"
                  required
                  value={formSource.url || ''}
                  onChange={e => setFormSource({...formSource, url: e.target.value})}
                  placeholder={formSource.type === 'iptv' ? "https://..." : "192.168.1.10"}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {formSource.type === 'iptv' && (
                <div>
                  <label className="block text-sm text-neutral-400 mb-1.5">XMLTV EPG URL (Optional)</label>
                  <input
                    type="url"
                    value={formSource.epg_url || ''}
                    onChange={e => setFormSource({...formSource, epg_url: e.target.value})}
                    placeholder="https://..."
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium px-6 py-2 rounded-lg transition-all"
                >
                  {loading ? 'Saving...' : 'Save Source'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-2">Delete Source?</h2>
            <p className="text-neutral-400 mb-6 text-sm">
              Are you sure you want to delete this source? This will permanently remove all of its channels and EPG data from your database.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSource(showDeleteModal)}
                disabled={loading}
                className="bg-red-600 hover:bg-red-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium px-6 py-2 rounded-lg transition-all"
              >
                {loading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
