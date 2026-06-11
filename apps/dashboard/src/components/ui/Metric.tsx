import type { ReactNode } from "react";

type MetricTone = "stone" | "green" | "amber" | "blue";

const TONES: Record<MetricTone, string> = {
  stone: "bg-stone-100 text-stone-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  blue: "bg-sky-50 text-sky-600",
};

export function Metric({
  label,
  value,
  detail,
  icon,
  tone,
  dataTour,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: MetricTone;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(28,25,23,0.035)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-stone-700">{label}</p>
        <span className={`rounded-xl p-2 ${TONES[tone]}`}>{icon}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-stone-600">{detail}</p>
    </div>
  );
}
