import { CheckCircle2, Clock3, FileSpreadsheet, UploadCloud } from "lucide-react";
import Link from "next/link";

import { approveAgentMailStage, uploadBankFilesAndTrigger } from "./actions";
import { APPROVAL_REVIEW_KEY, getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";

const GOLD = "#C9A84C";
const CREAM = "#E8E0D0";

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

function Stat({ label, value, color = CREAM }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: "#666" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 17, fontWeight: 650, color }}>{value}</div>
    </div>
  );
}

function RunCard({ run }: { run: ReconciliationRun }) {
  const approved = hasApproval(run);
  const canUploadBanks = approved && run.status !== "completed" && Boolean(run.business_date);
  const difference = amountFrom(run, "reconciliation_totals.difference") ?? 0;
  const bankDocs = run.documents.filter((doc) => doc.document_type === "amex_statement" || doc.document_type === "banorte_statement");

  return (
    <section className="rounded-lg border" style={{ borderColor: "#222", background: "#0f0f0f" }}>
      <div className="flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "#1f1f1f" }}>
        <div>
          <p style={{ color: CREAM, fontSize: 15, fontWeight: 650 }}>{formatDate(run.business_date)}</p>
          <p className="mt-1 text-xs" style={{ color: "#666" }}>
            Agent Mail: {run.email?.subject ?? "sin asunto"} · {run.email?.from_address ?? "sin remitente"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md px-2.5 py-1 text-xs" style={{ background: "#171717", color: "#999", border: "1px solid #222" }}>{statusLabel(run.status)}</span>
          <span className="rounded-md px-2.5 py-1 text-xs" style={{ background: approved ? "#4CAF8217" : "#C9A84C17", color: approved ? "#4CAF82" : GOLD, border: `1px solid ${approved ? "#4CAF8244" : "#C9A84C44"}` }}>
            {approved ? "Aprobado por supervisora" : "Pendiente de aprobación"}
          </span>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Venta real" value={formatCurrency(amountFrom(run, "vta_al_dia.venta_real"))} color={GOLD} />
            <Stat label="Total real" value={formatCurrency(amountFrom(run, "reconciliation_totals.total_real"))} />
            <Stat label="Diferencia" value={formatCurrency(difference)} color={difference === 0 ? "#4CAF82" : "#E05A5A"} />
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: "#222", background: "#111" }}>
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: "#777" }}>
              <FileSpreadsheet className="h-4 w-4" />
              Lo que dejó Agent Mail
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <Mini label="Formato" value={run.revision?.formato_corte ?? "-"} />
              <Mini label="Documentos intake" value={String(run.documents.filter((doc) => doc.source_system === "agent_mail").length)} />
              <Mini label="Gastos adicionales" value={String(run.revision?.gastos_adicionales?.length ?? 0)} />
              <Mini label="Excepciones abiertas" value={String(run.exceptions.filter((ex) => ex.status !== "resolved").length)} />
            </div>
            {run.requires_review_reason && (
              <p className="mt-3 rounded-md px-3 py-2 text-xs" style={{ color: "#E08A3A", background: "#E08A3A11", border: "1px solid #E08A3A33" }}>
                Motivo: {run.requires_review_reason}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <form action={approveAgentMailStage} className="rounded-lg border p-4" style={{ borderColor: "#222", background: "#111" }}>
            <input type="hidden" name="workflowRunId" value={run.id} />
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: "#777" }}>
              <CheckCircle2 className="h-4 w-4" />
              Aprobación de supervisora
            </div>
            <textarea
              name="notes"
              rows={3}
              placeholder="Notas de revisión"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "#242424", background: "#080808", color: CREAM }}
              defaultValue={approved ? "Aprobado" : ""}
            />
            <button
              type="submit"
              disabled={approved}
              className="mt-3 w-full rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[1px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: GOLD, color: "#080808" }}
            >
              {approved ? "Ya aprobado" : "Aprobar Agent Mail"}
            </button>
          </form>

          <form action={uploadBankFilesAndTrigger} className="rounded-lg border p-4" style={{ borderColor: "#222", background: "#111" }}>
            <input type="hidden" name="workflowRunId" value={run.id} />
            <input type="hidden" name="businessDate" value={run.business_date ?? ""} />
            <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: "#777" }}>
              <UploadCloud className="h-4 w-4" />
              Cuentas de banco
            </div>
            <label className="mb-2 block text-xs" style={{ color: "#999" }}>AMEX (.xls/.xlsx)</label>
            <input name="amexFile" type="file" accept=".xls,.xlsx" disabled={!canUploadBanks} className="mb-3 block w-full text-xs" style={{ color: "#777" }} />
            <label className="mb-2 block text-xs" style={{ color: "#999" }}>Banorte (.csv/.xls/.xlsx)</label>
            <input name="banorteFile" type="file" accept=".csv,.xls,.xlsx" disabled={!canUploadBanks} className="block w-full text-xs" style={{ color: "#777" }} />
            <button
              type="submit"
              disabled={!canUploadBanks}
              className="mt-4 w-full rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[1px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: canUploadBanks ? "#4CAF82" : "#333", color: canUploadBanks ? "#06100b" : "#777" }}
            >
              Subir y correr Bank Watcher
            </button>
            <p className="mt-3 text-[11px] leading-5" style={{ color: "#666" }}>
              Archivos bancarios ya registrados: {bankDocs.length}. Si falta configuración de Drive o GitHub, el sistema lo deja en revisión.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2" style={{ background: "#0a0a0a", border: "1px solid #1d1d1d" }}>
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ color: CREAM, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default async function ConciliacionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData();

  if (data.status === "auth_required") {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#080808", color: CREAM }}>
        <Link href="/auth/sign-in" className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "#080808" }}>Iniciar sesión</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: CREAM }}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold" style={{ color: GOLD, letterSpacing: 2, textTransform: "uppercase" }}>Conciliación</h1>
          <p className="text-sm" style={{ color: "#666" }}>Aprobación de Agent Mail y carga bancaria para correr Bank Watcher.</p>
        </header>

        <Flash success={params.success} error={params.error} />

        {data.status === "requires_config" && (
          <div className="rounded-lg border p-5 text-sm" style={{ borderColor: "#E08A3A44", background: "#E08A3A11", color: "#E08A3A" }}>
            Falta conectar Supabase: {data.missingConfig.join(", ")}
          </div>
        )}

        {data.error && (
          <div className="rounded-lg border p-5 text-sm" style={{ borderColor: "#E05A5A44", background: "#E05A5A11", color: "#E05A5A" }}>
            {data.error}
          </div>
        )}

        {data.status === "ready" && data.runs.length === 0 && (
          <div className="rounded-lg border p-10 text-center" style={{ borderColor: "#222", background: "#111" }}>
            <Clock3 className="mx-auto h-8 w-8" style={{ color: "#444" }} />
            <p className="mt-3 text-sm" style={{ color: "#777" }}>Todavía no hay cortes cargados por Agent Mail.</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {data.runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      </div>
    </div>
  );
}
