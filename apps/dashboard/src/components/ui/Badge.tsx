"use client";

import type { ReactNode } from "react";

export type Tone = "green" | "blue" | "amber" | "red" | "neutral";

const TONES: Record<Tone, string> = {
  neutral: "border-stone-200 bg-stone-100 text-stone-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-rose-200 bg-rose-50 text-rose-700",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
