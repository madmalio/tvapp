import re

with open("web/src/components/Settings.tsx", "r") as f:
    content = f.read()

# 1. Update Profile type
content = content.replace(
    "type Profile = { id: number; name: string; avatar_url: string; is_admin: boolean; };",
    "type Profile = { id: number; name: string; avatar_url: string; is_admin: boolean; has_pin?: boolean; };"
)

# 2. Add Users icon
content = content.replace(
    "  Loader2\n} from \"lucide-react\";",
    "  Loader2,\n  Users\n} from \"lucide-react\";"
)

# 3. Add Tab type
content = content.replace(
    "type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences' | 'system';",
    "type Tab = 'iptv' | 'server' | 'rtsp' | 'dvr' | 'preferences' | 'system' | 'profiles';"
)

# 4. Add activeTab logic
content = content.replace(
    "  const [activeTab, setActiveTab] = useState<Tab>('iptv');",
    "  const [activeTab, setActiveTab] = useState<Tab>(() => {\n    return (sessionStorage.getItem('tvapp_settings_tab') as Tab) || 'iptv';\n  });\n  \n  useEffect(() => {\n    sessionStorage.setItem('tvapp_settings_tab', activeTab);\n  }, [activeTab]);"
)

# 5. Add AVATAR_SEEDS
content = content.replace(
    "  const [toasts, setToasts] = useState<Toast[]>([]);",
    "  const [toasts, setToasts] = useState<Toast[]>([]);\n\n  const AVATAR_SEEDS = [\"Felix\", \"Aneka\", \"Jasper\", \"Coco\", \"Shadow\", \"Max\", \"Luna\", \"Oliver\", \"Milo\", \"Bella\", \"Leo\", \"Chloe\", \"Loki\", \"Zoe\", \"Simba\", \"Nala\"];"
)

# 6. Add states
content = content.replace(
    "  const [newProfileName, setNewProfileName] = useState(\"\");",
    "  const [newProfileName, setNewProfileName] = useState(\"\");\n  const [newProfilePin, setNewProfilePin] = useState(\"\");"
)

# 7. Add tab to tabs array
content = content.replace(
    "    { id: 'preferences', label: 'Preferences', icon: Sliders },\n    { id: 'system', label: 'System', icon: Activity },\n  ];",
    "    { id: 'preferences', label: 'Preferences', icon: Sliders },\n    { id: 'profiles', label: 'Profiles', icon: Users },\n    ...(isAdmin ? [{ id: 'system', label: 'System', icon: Activity }] : []),\n  ];"
)

# 8. Add Profiles Tab Body
body = """
        {/* Profiles Tab */}
        {activeTab === 'profiles' && (
          <div className="space-y-4 sm:space-y-6 w-full animate-in fade-in duration-300 pb-16">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg sm:text-xl font-semibold">Manage Profiles</h2>
              {isAdmin && (
                <button
                  onClick={() => setShowAddProfileModal(true)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Plus className="w-4 h-4" /> Add Profile
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {(profiles || []).filter(p => isAdmin || p.id === activeProfileId).map(profile => (
                <div key={profile.id} className="bg-neutral-800/50 backdrop-blur-md border border-neutral-700/50 rounded-2xl p-4 flex flex-col items-center gap-4 relative overflow-hidden group">
                  {profile.is_admin && (
                    <div className="absolute top-3 left-3 bg-blue-500/20 text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-500/30">
                      ADMIN
                    </div>
                  )}
                  {profile.has_pin && (
                    <div className="absolute top-3 left-3 bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/30">
                      LOCKED
                    </div>
                  )}
                  
                  <div className="w-20 h-20 rounded-full overflow-hidden bg-neutral-900 border-2 border-neutral-700">
                    <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover" />
                  </div>
                  
                  <h3 className="font-semibold text-lg text-white">{profile.name}</h3>
                  
                  <div className="flex w-full gap-2 mt-2">
                    <button
                      onClick={() => {
                        setEditProfileData(profile);
                        setNewProfileName(profile.name);
                        setNewProfileAvatar(new URL(profile.avatar_url).searchParams?.get("seed") || AVATAR_SEEDS[0]);
                        setNewProfilePin(profile.has_pin ? "****" : "");
                        setShowEditProfileModal(true);
                      }}
                      className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                    
                    {isAdmin && !profile.is_admin && (
                      <button
                        onClick={() => setShowDeleteProfileModal(profile)}
                        className="bg-red-900/30 hover:bg-red-900/60 text-red-400 py-2 px-3 rounded-lg text-xs transition-colors flex items-center justify-center cursor-pointer"
                        title="Delete Profile"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
"""
content = content.replace("      </div>\n    </div>\n\n    {/* Wipe Modal */}", body + "\n    {/* Wipe Modal */}")

