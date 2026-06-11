"use client";

import {
  AlertTriangle,
  FileText,
  FolderOpen,
  HelpCircle,
  Home,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  disabled?: boolean;
  dataTour?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Inicio",
    href: "/",
    icon: <Home className="h-4 w-4" />,
    dataTour: "nav-home",
  },
  {
    label: "Revisiones",
    href: "/reviews",
    icon: <ShieldCheck className="h-4 w-4" />,
    dataTour: "nav-reviews",
  },
  {
    label: "Consola Sandbox",
    href: "/sandbox",
    icon: <Terminal className="h-4 w-4" />,
    dataTour: "nav-sandbox",
  },
  {
    label: "Corte Santo",
    href: "/corte-santo",
    icon: <FileText className="h-4 w-4" />,
    disabled: true,
    dataTour: "nav-corte",
  },
  {
    label: "Excepciones",
    href: "/exceptions",
    icon: <AlertTriangle className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: "Documentos",
    href: "/documents",
    icon: <FolderOpen className="h-4 w-4" />,
    disabled: true,
  },
  {
    label: "Configuración",
    href: "/settings",
    icon: <Settings className="h-4 w-4" />,
    disabled: true,
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
        className="fixed left-4 top-4 z-40 rounded-xl border border-stone-200 bg-white p-2 shadow-sm lg:hidden"
        aria-label="Abrir menú"
        type="button"
      >
        <Menu className="h-5 w-5 text-stone-700" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-stone-950/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-tour="sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-stone-200 bg-white transition-transform duration-200 lg:relative lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-stone-950 p-2 text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-950">
                Santo AI OS
              </p>
              <p className="text-[10px] text-stone-600">Panel de operaciones</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1 text-stone-500 hover:text-stone-700 lg:hidden"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  data-tour={item.dataTour}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-stone-500"
                >
                  <div className="flex items-center gap-3">
                    {item.icon}
                    <span className="text-xs font-medium">{item.label}</span>
                  </div>
                  <Badge tone="neutral">Próximamente</Badge>
                </div>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.dataTour}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                  isActive
                    ? "bg-stone-950 text-white"
                    : "text-stone-700 hover:bg-stone-100"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Help button */}
        <div className="border-t border-stone-100 p-3">
          <button
            data-tour="help-button"
            onClick={handleRestartTour}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-700"
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
