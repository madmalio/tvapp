import sys

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\EpgGrid.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the "Schedule Recording" button with a conditional one
old_button = """                <button 
                  onClick={() => {
                    const isLive = new Date(selectedProgram.entry.start_time) <= currentTime;
                    fetch(getApiUrl('/api/recordings'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        channel_id: selectedProgram.channel.id,
                        epg_id: selectedProgram.entry.id > 0 ? selectedProgram.entry.id : 0,
                        title: selectedProgram.entry.title,
                        start_time: isLive ? new Date().toISOString() : selectedProgram.entry.start_time,
                        end_time: selectedProgram.entry.end_time
                      })
                    }).then(() => {
                      addToast({ title: "Recording scheduled!", type: "success" });
                      setSelectedProgram(null);
                    }).catch(err => {
                      console.error(err);
                      addToast({ title: "Failed to schedule recording", type: "error" });
                    });
                  }}
                  className="px-5 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shadow-lg shadow-blue-500/20 border border-blue-500"
                >
                  {new Date(selectedProgram.entry.start_time) <= currentTime ? 'Record Remaining' : 'Schedule Recording'}
                </button>"""

new_button = """                {scheduledEpgIds.has(selectedProgram.entry.id) ? (
                  <button 
                    onClick={() => {
                      const rec = recordings?.find(r => r.epg_id === selectedProgram.entry.id && (r.status === 'scheduled' || r.status === 'recording'));
                      if (rec) {
                        fetch(getApiUrl(`/api/recordings/${rec.id}`), { method: 'DELETE' }).then(() => {
                          addToast({ title: "Recording cancelled", type: "success" });
                          setSelectedProgram(null);
                          refetchRecordings();
                        }).catch(() => addToast({ title: "Failed to cancel", type: "error" }));
                      }
                    }}
                    className="px-5 py-2 rounded-lg font-medium bg-red-600/20 hover:bg-red-600/30 text-red-500 transition-colors cursor-pointer border border-red-500/50"
                  >
                    Cancel Recording
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      const isLive = new Date(selectedProgram.entry.start_time) <= currentTime;
                      fetch(getApiUrl('/api/recordings'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          channel_id: selectedProgram.channel.id,
                          epg_id: selectedProgram.entry.id > 0 ? selectedProgram.entry.id : 0,
                          title: selectedProgram.entry.title,
                          start_time: isLive ? new Date().toISOString() : selectedProgram.entry.start_time,
                          end_time: selectedProgram.entry.end_time
                        })
                      }).then(() => {
                        addToast({ title: "Recording scheduled!", type: "success" });
                        setSelectedProgram(null);
                        refetchRecordings();
                      }).catch(err => {
                        console.error(err);
                        addToast({ title: "Failed to schedule recording", type: "error" });
                      });
                    }}
                    className="px-5 py-2 rounded-lg font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shadow-lg shadow-blue-500/20 border border-blue-500"
                  >
                    {new Date(selectedProgram.entry.start_time) <= currentTime ? 'Record Remaining' : 'Schedule Recording'}
                  </button>
                )}"""

if old_button in content:
    content = content.replace(old_button, new_button)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced button successfully")
else:
    print("Could not find button block")
