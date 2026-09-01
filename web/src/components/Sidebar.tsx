import { NavLink } from "react-router-dom";
import { Tv, MonitorPlay, Video, Settings, Film, User } from "lucide-react";
import { useApi } from "../hooks/useApi";

type Profile = { id: number; name: string; avatar_url: string; };

const navItems = [
  { to: "/channels", label: "Channels", icon: Tv },
  { to: "/guide", label: "Guide", icon: MonitorPlay },
  { to: "/recordings", label: "DVR", icon: Film },
  { to: "/cameras", label: "Cameras", icon: Video },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const { data: profiles } = useApi<Profile[]>('/api/profiles');
  const activeProfileId = Number(localStorage.getItem('tvapp_active_profile_id'));
  const activeProfile = profiles?.find(p => p.id === activeProfileId);

  return (
    <aside className="fixed bottom-0 inset-x-0 h-16 bg-neutral-950/90 backdrop-blur-xl border-t border-neutral-800/80 z-[100] flex items-center justify-around md:fixed md:inset-y-0 md:left-0 md:w-16 md:h-full md:border-t-0 md:border-r md:flex-col md:justify-center md:bg-neutral-950/80">
      
      {/* Profile Button on Desktop (Top) */}
      <div className="hidden md:flex absolute top-4 inset-x-0 justify-center z-50">
        <button
          onClick={() => {
            localStorage.removeItem('tvapp_active_profile_id');
            window.location.reload();
          }}
          className="p-1 rounded-full hover:scale-110 transition-transform cursor-pointer border-2 border-transparent hover:border-blue-500 shadow-md"
          title="Switch Profile"
        >
          {activeProfile?.avatar_url ? (
            <img src={activeProfile.avatar_url} alt="Profile" className="w-8 h-8 rounded-full bg-neutral-800" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
              <User className="w-5 h-5 text-neutral-400" />
            </div>
          )}
        </button>
      </div>

      <nav className="flex flex-row items-center justify-around w-full px-2 sm:px-4 md:px-0 md:w-auto md:flex-col md:space-y-6">
        
        {/* Profile Button on Mobile (Leftmost) */}
        <button
          onClick={() => {
            localStorage.removeItem('tvapp_active_profile_id');
            window.location.reload();
          }}
          className="flex flex-col items-center justify-center p-1 sm:p-2 rounded-2xl transition-all duration-200 cursor-pointer text-neutral-500 hover:text-white md:hidden"
          title="Switch Profile"
        >
          {activeProfile?.avatar_url ? (
            <img src={activeProfile.avatar_url} alt="Profile" className="w-6 h-6 rounded-full bg-neutral-800" />
          ) : (
            <User className="w-6 h-6" />
          )}
          <span className="text-[10px] font-medium mt-0.5">Profile</span>
        </button>

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col md:flex-row items-center justify-center p-2 sm:p-3 rounded-2xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-blue-600/20 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] scale-105"
                    : "text-neutral-500 hover:text-white hover:bg-neutral-800/80 hover:scale-110"
                }`
              }
              title={item.label}
            >
              <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-[10px] font-medium mt-0.5 md:hidden">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
