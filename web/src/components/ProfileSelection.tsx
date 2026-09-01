import { useState } from "react";
import { Plus } from "lucide-react";
import { getApiUrl, getApiHeaders } from "../lib/api";

type Profile = {
  id: number;
  name: string;
  avatar_url: string;
  is_admin: boolean;
  has_pin?: boolean;
};

type Props = {
  profiles: Profile[];
  onSelect: (id: number) => void;
  onProfileCreated: () => void;
};

const AVATAR_SEEDS = ["Felix", "Aneka", "Jasper", "Coco", "Shadow", "Max", "Luna", "Oliver", "Milo", "Bella", "Leo", "Chloe", "Loki", "Zoe", "Simba", "Nala"];

export default function ProfileSelection({ profiles, onSelect, onProfileCreated }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_SEEDS[0]);
  
  const [pinEntryProfile, setPinEntryProfile] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const avatar_url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(selectedAvatar)}`;
    
    await fetch(getApiUrl("/api/profiles"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getApiHeaders() as Record<string, string> },
      body: JSON.stringify({ name: newName.trim(), avatar_url, is_admin: false, pin: "" })
    });
    setNewName("");
    setIsCreating(false);
    onProfileCreated();
  };

  const handleProfileClick = async (p: Profile) => {
    if (p.has_pin) {
      setPinEntryProfile(p);
      setPin("");
      setPinError("");
    } else {
      await login(p.id, "");
    }
  };

  const login = async (profileId: number, pinCode: string) => {
    try {
      const res = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId, pin: pinCode })
      });
      if (!res.ok) {
        setPinError("Invalid PIN");
        return;
      }
      const data = await res.json();
      localStorage.setItem('tvapp_auth_token', data.token);
      onSelect(profileId);
    } catch (e) {
      setPinError("Connection error");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-8 text-white z-50 fixed inset-0">
      <h1 className="text-4xl font-bold mb-12">Who's watching?</h1>
      
      <div className="flex flex-wrap justify-center gap-8 mb-12">
        {profiles.map(p => (
          <div 
            key={p.id}
            onClick={() => handleProfileClick(p)}
            className="flex flex-col items-center gap-4 cursor-pointer group"
          >
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-transparent group-hover:border-blue-500 transition-all bg-neutral-800">
              <img src={p.avatar_url} alt={p.name} className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-medium text-neutral-400 group-hover:text-white transition-colors">{p.name}</span>
          </div>
        ))}

        <div 
          onClick={() => setIsCreating(true)}
          className="flex flex-col items-center gap-4 cursor-pointer group"
        >
          <div className="w-32 h-32 rounded-full border-4 border-transparent bg-neutral-800 flex items-center justify-center group-hover:bg-neutral-700 transition-all">
            <Plus className="w-12 h-12 text-neutral-400 group-hover:text-white" />
          </div>
          <span className="text-xl font-medium text-neutral-400 group-hover:text-white transition-colors">Add Profile</span>
        </div>
      </div>

      {isCreating && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 p-8 rounded-xl max-w-md w-full">
            <h2 className="text-2xl font-bold mb-6">Add Profile</h2>
            <div className="space-y-6 mb-6">
              <div>
                <label className="block text-sm text-neutral-400 mb-2">Name</label>
                <input
                  type="text"
                  placeholder="e.g. Kids"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-400 mb-2">Avatar</label>
                <div className="grid grid-cols-4 gap-3">
                  {AVATAR_SEEDS.map(seed => {
                    const url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
                    const isSelected = selectedAvatar === seed;
                    return (
                      <button
                        key={seed}
                        onClick={() => setSelectedAvatar(seed)}
                        className={`relative rounded-full aspect-square border-4 transition-all overflow-hidden bg-neutral-800 hover:scale-105 ${
                          isSelected ? "border-blue-500 scale-105 shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "border-transparent"
                        }`}
                      >
                        <img src={url} alt={seed} className="w-full h-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button 
                onClick={() => setIsCreating(false)}
                className="px-6 py-2 text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
              >
                Create Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {pinEntryProfile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-2xl font-bold text-white mb-2 text-center">Enter PIN</h2>
            <p className="text-neutral-400 text-sm mb-6 text-center">
              Enter the 4-digit PIN for {pinEntryProfile.name}
            </p>
            
            <div className="mb-6">
              <input 
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setPin(val);
                  setPinError("");
                  if (val.length === 4) {
                    login(pinEntryProfile.id, val);
                  }
                }}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-center text-2xl tracking-[1em] text-white focus:outline-none focus:border-blue-500 font-mono"
                autoFocus
              />
              {pinError && <p className="text-red-400 text-xs mt-2 text-center">{pinError}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPinEntryProfile(null)}
                className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors font-medium text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
