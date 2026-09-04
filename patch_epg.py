import sys
import re

path = r'c:\Users\Mark\Dev2\tvapp\web\src\components\EpgGrid.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Recording type
interface_inject = """interface EpgEntry {
"""
interface_replacement = """interface Recording {
  id: number;
  epg_id: number;
  status: string;
}

interface EpgEntry {
"""
content = content.replace(interface_inject, interface_replacement)

# 2. Add useApi for recordings
hook_inject = """  const { data: sourcesData } = useApi<Source[]>('/api/sources');"""
hook_replacement = """  const { data: sourcesData } = useApi<Source[]>('/api/sources');
  const { data: recordings, refetch: refetchRecordings } = useApi<Recording[]>('/api/recordings');
  const scheduledEpgIds = useMemo(() => {
    const set = new Set<number>();
    if (recordings) {
      recordings.forEach(r => {
        if ((r.status === 'scheduled' || r.status === 'recording') && r.epg_id) {
          set.add(r.epg_id);
        }
      });
    }
    return set;
  }, [recordings]);
"""
content = content.replace(hook_inject, hook_replacement)

# 3. Add visual indicator in the program block
# We need to find the program block rendering.
# It usually maps over channel.programs
block_inject = """                    <div 
                      key={idx}
                      onClick={() => setSelectedProgram({ channel, entry })}
                      className="absolute top-0 h-full p-2 border-r border-neutral-700/50 cursor-pointer overflow-hidden transition-all duration-200 group-hover:z-10 group-hover:brightness-110"
                      style={{ 
                        left: `${(new Date(entry.start_time).getTime() - gridStartTime.getTime()) / 1000 / 60 * 6}px`, 
                        width: `${Math.max(1, (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 1000 / 60 * 6)}px`,
                        backgroundColor: isLive ? '#262626' : (isPast ? '#171717' : '#1f1f1f')
                      }}
                    >"""
block_replacement = """                    <div 
                      key={idx}
                      onClick={() => setSelectedProgram({ channel, entry })}
                      className={`absolute top-0 h-full p-2 border-r border-neutral-700/50 cursor-pointer overflow-hidden transition-all duration-200 group-hover:z-10 group-hover:brightness-110 ${scheduledEpgIds.has(entry.id) ? 'ring-inset ring-2 ring-red-500' : ''}`}
                      style={{ 
                        left: `${(new Date(entry.start_time).getTime() - gridStartTime.getTime()) / 1000 / 60 * 6}px`, 
                        width: `${Math.max(1, (new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 1000 / 60 * 6)}px`,
                        backgroundColor: scheduledEpgIds.has(entry.id) ? '#3f1f1f' : (isLive ? '#262626' : (isPast ? '#171717' : '#1f1f1f'))
                      }}
                    >"""
content = content.replace(block_inject, block_replacement)

# 4. Modify the "Schedule Recording" button in the modal
modal_button_inject = """                <button 
                  onClick={() => {
                    const isLive = new Date(selectedProgram.entry.start_time) <= currentTime;
                    fetch(getApiUrl('/api/recordings'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        channel_id: selectedProgram.channel.id,
                        epg_id: selectedProgram.entry.id,
                        title: selectedProgram.entry.title,
                        start_time: selectedProgram.entry.start_time,
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

modal_button_replacement = """                {scheduledEpgIds.has(selectedProgram.entry.id) ? (
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
                          epg_id: selectedProgram.entry.id,
                          title: selectedProgram.entry.title,
                          start_time: selectedProgram.entry.start_time,
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
content = content.replace(modal_button_inject, modal_button_replacement)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
