import { NavLink } from "react-router-dom";
import { Tv, MonitorPlay, Video, Settings, Film } from "lucide-react";

const navItems = [
  { to: "/channels", label: "Channels", icon: Tv },
  { to: "/guide", label: "Guide", icon: MonitorPlay },
  { to: "/recordings", label: "DVR", icon: Film },
  { to: "/cameras", label: "Cameras", icon: Video },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="fixed bottom-0 inset-x-0 h-16 bg-neutral-950/90 backdrop-blur-xl border-t border-neutral-800/80 z-50 flex items-center justify-around md:fixed md:inset-y-0 md:left-0 md:w-16 md:h-full md:border-t-0 md:border-r md:flex-col md:justify-center md:bg-neutral-950/80">
      <nav className="flex flex-row items-center justify-around w-full px-4 md:px-0 md:w-auto md:flex-col md:space-y-6">
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
