"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const GREEN = "#2e7d55";
const AMBER = "#b8782d";
const RED = "#b84a3a";

type ProcessingState = Record<string, unknown>;

export function BankProcessingStatus({ workflowRunId, initialState }: { workflowRunId: string; initialState: ProcessingState | null }) {
  const router = useRouter();
  const [state, setState] = useState<ProcessingState | null>(initialState);
  const status = typeof state?.status === "string" ? state.status : null;

  useEffect(() => {
    if (status !== "running") return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/cortes/bank-status?workflowRunId=${encodeURIComponent(workflowRunId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = await response.json() as { processing?: ProcessingState | null };
        if (!result.processing) return;
        setState(result.processing);
        if (result.processing.status !== "running") router.refresh();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // A later poll can recover from a transient network failure.
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [status, workflowRunId, router]);

  if (!state || !status) return null;
  const uploaded = Array.isArray(state.uploaded_documents) ? state.uploaded_documents : [];
  const pending = state.pending_collections && typeof state.pending_collections === "object"
    ? Object.entries(state.pending_collections as Record<string, number>)
    : [];
  const running = status === "running";
  const completed = status === "completed";
  const color = running ? AMBER : completed ? GREEN : RED;
  const Icon = running ? LoaderCircle : completed ? CheckCircle2 : AlertTriangle;

  return (
    <div className="rounded-md border px-3 py-3 text-xs" role="status" aria-live="polite" style={{ borderColor: `${color}55`, background: `${color}0D`, color }}>
      <div className="flex items-center gap-2 font-semibold">
        <Icon className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
        {running ? "Conciliando cuentas bancarias…" : completed ? "Conciliación bancaria terminada" : "La conciliación necesita revisión"}
      </div>
      {uploaded.length > 0 && (
        <div className="mt-2" style={{ color: "#766f65" }}>
          Cargados: {uploaded.map((item) => String((item as Record<string, unknown>).name ?? "archivo")).join(" · ")}
        </div>
      )}
      {!running && pending.length > 0 && (
        <div className="mt-2" style={{ color: "#766f65" }}>
          Pendiente: {pending.map(([channel, amount]) => `${channel} ${formatMoney(Number(amount))}`).join(" · ")}
        </div>
      )}
      {typeof state.error === "string" && <div className="mt-2">Error: {state.error}</div>}
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}
