import re

with open("web/src/components/Settings.tsx", "r") as f:
    content = f.read()

add_profile_modal = """
      {/* Add Profile Modal */}
      {showAddProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 sm:p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-lg sm:text-xl font-semibold text-white mb-4">Add Profile</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-xs sm:text-sm text-neutral-400 mb-2">Profile Name</label>
                <input
                  type="text"
                  autoFocus
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 mb-4"
                  placeholder="Enter name"
                />

                <label className="block text-xs sm:text-sm text-neutral-400 mb-2">4-Digit PIN (Optional)</label>
                <input
                  type="password"
                  maxLength={4}
                  value={newProfilePin}
                  onChange={e => setNewProfilePin(e.target.value.replace(/\\D/g, ''))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest"
                  placeholder="Leave blank for no PIN"
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
                  setShowAddProfileModal(false);
                  setNewProfileName("");
                  setNewProfilePin("");
                  setNewProfileAvatar(AVATAR_SEEDS[0]);
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
                    await fetch(getApiUrl(`/api/profiles`), {
                      method: "POST",
                      headers: getApiHeaders(),
                      body: JSON.stringify({ 
                        name: newProfileName.trim(), 
                        avatar_url, 
                        is_admin: false,
                        pin: newProfilePin 
                      })
                    });
                    refetchProfiles();
                  } catch {
                  }
                  setShowAddProfileModal(false);
                  setNewProfileName("");
                  setNewProfilePin("");
                  setNewProfileAvatar(AVATAR_SEEDS[0]);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium text-sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
"""

content = content.replace("{/* Edit Profile Modal */}", add_profile_modal + "\n      {/* Edit Profile Modal */}")

with open("web/src/components/Settings.tsx", "w") as f:
    f.write(content)
