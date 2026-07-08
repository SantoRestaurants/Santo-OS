import { CheckCircle2, Clock3 } from "lucide-react";
import Link from "next/link";

import { approveAgentMailStage } from "./actions";
import { BankUploadForm } from "./BankUploadForm";
import { APPROVAL_REVIEW_KEY, getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailySales, dedupeRunsByDay } from "@/lib/corte-dashboard-utils";
import { EmailEvidence } from "@/components/cortes/EmailEvidence";
import { InlineEditTable } from "../cortes/InlineEditTable";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";
const GREEN = "#2e7d55";
const RED = "#b84a3a";

type SearchParams = Promise<{ success?: string; error?: string }>;

function formatCurrency(value: number | undefined | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return "Corte sin fecha";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
}

function hasApproval(run: ReconciliationRun) {
  return run.reviews.some((review) => review.review_key === APPROVAL_REVIEW_KEY && review.status === "approved");
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    waiting_for_input: "Esperando bancos",
    requires_review: "Necesita revisión",
    completed: "Completado",
    running: "En proceso",
    queued: "En cola",
    failed: "Con error",
  };
  return labels[status] ?? status;
}

function amountFrom(run: ReconciliationRun, path: string) {
  const parts = path.split(".");
  let current: unknown = run.revision;
  for (const part of parts) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" ? current : null;
}

function Flash({ success, error }: { success?: string; error?: string }) {
  if (error) {
    return (
      <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "#E05A5A55", background: "#E05A5A11", color: "#E05A5A" }}>
        {error}
      </div>
    );
  }
  if (!success) return null;
  const labels: Record<string, string> = {
    agent_mail_approved: "Etapa Agent Mail aprobada. Ya se pueden subir los bancos.",
    bank_watcher_triggered: "Bancos subidos a Drive y Bank Watcher disparado.",
  };
  return (
    <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "#4CAF8255", background: "#4CAF8211", color: "#4CAF82" }}>
      {labels[success] ?? "Cambio guardado."}
    </div>
  );
}
function Stat({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: MUTED }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 17, fontWeight: 650, color }}>{value}</div>
    </div>
  );
}

