import { NavLink } from "react-router-dom";
import { Tv, MonitorPlay, Settings } from "lucide-react";

const navItems = [
  { to: "/channels", label: "Channels", icon: Tv },
  { to: "/guide", label: "Guide", icon: MonitorPlay },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 w-16 bg-neutral-950/80 backdrop-blur-md border-r border-neutral-800/50 flex flex-col items-center justify-center z-50">
      <nav className="flex flex-col space-y-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-center p-3 rounded-2xl transition-all duration-200 ${
                  isActive
                    ? "bg-blue-600/20 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                    : "text-neutral-500 hover:text-white hover:bg-neutral-800/80 hover:scale-110"
                }`
              }
              title={item.label}
            >
              <Icon className="w-6 h-6" />
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
