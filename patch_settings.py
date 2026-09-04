import os

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\Settings.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Imports
content = content.replace(
    '  AlertCircle,\n  Link2,\n  X\n} from "lucide-react";',
    '  AlertCircle,\n  Link2,\n  X,\n  Activity,\n  Database,\n  Upload,\n  Download,\n  AlertTriangle,\n  Loader2\n} from "lucide-react";'
)

# 2. Tabs Type
content = content.replace(
    "type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences';",
    "type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences' | 'system';"
)

# 3. State Variables
modals_str = """  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null);"""

new_modals = """  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null);
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmationText, setWipeConfirmationText] = useState("");

  // System State
  const [systemStats, setSystemStats] = useState<{
    goroutines: number;
    memory_mb: number;
    uptime: string;
    active_streams: number;
  } | null>(null);"""

content = content.replace(modals_str, new_modals)

# 4. API Functions
load_backend_str = """  // Load backend settings
  useEffect(() => {"""

api_funcs = """  // System Tab Effects
  useEffect(() => {
    let interval: number;
    if (activeTab === 'system') {
      const fetchStats = () => {
        fetch(getApiUrl("/api/system/stats"))
          .then(r => r.json())
          .then(setSystemStats)
          .catch(console.error);
      };
      fetchStats();
      interval = window.setInterval(fetchStats, 5000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  const handleWipeData = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/system/wipe"), { method: "POST" });
      if (!res.ok) throw new Error("Failed to wipe data");
      addToast({ type: "success", title: "Data Wiped", message: "All system data has been completely erased." });
      setShowWipeModal(false);
      setWipeConfirmationText("");
      clearApiCache();
      refetchSources();
    } catch (err: any) {
      addToast({ type: "error", title: "Wipe Failed", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleImportDatabase = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = addToast({ type: "loading", title: "Importing Database...", message: "Hot-reloading SQLite engine" }, 0);
    const formData = new FormData();
    formData.append("database", file);

    try {
      const res = await fetch(getApiUrl("/api/system/import"), { method: "POST", body: formData });
      removeToast(toastId);
      if (!res.ok) throw new Error(await res.text());
      addToast({ type: "success", title: "Import Successful", message: "Database reloaded successfully." });
      clearApiCache();
      refetchSources();
    } catch (err: any) {
      removeToast(toastId);
      addToast({ type: "error", title: "Import Failed", message: err.message });
    }
    e.target.value = "";
  };

  // Load backend settings
  useEffect(() => {"""

content = content.replace(load_backend_str, api_funcs)

# 5. Tab item in Array
tabs_arr = """    { id: 'preferences', label: 'Preferences', icon: Sliders },
  ];"""
new_tabs_arr = """    { id: 'preferences', label: 'Preferences', icon: Sliders },
    { id: 'system', label: 'System', icon: Activity },
  ];"""
content = content.replace(tabs_arr, new_tabs_arr)

# 6. UI and Wipe Modal
ui_insertion_point = """      {/* Add / Edit Source Modal */}"""