function RunCard({ run, defaultOpen = false }: { run: ReconciliationRun; defaultOpen?: boolean }) {
  const approved = hasApproval(run);
  const canUploadBanks = approved && run.status !== "completed" && Boolean(run.business_date);
  const difference = amountFrom(run, "reconciliation_totals.difference") ?? 0;
  const bankDocs = run.documents.filter((doc) => doc.document_type === "amex_statement" || doc.document_type === "banorte_statement");
  const register = (run.output_payload.income_register ?? {}) as Record<string, number>;
  const daily = (run.output_payload.daily_record ?? {}) as Record<string, number>;

  return (
    <details open={defaultOpen} className="rounded-md border" style={{ borderColor: LINE, background: PANEL }}>
      <summary className="flex cursor-pointer list-none flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p style={{ color: INK, fontSize: 15, fontWeight: 650 }}>{formatDate(run.business_date)}</p>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>
            Agent Mail: {run.email?.subject ?? "sin asunto"} · {run.email?.from_address ?? "sin remitente"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md px-2.5 py-1 text-xs" style={{ background: "#fbfaf7", color: MUTED, border: `1px solid ${LINE}` }}>{statusLabel(run.status)}</span>
          <span className="rounded-md px-2.5 py-1 text-xs" style={{ background: approved ? "#f1fbf5" : "#fdf2f2", color: approved ? GREEN : GOLD, border: `1px solid ${approved ? "#b8dbc9" : "#e4c58f"}` }}>
            {approved ? "Aprobado por supervisora" : "Pendiente de aprobación"}
          </span>
        </div>
      </summary>

      <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Venta real" value={formatCurrency(dailySales(run))} color={GOLD} />
            <Stat label="Total conciliado" value={formatCurrency(amountFrom(run, "reconciliation_totals.total_real"))} />
            <Stat label="Diferencia conciliación" value={formatCurrency(difference)} color={difference === 0 ? "#4CAF82" : "#E05A5A"} />
          </div>

          <div className="rounded-md border p-4" style={{ borderColor: LINE, background: "#fbfaf7" }}>
            <InlineEditTable
              runId={run.id} returnTo="/conciliacion"
              amex={Number(daily.amex ?? register.amex ?? 0)} debito={Number(daily.debito ?? register.debito ?? 0)}
              credito={Number(daily.credito ?? register.credito ?? 0)} efectivo={Number(daily.efectivo ?? register.efectivo ?? 0)}
              transferencia={Number(daily.transferencia ?? register.transferencia ?? 0)} paypal={Number(daily.paypal ?? register.paypal ?? 0)}
              uber={Number(daily.uber_eats ?? register.uber ?? 0)} rappi={Number(daily.rappi ?? register.rappi ?? 0)}
              propinas={Number(daily.propinas ?? register.propinas ?? 0)}
              totalBruto={Number(daily.total_bruto ?? run.revision?.daily_financial_record?.total_bruto ?? 0)}
              ventaBruta={Number(daily.venta_bruta ?? run.revision?.daily_financial_record?.venta_bruta ?? dailySales(run))}
            />
            {run.requires_review_reason && (
              <p className="mt-3 rounded-md px-3 py-2 text-xs" style={{ color: "#E08A3A", background: "#E08A3A11", border: "1px solid #E08A3A33" }}>
                Motivo: {run.requires_review_reason}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <form action={approveAgentMailStage} className="rounded-md border p-4" style={{ borderColor: LINE, background: "#fbfaf7" }}>
            <input type="hidden" name="workflowRunId" value={run.id} />
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: MUTED }}>
              <CheckCircle2 className="h-4 w-4" />
              Aprobación de supervisora
            </div>
            <textarea
              name="notes"
              rows={3}
              placeholder="Notas de revisión"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none"
              style={{ borderColor: LINE, background: PANEL, color: INK }}
              defaultValue={approved ? "Aprobado" : ""}
            />
            <button
              type="submit"
              disabled={approved}
              className="mt-3 w-full rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[1px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: GOLD, color: "#ffffff" }}
            >
              {approved ? "Ya aprobado" : "Aprobar"}
            </button>
          </form>

          <BankUploadForm
            workflowRunId={run.id}
            businessDate={run.business_date ?? ""}
            canUploadBanks={canUploadBanks}
            bankDocsCount={bankDocs.length}
          />
        </div>
      </div>
      <div className="px-5 pb-5"><EmailEvidence run={run} /></div>
    </details>
  );
}

export default async function ConciliacionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData();

  if (data.status === "auth_required") {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: PAPER, color: INK }}>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "#ffffff" }}>Iniciar sesión</Link>
      </div>
    );
  }

  if (data.status === "unauthorized") {
    return (
      <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: PAPER, color: INK }}>
        <div className="text-xl font-bold">Acceso Denegado</div>
        <div className="text-sm">Necesitas permisos de supervisor para ver este panel.</div>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Volver al login</Link>
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK }}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold" style={{ color: GOLD, letterSpacing: 2, textTransform: "uppercase" }}>Conciliación</h1>
          <p className="text-sm" style={{ color: MUTED }}>Aprobación de Agent Mail y carga bancaria para correr Bank Watcher.</p>
        </header>

        <Flash success={params.success} error={params.error} />

        {data.status === "requires_config" && (
          <div className="rounded-md border p-5 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: "#b8782d" }}>
            Falta conectar Supabase: {data.missingConfig.join(", ")}
          </div>
        )}

        {data.error && (
          <div className="rounded-md border p-5 text-sm" style={{ borderColor: "#e8b4aa", background: "#fff4f1", color: RED }}>
            {data.error}
          </div>
        )}

        {data.status === "ready" && data.runs.length === 0 && (
          <div className="rounded-md border p-10 text-center" style={{ borderColor: LINE, background: PANEL }}>
            <Clock3 className="mx-auto h-8 w-8" style={{ color: MUTED }} />
            <p className="mt-3 text-sm" style={{ color: MUTED }}>Todavía no hay cortes cargados por Agent Mail.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {dedupeRunsByDay(data.runs).map((run, index) => (
            <RunCard key={run.id} run={run} defaultOpen={index === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
