import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Play, AlertCircle, CheckCircle2, Loader2, X, Square, Download, Check, ListChecks } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { getApiUrl, getApiHeaders } from "../lib/api";

type Recording = {
  id: number;
  channel_id: number;
  epg_id?: number;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
  file_path?: string;
  created_at: string;
};

type Toast = {
  id: string;
  title: string;
  message?: string;
  type: "success" | "error" | "info" | "loading";
  duration?: number;
};

export default function Recordings() {
  const navigate = useNavigate();
  const { data: recordings, refetch } = useApi<Recording[]>("/api/recordings", 5000);
  const [activeTab, setActiveTab] = useState<"library" | "scheduled">("library");
  const [showDeleteModal, setShowDeleteModal] = useState<number | null>(null);
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(({ title, message, type = 'info', duration = 3000 }: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type, duration }]);
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

  const deleteRecording = async (id: number) => {
    try {
      await fetch(getApiUrl(`/api/recordings/${id}`), { method: "DELETE", headers: getApiHeaders() });
      refetch();
      addToast({ title: "Recording Deleted", type: "success" });
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } catch (err) {
      console.error(err);
      addToast({ title: "Failed to delete recording", type: "error" });
    }
    setShowDeleteModal(null);
  };

  const batchDeleteRecordings = async () => {
    let successCount = 0;
    for (const id of selectedIds) {
      try {
        await fetch(getApiUrl(`/api/recordings/${id}`), { method: "DELETE", headers: getApiHeaders() });
        successCount++;
      } catch (err) {
        console.error(err);
      }
    }
    
    refetch();
    if (successCount === selectedIds.size) {
      addToast({ title: `Successfully deleted ${successCount} recordings`, type: "success" });
    } else {
      addToast({ title: `Deleted ${successCount}/${selectedIds.size} recordings`, type: "error" });
    }
    
    setSelectedIds(new Set());
    setShowBatchDeleteModal(false);
  };

  const handleTabChange = (tab: "library" | "scheduled") => {
    setActiveTab(tab);
    setSelectedIds(new Set());
  };

  const filtered = recordings?.filter(r => 
    activeTab === "scheduled" 
      ? (r.status === "scheduled" || r.status === "recording")
      : (r.status === "completed" || r.status === "failed" || r.status === "processing")
  ) || [];

  const scheduledCount = recordings?.filter(r => r.status === "scheduled" || r.status === "recording").length || 0;
  const isCurrentlyRecording = recordings?.some(r => r.status === "recording") || false;

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 px-4 sm:px-6 md:pl-28 md:pr-12 pt-6 sm:pt-8 pb-20 md:pb-8 overflow-y-auto relative w-full">
      <div className="w-full">
        <h1 className="text-3xl font-bold text-white mb-6">Recordings</h1>
        
        <div className="flex gap-4 mb-4 border-b border-neutral-800 pb-2">
          <button
            onClick={() => handleTabChange("library")}
            className={`pb-2 px-2 font-medium transition-colors ${activeTab === "library" ? "text-blue-500 border-b-2 border-blue-500" : "text-neutral-400 hover:text-white"}`}
          >
            Library
          </button>
          <button
            onClick={() => handleTabChange("scheduled")}
            className={`pb-2 px-2 font-medium transition-colors flex items-center gap-2 ${activeTab === "scheduled" ? "text-blue-500 border-b-2 border-blue-500" : "text-neutral-400 hover:text-white"}`}
          >
            Scheduled
            {scheduledCount > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isCurrentlyRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-neutral-800 text-neutral-300'}`}>
                {scheduledCount}
              </span>
            )}
          </button>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                if (selectedIds.size === filtered.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filtered.map(r => r.id)));
                }
              }}
              className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer text-neutral-400 hover:text-white hover:bg-neutral-800/50"
            >
              <div className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all ${selectedIds.size === filtered.length ? 'bg-blue-600 border-blue-600' : 'border-neutral-600 bg-transparent'}`}>
                {selectedIds.size === filtered.length && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
              Select All
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBatchDeleteModal(true)}
                className="flex items-center gap-2 text-sm font-medium text-red-400 hover:text-white transition-colors bg-red-500/10 hover:bg-red-600 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-600 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected ({selectedIds.size})
              </button>
            )}
          </div>
        )}

        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="text-center p-8 bg-neutral-900/50 rounded-xl border border-neutral-800">
              <p className="text-neutral-400">No {activeTab} recordings found.</p>
            </div>
          ) : (
            filtered.map(r => {
              const isSelected = selectedIds.has(r.id);
              return (
                <div 
                  key={r.id} 
                  onClick={() => {
                    const newSet = new Set(selectedIds);
                    if (isSelected) newSet.delete(r.id);
                    else newSet.add(r.id);
                    setSelectedIds(newSet);
                  }}
                  className={`group rounded-xl p-4 flex items-center justify-between gap-4 transition-all border cursor-pointer ${
                    isSelected 
                      ? 'bg-blue-900/20 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                      : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/50'
                  }`}
                >
                  <div className="flex items-center gap-4 shrink-0">
                    <div className={`w-5 h-5 rounded-[6px] border-2 flex items-center justify-center transition-all ${
                      isSelected 
                        ? 'bg-blue-600 border-blue-600' 
                        : 'border-neutral-600 group-hover:border-neutral-500 bg-transparent'
                    }`}>
                      {isSelected && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-white text-lg truncate">{r.title}</h3>
                    {r.status === "recording" && (
                      <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse">RECORDING</span>
                    )}
                    {r.status === "processing" && (
                      <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse">SAVING...</span>
                    )}
                    {r.status === "failed" && (
                      <span className="bg-red-900/50 text-red-400 border border-red-800 text-[10px] font-bold px-2 py-0.5 rounded">FAILED</span>
                    )}
                  </div>
                  <p className="text-sm text-neutral-400">
                    {new Date(r.start_time).toLocaleString()} - {new Date(r.end_time).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.status === "completed" && r.file_path && (
                    <>
                      <button 
                        onClick={(e) => { e.stopPropagation(); navigate(`/player/recording/${r.id}`); }}
                        className="p-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded-lg transition-colors cursor-pointer"
                        title="Play Recording"
                      >
                        <Play className="w-5 h-5" />
                      </button>
                      <a 
                        href={getApiUrl(`/${r.file_path}`)}
                        onClick={(e) => e.stopPropagation()}
                        download
                        className="p-2 bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center justify-center"
                        title="Download Recording"
                      >
                        <Download className="w-5 h-5" />
                      </a>
                    </>
                  )}
                  {r.status === "recording" && (
                    <button 
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await fetch(getApiUrl(`/api/recordings/${r.id}/stop`), { method: "POST", headers: getApiHeaders() });
                          refetch();
                          addToast({ title: "Recording Stopped", type: "success" });
                        } catch (err) {
                          console.error(err);
                          addToast({ title: "Failed to stop recording", type: "error" });
                        }
                      }}
                      className="p-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600 hover:text-white rounded-lg transition-colors cursor-pointer"
                      title="Stop & Save Recording"
                    >
                      <Square className="w-5 h-5" />
                    </button>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowDeleteModal(r.id); }}
                    className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title={activeTab === "scheduled" ? "Cancel Recording" : "Delete Recording"}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">
              {recordings?.find(r => r.id === showDeleteModal)?.status === 'scheduled' ? 'Cancel Recording?' : 'Delete Recording?'}
            </h2>
            <p className="text-neutral-400 mb-5 text-xs sm:text-sm">
              Are you sure you want to {recordings?.find(r => r.id === showDeleteModal)?.status === 'scheduled' ? 'cancel' : 'delete'} this recording? 
              {recordings?.find(r => r.id === showDeleteModal)?.status === 'completed' && " The recorded file will be permanently removed from disk."}
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRecording(showDeleteModal)}
                className="bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 rounded-lg transition-all cursor-pointer shadow-md"
              >
                {recordings?.find(r => r.id === showDeleteModal)?.status === 'scheduled' ? 'Cancel Recording' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {showBatchDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-2">
              {activeTab === 'scheduled' ? 'Cancel' : 'Delete'} {selectedIds.size} Recordings?
            </h2>
            <p className="text-neutral-400 mb-5 text-xs sm:text-sm">
              Are you sure you want to {activeTab === 'scheduled' ? 'cancel' : 'delete'} the {selectedIds.size} selected recordings?
              {activeTab !== 'scheduled' && " Recorded files will be permanently removed from disk."} This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setShowBatchDeleteModal(false)}
                className="px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={batchDeleteRecordings}
                className="bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 rounded-lg transition-all cursor-pointer shadow-md"
              >
                {activeTab === 'scheduled' ? 'Cancel Selected' : 'Delete Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification Container */}
      <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl shadow-xl pointer-events-auto border backdrop-blur-md transition-all duration-300 animate-in slide-in-from-right-8 sm:slide-in-from-bottom-5 fade-in min-w-[280px] max-w-sm ${
              t.type === 'success'
                ? 'bg-emerald-900/40 border-emerald-800 text-emerald-300'
                : t.type === 'error'
                ? 'bg-red-900/40 border-red-800 text-red-300'
                : t.type === 'loading'
                ? 'bg-blue-900/40 border-blue-800 text-blue-300'
                : 'bg-neutral-900/80 border-neutral-700 text-neutral-300'
            }`}
          >
            <div className="flex items-center gap-3">
              {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {t.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}
              {t.type === 'loading' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
              <div>
                <h4 className="font-semibold text-sm">{t.title}</h4>
                {t.message && <p className="text-xs opacity-80 mt-0.5">{t.message}</p>}
              </div>
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="p-1 hover:bg-black/20 rounded-lg transition-colors opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
