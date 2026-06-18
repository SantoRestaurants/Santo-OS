"use client";

import type { ReactNode } from "react";

export type Tone = "green" | "blue" | "amber" | "red" | "neutral";

const TONES: Record<Tone, { bg: string; border: string; color: string }> = {
  neutral: { bg: "#22222222", border: "#33333366", color: "#888888" },
  green: { bg: "#4CAF8222", border: "#4CAF8244", color: "#4CAF82" },
  blue: { bg: "#5A8AE022", border: "#5A8AE044", color: "#5A8AE0" },
  amber: { bg: "#E08A3A22", border: "#E08A3A44", color: "#E08A3A" },
  red: { bg: "#E05A5A22", border: "#E05A5A44", color: "#E05A5A" },
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const t = TONES[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.color }}
    >
      {children}
    </span>
  );
}
