import sys

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\Settings.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update the useEffect
old_load = """      .then(data => {
        if (data.epg_sync_time) setEpgSyncTime(data.epg_sync_time);
      })"""
new_load = """      .then(data => {
        if (data.epg_sync_time) setEpgSyncTime(data.epg_sync_time);
        if (data.dvr_path) setDvrPath(data.dvr_path);
        if (data.pre_padding) setPrePadding(data.pre_padding);
        if (data.post_padding) setPostPadding(data.post_padding);
      })"""
content = content.replace(old_load, new_load)

# 2. Add saveDvrSettings function
old_saveServer = """  async function saveServerSettings() {"""
new_saveServer = """  async function saveDvrSettings() {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dvr_path: dvrPath,
          pre_padding: prePadding,
          post_padding: postPadding
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast({
        type: 'success',
        title: 'DVR Settings Saved',
        message: 'Recording preferences updated.'
      });
    } catch (err: any) {
      addToast({ type: 'error', title: 'Failed to Save', message: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function saveServerSettings() {"""
content = content.replace(old_saveServer, new_saveServer)

# 3. Attach saveDvrSettings to the button
old_button = """                  <button className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all cursor-pointer shadow-md">
                    Save Changes
                  </button>"""
new_button = """                  <button onClick={saveDvrSettings} disabled={loading} className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg transition-all cursor-pointer shadow-md">
                    {loading ? "Saving..." : "Save Changes"}
                  </button>"""
content = content.replace(old_button, new_button)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
