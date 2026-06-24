"use client";

import {
  BarChart3,
  FolderOpen,
  GitCompareArrows,
  HelpCircle,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  dataTour?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Conciliación",
    href: "/conciliacion",
    icon: <GitCompareArrows className="h-4 w-4" />,
    dataTour: "nav-conciliacion",
  },
  {
    label: "Cortes",
    href: "/cortes",
    icon: <BarChart3 className="h-4 w-4" />,
    dataTour: "nav-cortes",
  },
  {
    label: "Archivos",
    href: "/archivos",
    icon: <FolderOpen className="h-4 w-4" />,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleRestartTour() {
    setMobileOpen(false);
    window.dispatchEvent(new CustomEvent("santo:restart-tour"));
  }

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-xl border p-2 shadow-sm lg:hidden"
        style={{ borderColor: "#ded7ca", background: "#ffffff" }}
        aria-label="Abrir menú"
        type="button"
      >
        <Menu className="h-5 w-5" style={{ color: "#282521" }} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-tour="sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r transition-transform duration-200 lg:relative lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        style={{ borderColor: "#ded7ca", background: "#ffffff" }}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b px-4 py-4" style={{ borderColor: "#eee8dd" }}>
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl p-2" style={{ background: "#9b7a22", color: "#ffffff" }}>
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#9b7a22", letterSpacing: "2px", textTransform: "uppercase" }}>
                Santo OS
              </p>
              <p className="text-[10px]" style={{ color: "#766f65" }}>Panel de cortes</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1 lg:hidden"
            style={{ color: "#766f65" }}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.dataTour}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
                style={{
                  background: isActive ? "#fff8df" : "transparent",
                  color: isActive ? "#9b7a22" : "#766f65",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#fbfaf7"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Help button */}
        <div className="border-t p-3" style={{ borderColor: "#eee8dd" }}>
          <button
            data-tour="help-button"
            onClick={handleRestartTour}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition"
            style={{ color: "#766f65" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#fbfaf7"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            type="button"
          >
            <HelpCircle className="h-4 w-4" />
            ¿Necesitas ayuda?
          </button>
        </div>
      </aside>
    </>
  );
}
