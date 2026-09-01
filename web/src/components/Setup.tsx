import { useState } from "react";
import { getApiUrl } from "../lib/api";

type Props = {
  onComplete: () => void;
};

const AVATAR_SEEDS = ["Felix", "Aneka", "Jasper", "Coco", "Shadow", "Max", "Luna", "Oliver", "Milo", "Bella", "Leo", "Chloe", "Loki", "Zoe", "Simba", "Nala"];

export default function Setup({ onComplete }: Props) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_SEEDS[0]);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    
    try {
      const avatar_url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(selectedAvatar)}`;
      const res = await fetch(getApiUrl("/api/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), avatar_url, pin })
      });
      
      const profile = await res.json();
      localStorage.setItem('tvapp_active_profile_id', profile.id.toString());
      
      // Auto-login to get the token for the new admin
      if (pin) {
        const authRes = await fetch(getApiUrl("/api/auth/login"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile_id: profile.id, pin })
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          localStorage.setItem('tvapp_auth_token', authData.token);
        }
      }
      
      onComplete();
    } catch (e) {
      console.error("Failed to create admin profile", e);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-8 text-white">
      <div className="max-w-2xl w-full">
        <h1 className="text-4xl font-bold mb-4 text-center">Welcome to TV App</h1>
        <p className="text-neutral-400 text-center mb-12">Let's set up your admin profile to get started.</p>

        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-10 shadow-2xl">
          <div className="mb-6">
            <label className="block text-sm font-medium text-neutral-300 mb-2">Your Name</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="e.g. Mark"
            />
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-neutral-300 mb-2">4-Digit PIN (Optional)</label>
            <input
              type="password"
              maxLength={4}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest transition-colors"
              placeholder="Leave blank for no PIN"
            />
          </div>

          <div className="mb-10">
            <label className="block text-sm font-medium text-neutral-300 mb-4">Choose an Avatar</label>
            <div className="grid grid-cols-4 sm:grid-cols-4 gap-4">
              {AVATAR_SEEDS.map(seed => {
                const url = `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
                const isSelected = selectedAvatar === seed;
                return (
                  <button
                    key={seed}
                    onClick={() => setSelectedAvatar(seed)}
                    className={`relative rounded-full aspect-square border-4 transition-all overflow-hidden bg-neutral-800 hover:scale-105 ${
                      isSelected ? "border-blue-500 scale-105 shadow-[0_0_20px_rgba(59,130,246,0.3)]" : "border-transparent"
                    }`}
                  >
                    <img src={url} alt={seed} className="w-full h-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white font-bold py-4 rounded-xl transition-colors"
          >
            {loading ? "Creating..." : "Create Admin Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
