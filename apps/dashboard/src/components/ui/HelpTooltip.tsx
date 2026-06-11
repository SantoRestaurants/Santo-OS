"use client";

import { HelpCircle, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function HelpTooltip({
  text,
  position = "top",
}: {
  text: string;
  position?: "top" | "bottom" | "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const positionClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen(!open)}
        className="group inline-flex items-center justify-center rounded-full p-0.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-700"
        aria-label="Ayuda"
        type="button"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className={`absolute z-50 w-64 ${positionClasses[position]}`}>
          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs leading-5 text-stone-600">{text}</p>
              <button
                onClick={() => setOpen(false)}
                className="shrink-0 text-stone-500 hover:text-stone-700"
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