modals = """
      {/* Edit Profile Modal */}
      {showEditProfileModal && editProfileData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-4">Edit Profile</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-2">Profile Name</label>
                <input
                  type="text"
                  autoFocus
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
                />

                <label className="block text-xs sm:text-sm text-neutral-400 mb-2">4-Digit PIN (Optional)</label>
                <input
                  type="password"
                  maxLength={4}
                  value={newProfilePin}
                  onChange={e => setNewProfilePin(e.target.value.replace(/\\D/g, ''))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest"
                  placeholder={editProfileData.has_pin ? "Enter new PIN (or **** to keep)" : "Leave blank for no PIN"}
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-3">Avatar</label>
                <div className="grid grid-cols-4 gap-3">
                  {AVATAR_SEEDS.map(seed => {
                    const url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
                    const isSelected = newProfileAvatar === seed;
                    return (
                      <button
                        key={seed}
                        onClick={() => setNewProfileAvatar(seed)}
                        className={`relative rounded-full aspect-square border-4 transition-all overflow-hidden bg-neutral-800 hover:scale-105 cursor-pointer ${
                          isSelected ? "border-blue-500 scale-105 shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "border-transparent"
                        }`}
                      >
                        <img src={url} alt={seed} className="w-full h-full object-cover pointer-events-none" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button
                onClick={() => {
                  setShowEditProfileModal(false);
                  setEditProfileData(null);
                }}
                className="px-4 py-2 text-neutral-400 hover:text-white transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                disabled={!newProfileName.trim()}
                onClick={async () => {
                  const avatar_url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(newProfileAvatar)}`;
                  try {
                    await fetch(getApiUrl(`/api/profiles/${editProfileData.id}`), {
                      method: "PUT",
                      headers: getApiHeaders(),
                      body: JSON.stringify({ 
                        name: newProfileName.trim(), 
                        avatar_url, 
                        is_admin: editProfileData.is_admin,
                        pin: newProfilePin 
                      })
                    });
                    
                    if (editProfileData.id === activeProfileId) {
                      window.location.reload();
                    } else {
                      refetchProfiles();
                    }
                  } catch {
                  }
                  setShowEditProfileModal(false);
                  setEditProfileData(null);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium text-sm"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Profile Modal */}
      {showDeleteProfileModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-red-900/50 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-2">Delete Profile?</h2>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowDeleteProfileModal(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await fetch(getApiUrl(`/api/profiles/${showDeleteProfileModal.id}`), { 
                      method: "DELETE",
                      headers: getApiHeaders()
                    });
                    refetchProfiles();
                  } catch {}
                  setShowDeleteProfileModal(null);
                }}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
"""
content = content.replace("    </div>\n  );\n}", modals + "    </div>\n  );\n}")


# Update Add Profile Modal body to send headers and pin
content = content.replace("""                  body: JSON.stringify({ name: newProfileName.trim(), avatar_url, is_admin: false })
                        });""", """                  headers: getApiHeaders(),
                  body: JSON.stringify({ name: newProfileName.trim(), avatar_url, is_admin: false, pin: newProfilePin })
                });""")
content = content.replace("setNewProfileAvatar(AVATAR_SEEDS[0]);\n                    }\n                  }}\n                  className=\"w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500\"\n                  placeholder=\"Enter name\"\n                />\n              </div>\n\n              <div>",
"setNewProfileAvatar(AVATAR_SEEDS[0]);\n                    }\n                  }}\n                  className=\"w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4\"\n                  placeholder=\"Enter name\"\n                />\n<label className=\"block text-xs sm:text-sm text-neutral-400 mb-2\">4-Digit PIN (Optional)</label>\n<input type=\"password\" maxLength={4} value={newProfilePin} onChange={e => setNewProfilePin(e.target.value.replace(/\\D/g, ''))} className=\"w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest\" placeholder=\"Leave blank for no PIN\" />\n</div>\n\n              <div>")
content = content.replace("setShowAddProfileModal(false);\n                  setNewProfileName(\"\");", "setShowAddProfileModal(false);\n                  setNewProfileName(\"\");\n                  setNewProfilePin(\"\");")

with open("web/src/components/Settings.tsx", "w") as f:
    f.write(content)