system_ui = """      {/* System Tab */}
      {activeTab === 'system' && (
        <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 p-3 sm:p-6 md:p-8">
          
          {/* System Monitor */}
          <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-neutral-700/50 shadow-md">
            <h3 className="text-base sm:text-lg font-medium text-white mb-3 sm:mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              System Monitor
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-neutral-900/50 border border-neutral-700/50 p-4 rounded-xl flex flex-col items-center justify-center text-center">
                <span className="text-xs text-neutral-400 mb-1 uppercase tracking-wider font-semibold">Uptime</span>
                <span className="text-lg sm:text-xl font-bold text-white">{systemStats?.uptime || '--'}</span>
              </div>
              <div className="bg-neutral-900/50 border border-neutral-700/50 p-4 rounded-xl flex flex-col items-center justify-center text-center">
                <span className="text-xs text-neutral-400 mb-1 uppercase tracking-wider font-semibold">Memory</span>
                <span className="text-lg sm:text-xl font-bold text-white">{systemStats?.memory_mb || 0} MB</span>
              </div>
              <div className="bg-neutral-900/50 border border-neutral-700/50 p-4 rounded-xl flex flex-col items-center justify-center text-center">
                <span className="text-xs text-neutral-400 mb-1 uppercase tracking-wider font-semibold">Goroutines</span>
                <span className="text-lg sm:text-xl font-bold text-white">{systemStats?.goroutines || 0}</span>
              </div>
              <div className="bg-neutral-900/50 border border-neutral-700/50 p-4 rounded-xl flex flex-col items-center justify-center text-center">
                <span className="text-xs text-neutral-400 mb-1 uppercase tracking-wider font-semibold">Active Streams</span>
                <span className="text-lg sm:text-xl font-bold text-white">{systemStats?.active_streams || 0}</span>
              </div>
            </div>
          </div>

          {/* Data Backup & Import */}
          <div className="bg-neutral-800/50 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-neutral-700/50 shadow-md">
            <h3 className="text-base sm:text-lg font-medium text-white mb-3 sm:mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-400" />
              Database Management
            </h3>
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <button 
                onClick={() => { window.location.href = getApiUrl('/api/system/backup'); }}
                className="w-full sm:w-auto bg-neutral-700 hover:bg-neutral-600 text-white text-xs sm:text-sm font-medium px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                <Download className="w-4 h-4" /> Export Database
              </button>
              <label className="w-full sm:w-auto bg-neutral-700 hover:bg-neutral-600 text-white text-xs sm:text-sm font-medium px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer">
                <Upload className="w-4 h-4" /> Import Database
                <input 
                  type="file" 
                  accept=".db" 
                  className="hidden" 
                  onChange={handleImportDatabase}
                />
              </label>
            </div>
            <p className="text-xs text-neutral-400 mt-3">
              Importing a new database will hot-reload the system and instantly replace all channels, recordings, and settings.
            </p>
          </div>

          {/* Danger Zone */}
          <div className="bg-red-900/10 backdrop-blur-md rounded-2xl p-4 sm:p-6 border border-red-900/30 shadow-md">
            <h3 className="text-base sm:text-lg font-medium text-red-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Danger Zone
            </h3>
            <p className="text-sm text-neutral-400 mb-4">
              Permanently erase all sources, channels, EPG data, and recordings from the database. This action cannot be undone.
            </p>
            <button 
              onClick={() => setShowWipeModal(true)}
              className="bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-medium px-4 py-2.5 rounded-lg transition-all flex items-center gap-2 shadow-md cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> Wipe All Data
            </button>
          </div>
        </div>
      )}

      {/* Wipe Modal */}
      {showWipeModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-red-900/50 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center text-red-500 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-white">Wipe All Data</h2>
            </div>
            <p className="text-sm text-neutral-300 mb-4">
              This will permanently delete everything in your database, including all sources, custom channels, guide data, and DVR recordings.
            </p>
            <p className="text-sm font-medium text-neutral-400 mb-2">
              Please type <span className="text-white font-bold bg-neutral-800 px-1.5 py-0.5 rounded">WIPE DATA</span> to confirm.
            </p>
            <input 
              type="text" 
              value={wipeConfirmationText}
              onChange={(e) => setWipeConfirmationText(e.target.value)}
              placeholder="WIPE DATA"
              className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 mb-6 font-mono text-center tracking-widest uppercase"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowWipeModal(false); setWipeConfirmationText(""); }}
                className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleWipeData}
                disabled={loading || wipeConfirmationText !== "WIPE DATA"}
                className="bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-bold px-6 py-2 rounded-lg transition-all cursor-pointer shadow-md"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm Wipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Source Modal */}"""
content = content.replace(ui_insertion_point, system_ui)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
