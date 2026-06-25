import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  FolderOpen,
  MessageSquareText,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";

import { APPROVAL_REVIEW_KEY, getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailyForecastMeta, dailySales, dedupeRunsByDay, duplicateRunsByDay, hasForecastSourceForMonth, getMonthlyTotals } from "@/lib/corte-dashboard-utils";
import { approveAgentMailStage, uploadBankFilesAndTrigger } from "@/app/(dashboard)/conciliacion/actions";
import { saveCorteComment, saveManualCorrection, uploadForecast } from "./actions";
import { CorteAiBox } from "./CorteAiBox";
import { InlineEditTable } from "./InlineEditTable";

type SearchParams = Promise<{ unit?: string; month?: string; week?: string; day?: string; success?: string; error?: string }>;

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";
const GREEN = "#2e7d55";
const RED = "#b84a3a";
const AMBER = "#b8782d";

function money(value: number | undefined | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(date: string | null | undefined) {
  return date ? date.slice(0, 7) : "sin-fecha";
}

function weekKey(date: string | null | undefined) {
  const parsed = parseDate(date);
  if (!parsed) return "sin-semana";
  const d = new Date(parsed);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function dateLabel(value: string | null | undefined, mode: "short" | "long" = "long") {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    weekday: mode === "long" ? "long" : undefined,
    day: "2-digit",
    month: mode === "long" ? "long" : "short",
    year: mode === "long" ? "numeric" : undefined,
  }).format(parsed);
}

function monthLabel(key: string) {
  const date = parseDate(`${key}-01`);
  if (!date) return key;
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function getUnit(run: ReconciliationRun) {
  return (run.revision?.unidad || run.revision?.restaurant_key || "SANTO").toUpperCase();
}

function statusText(run: ReconciliationRun) {
  const bankValidated = isBankValidated(run);
  if (bankValidated) return "Validado con bancos";
  if (run.status === "requires_review") return "Necesita revisión";
  if (run.status === "waiting_for_input") return "Faltan bancos";
  if (run.status === "completed") return "Corte cargado";
  return run.status;
}

function statusColor(run: ReconciliationRun) {
  if (isBankValidated(run)) return GREEN;
  if (run.status === "requires_review") return AMBER;
  if (run.status === "waiting_for_input") return RED;
  return MUTED;
}

function isBankValidated(run: ReconciliationRun) {
  return run.status === "completed" || run.status === "bank_validated" || run.documents.some((doc) => doc.document_type === "amex_statement" || doc.document_type === "banorte_statement");
}

function hasApproval(run: ReconciliationRun) {
  return run.reviews.some((review) => review.review_key === APPROVAL_REVIEW_KEY && review.status === "approved");
}

function runTotal(run: ReconciliationRun) {
  return dailySales(run);
}

function runMeta(run: ReconciliationRun) {
  return dailyForecastMeta(run);
}

function runDiff(run: ReconciliationRun) {
  const meta = runMeta(run);
  return meta == null ? null : runTotal(run) - meta;
}

function Flash({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) return null;
  const labels: Record<string, string> = {
    agent_mail_approved: "Corte aprobado. Ya se pueden subir bancos.",
    bank_watcher_triggered: "Bancos subidos. La validación bancaria quedó disparada.",
    comment_saved: "Comentario guardado.",
    manual_correction_saved: "Corrección guardada y auditada.",
    forecast_uploaded: "Forecast subido y registrado para el mes.",
  };
  return (
    <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: error ? "#e8b4aa" : "#b8dbc9", background: error ? "#fff4f1" : "#f1fbf5", color: error ? RED : GREEN }}>
      {error ? decodeURIComponent(error) : labels[success ?? ""] ?? "Guardado."}
    </div>
  );
}
function SummaryTile({ label, value, tone = INK }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>{label}</div>
      <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl" style={{ color: tone }}>{value}</div>
    </div>
  );
}

function UnitSelector({ units, selected, month, week, day }: { units: string[]; selected: string; month: string; week: string; day?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {units.map((unit) => (
        <Link
          key={unit}
          href={`/cortes?unit=${unit}&month=${month}&week=${week}${day ? `&day=${day}` : ""}`}
          className="rounded-md border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: unit === selected ? GOLD : LINE, background: unit === selected ? "#fdf2f2" : PANEL, color: unit === selected ? GOLD : INK }}
        >
          {unit}
        </Link>
      ))}
    </div>
  );
}

function MonthSelector({ months, selected, unit }: { months: string[]; selected: string; unit: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {months.map((month) => (
        <Link
          key={month}
          href={`/cortes?unit=${unit}&month=${month}`}
          className="shrink-0 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: month === selected ? GOLD : LINE, background: month === selected ? "#fdf2f2" : PANEL, color: month === selected ? GOLD : INK }}
        >
          {monthLabel(month)}
        </Link>
      ))}
    </div>
  );
}

function WeekSelector({ weeks, selected, unit, month }: { weeks: string[]; selected: string; unit: string; month: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-4">
      {weeks.map((week, index) => (
        <Link
          key={week}
          href={`/cortes?unit=${unit}&month=${month}&week=${week}`}
          className="rounded-md border px-3 py-3 text-sm"
          style={{ borderColor: week === selected ? GOLD : LINE, background: week === selected ? "#fdf2f2" : PANEL, color: INK }}
        >
          <span className="block text-[11px] font-semibold uppercase" style={{ color: MUTED }}>Semana {index + 1}</span>
          <span className="mt-1 block font-semibold">{dateLabel(week, "short")}</span>
        </Link>
      ))}
    </div>
  );
}

function DayList({ runs, selectedId, unit, month, week }: { runs: ReconciliationRun[]; selectedId?: string; unit: string; month: string; week: string }) {
  return (
    <div className="rounded-md border" style={{ borderColor: LINE, background: PANEL }}>
      {runs.map((run) => {
        const selected = run.id === selectedId;
        const diff = runDiff(run);
        return (
          <Link
            key={run.id}
            href={`/cortes?unit=${unit}&month=${month}&week=${week}&day=${run.id}`}
            className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
            style={{ borderColor: LINE, background: selected ? "#fdf2f2" : PANEL, color: INK }}
          >
            <div>
              <div className="font-semibold">{dateLabel(run.business_date, "short")}</div>
              <div className="mt-1 text-xs" style={{ color: statusColor(run) }}>{statusText(run)}</div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <div className="text-base font-bold tracking-tight">{money(runTotal(run))}</div>
              <div className="text-xs" style={{ color: diff == null || diff === 0 ? MUTED : diff > 0 ? GREEN : RED }}>
                {(() => {
                  const meta = runMeta(run);
                  return diff == null || meta == null ? "Sin forecast" : `${diff >= 0 ? "+" : ""}${((diff / meta) * 100).toFixed(1)}% / ${diff >= 0 ? "+" : ""}${money(diff)}`;
                })()}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function DocumentsPanel({ run }: { run: ReconciliationRun }) {
  const groups = [
    { label: "Corte", docs: run.documents.filter((doc) => ["corte_excel", "daily_sales_report", "revision_report"].includes(doc.document_type)) },
    { label: "Bancos", docs: run.documents.filter((doc) => ["amex_statement", "banorte_statement"].includes(doc.document_type)) },
    { label: "Evidencia", docs: run.documents.filter((doc) => !["corte_excel", "daily_sales_report", "revision_report", "amex_statement", "banorte_statement"].includes(doc.document_type)) },
  ];
  return (
    <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
      <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
        <FolderOpen className="h-4 w-4" />
        Archivos de este día
      </div>
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{group.label}</div>
            {group.docs.length === 0 ? (
              <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: LINE, color: MUTED }}>Sin archivos registrados</div>
            ) : group.docs.slice(0, 4).map((doc) => (
              <a
                key={doc.id}
                href={doc.source_uri ?? "#"}
                className="mb-1 flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                style={{ borderColor: LINE, color: INK, pointerEvents: doc.source_uri ? "auto" : "none" }}
              >
                <span>{String(doc.metadata?.name ?? doc.metadata?.original_filename ?? doc.document_type)}</span>
                <ChevronRight className="h-3 w-3" />
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastMissingPanel({ month, returnTo }: { month: string; returnTo: string }) {
  return (
    <form action={uploadForecast} className="rounded-md border p-4" style={{ borderColor: "#e4c58f", background: "#fff8ec" }}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" style={{ color: AMBER }} />
        <div>
          <div className="font-semibold" style={{ color: INK }}>Falta forecast de {monthLabel(month)}</div>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>Subilo una vez y queda registrado para todo el mes.</p>
          <input name="forecastFile" type="file" accept=".xlsx,.xls" className="mt-3 block w-full text-sm" style={{ color: MUTED }} />
          <button className="mt-3 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Subir forecast</button>
        </div>
      </div>
    </form>
  );
}

function BankUploadPanel({ run, returnTo }: { run: ReconciliationRun; returnTo: string }) {
  const approved = hasApproval(run);
  const validated = isBankValidated(run);
  return (
    <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
      <div className="flex items-center gap-2 font-semibold" style={{ color: INK }}>
        {validated ? <CheckCircle2 className="h-4 w-4" style={{ color: GREEN }} /> : <UploadCloud className="h-4 w-4" style={{ color: AMBER }} />}
        Bancos
      </div>
      <p className="mt-2 text-sm" style={{ color: validated ? GREEN : MUTED }}>
        {validated ? "Este corte ya tiene archivos bancarios registrados." : "Todavía no está validado con bancos."}
      </p>
      {!approved && !validated && (
        <form action={approveAgentMailStage} className="mt-3">
          <input type="hidden" name="workflowRunId" value={run.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea name="notes" rows={2} placeholder="Comentario de aprobación" className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }} />
          <button className="mt-2 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Aprobar corte</button>
        </form>
      )}
      {!validated && (
        <form action={uploadBankFilesAndTrigger} className="mt-4 space-y-2">
          <input type="hidden" name="workflowRunId" value={run.id} />
          <input type="hidden" name="businessDate" value={run.business_date ?? ""} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block text-xs font-semibold" style={{ color: MUTED }}>AMEX</label>
          <input name="amexFile" type="file" accept=".xls,.xlsx" className="block w-full text-sm" disabled={!approved} />
          <label className="block text-xs font-semibold" style={{ color: MUTED }}>Banorte</label>
          <input name="banorteFile" type="file" accept=".csv,.xls,.xlsx" className="block w-full text-sm" disabled={!approved} />
          <button disabled={!approved} className="rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: approved ? GREEN : "#bdb6aa", color: "white" }}>
            Subir bancos
          </button>
        </form>
      )}
    </div>
  );
}

function DetailPanel({ run, month, returnTo }: { run: ReconciliationRun; month: string; returnTo: string }) {
  const revision = run.revision;
  const meta = runMeta(run);
  const diff = runDiff(run);
  const openExceptions = run.exceptions.filter((item) => item.status !== "resolved");
  const comments = Array.isArray(run.output_payload?.dashboard_comments) ? run.output_payload.dashboard_comments as Array<Record<string, unknown>> : [];
  const corrections = Array.isArray(run.output_payload?.dashboard_manual_corrections) ? run.output_payload.dashboard_manual_corrections as Array<Record<string, unknown>> : [];
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_360px] overflow-hidden">
      <div className="space-y-4 min-w-0">
        <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>{getUnit(run)}</div>
              <h2 className="mt-1 text-3xl font-bold tracking-tight" style={{ color: INK }}>{dateLabel(run.business_date)}</h2>
              <div className="mt-2 inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold" style={{ borderColor: statusColor(run), color: statusColor(run), background: `${statusColor(run)}12` }}>
                {statusText(run)}
              </div>
            </div>
            <Link href={`/cortes/${run.id}`} className="rounded-md border px-3 py-2 text-sm font-semibold" style={{ borderColor: LINE, color: INK }}>
              Ver detalle completo
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <SummaryTile label="Venta real" value={money(runTotal(run))} tone={GOLD} />
            <SummaryTile label="Meta forecast" value={money(meta)} />
            <SummaryTile 
              label="Diferencia" 
              value={diff == null || meta == null ? "-" : `${diff >= 0 ? "+" : ""}${((diff / meta) * 100).toFixed(1)}% / ${diff >= 0 ? "+" : ""}${money(diff)}`} 
              tone={diff == null || diff >= 0 ? GREEN : RED} 
            />
            <SummaryTile label="Total sistema" value={money(revision?.reconciliation_totals?.total_sistema)} />
          </div>
        </div>

        <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
            <FileSpreadsheet className="h-4 w-4" />
            Datos principales
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <DataRow label="Total real" value={money(revision?.reconciliation_totals?.total_real)} />
            <DataRow label="Venta real" value={money(runTotal(run))} />
            <DataRow label="Forecast día" value={money(meta)} />
            <DataRow label="Diferencia forecast" value={diff == null ? "-" : `${diff >= 0 ? "+" : ""}${money(diff)}`} />
            <DataRow label="Formato corte" value={revision?.formato_corte ?? "-"} />
            <DataRow label="Falta por entrar" value={money(Object.values(revision?.falta_por_entrar ?? {}).reduce((sum, value) => sum + Number(value || 0), 0))} />
          </div>
        </div>

        <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
            <FileSpreadsheet className="h-4 w-4" />
            Venta Bruta (Excel)
          </div>
          {(() => {
            const reg = (run.output_payload?.income_register ?? {}) as Record<string, number>;
            const ch = (run.output_payload?.income_channels ?? {}) as Record<string, number>;
            const amex = reg.amex ?? ch.amex ?? 0;
            const debito = reg.debito ?? ch.debito ?? 0;
            const credito = reg.credito ?? ch.credito ?? 0;
            const efectivo = reg.efectivo ?? ch.efectivo ?? 0;
            const paypal = reg.paypal ?? ch.paypal ?? 0;
            const uber = reg.uber ?? ch.uber ?? 0;
            const rappi = reg.rappi ?? ch.rappi ?? 0;
            const propinas = reg.propinas ?? ch.propinas ?? 0;

            return (
              <InlineEditTable
                runId={run.id}
                returnTo={returnTo}
                amex={amex}
                debito={debito}
                credito={credito}
                efectivo={efectivo}
                paypal={paypal}
                uber={uber}
                rappi={rappi}
                propinas={propinas}
                total={runTotal(run)}
              />
            );
          })()}
        </div>

        <CorteAiBox runId={run.id} />
        <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
            <MessageSquareText className="h-4 w-4" />
            Comentarios y correcciones
          </div>
          <form action={saveCorteComment} className="mb-4">
            <input type="hidden" name="workflowRunId" value={run.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <textarea name="comment" rows={2} placeholder="Comentario de supervisora" className="w-full rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }} />
            <button className="mt-2 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: INK, color: "white" }}>Guardar comentario</button>
          </form>

          {(comments.length > 0 || corrections.length > 0) && (
            <div className="mt-4 space-y-2 text-sm" style={{ color: MUTED }}>
              {comments.slice(-3).map((comment, index) => <div key={`c-${index}`}>Comentario: {String(comment.comment ?? "")}</div>)}
              {corrections.slice(-3).map((correction, index) => <div key={`m-${index}`}>Corrección: {String(correction.field)} = {String(correction.value)}</div>)}
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <BankUploadPanel run={run} returnTo={returnTo} />
        <DocumentsPanel run={run} />
        {openExceptions.length > 0 && (
          <div className="rounded-md border p-4" style={{ borderColor: "#e4c58f", background: "#fff8ec" }}>
            <div className="font-semibold" style={{ color: INK }}>Pendientes por resolver</div>
            <div className="mt-2 space-y-2">
              {openExceptions.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#e4c58f", color: MUTED }}>
                  {item.exception_key}
                </div>
              ))}
            </div>
          </div>
        )}
        {!!run.output_payload?.saldos && (
          <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
            <div className="mb-3 font-semibold" style={{ color: INK }}>Saldos al cierre</div>
            <div className="space-y-2 text-sm">
              <DataRow label="Banorte" value={money((run.output_payload.saldos as Record<string, number>).banorte)} />
              <DataRow label="AMEX" value={money((run.output_payload.saldos as Record<string, number>).amex)} />
              <DataRow label="Efectivo" value={money((run.output_payload.saldos as Record<string, number>).efectivo)} />
              <div className="pt-2 mt-2 border-t" style={{ borderColor: LINE }}>
                <DataRow label="Aguinaldos" value={money((run.output_payload.saldos as Record<string, number>).aguinaldos)} />
                <DataRow label="Utilidades" value={money((run.output_payload.saldos as Record<string, number>).utilidades)} />
              </div>
            </div>
          </div>
        )}
        <Link href={`/archivos?month=${month}`} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm font-semibold" style={{ borderColor: LINE, background: PANEL, color: INK }}>
          Ver archivos del mes
          <ChevronRight className="h-4 w-4" />
        </Link>
      </aside>
    </section>
  );
}

function DataRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: muted ? "#aaa298" : INK }}>
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold">{value}</span>
    </div>
  );
}

export default async function CortesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData();

  if (data.status === "auth_required") {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: PAPER, color: INK }}>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Iniciar sesión</Link>
      </main>
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

  const allRuns = data.runs.filter((run) => run.business_date);
  const runs = dedupeRunsByDay(allRuns);
  const duplicateDates = duplicateRunsByDay(allRuns);
  const units = Array.from(new Set(runs.map(getUnit))).sort();
  const selectedUnit = params.unit && units.includes(params.unit) ? params.unit : units[0] ?? "SANTO";
  const unitRuns = runs.filter((run) => getUnit(run) === selectedUnit);
  const months = Array.from(new Set(unitRuns.map((run) => monthKey(run.business_date)))).sort().reverse();
  const selectedMonth = params.month && months.includes(params.month) ? params.month : months[0] ?? new Date().toISOString().slice(0, 7);
  const monthRuns = unitRuns.filter((run) => monthKey(run.business_date) === selectedMonth);
  const weeks = Array.from(new Set(monthRuns.map((run) => weekKey(run.business_date)))).sort();
  const selectedWeek = params.week && weeks.includes(params.week) ? params.week : weeks[weeks.length - 1] ?? "sin-semana";
  const weekRuns = monthRuns.filter((run) => weekKey(run.business_date) === selectedWeek).sort((a, b) => String(a.business_date).localeCompare(String(b.business_date)));
  const selectedRun = weekRuns.find((run) => run.id === params.day) ?? weekRuns[weekRuns.length - 1] ?? monthRuns[0] ?? null;
  const returnTo = `/cortes?unit=${selectedUnit}&month=${selectedMonth}&week=${selectedWeek}${selectedRun ? `&day=${selectedRun.id}` : ""}`;
  const forecastReady = hasForecastSourceForMonth(monthRuns, selectedMonth);
  const { monthTotal, monthMeta } = getMonthlyTotals(monthRuns, selectedMonth);
  const monthDiff = monthMeta == null ? null : monthTotal - monthMeta;

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK, overflowX: "hidden" }}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pl-10 lg:pl-0">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Control</div>
            <h1 className="mt-1 text-3xl font-semibold">Cortes de Caja</h1>
            <p className="mt-2 max-w-3xl text-sm" style={{ color: MUTED }}>
              Vista simple para revisar el corte, compararlo contra forecast y subir bancos cuando esté aprobado.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link 
              href={`/socios?month=${selectedMonth}`} 
              target="_blank"
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors hover:bg-gray-50"
              style={{ borderColor: LINE, color: INK }}
            >
              <UploadCloud className="h-4 w-4" />
              Vista para Socios
            </Link>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/socios?month=${selectedMonth}`);
                alert("Enlace copiado al portapapeles");
              }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: GOLD, color: "white" }}
            >
              Compartir enlace
            </button>
          </div>
        </header>

        <Flash success={params.success} error={params.error} />

        {data.status === "requires_config" && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: AMBER }}>
            Falta conectar Supabase: {data.missingConfig.join(", ")}
          </div>
        )}
        {data.error && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e8b4aa", background: "#fff4f1", color: RED }}>{data.error}</div>
        )}

        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" /> Unidad</div>
          <UnitSelector units={units.length ? units : ["SANTO"]} selected={selectedUnit} month={selectedMonth} week={selectedWeek} day={selectedRun?.id} />
        </section>

        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Mes</div>
          <MonthSelector months={months.length ? months : [selectedMonth]} selected={selectedMonth} unit={selectedUnit} />
        </section>

        {!forecastReady && <ForecastMissingPanel month={selectedMonth} returnTo={returnTo} />}

        {duplicateDates.length > 0 && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: AMBER }}>
            Hay cortes duplicados para {duplicateDates.map(([date]) => dateLabel(date, "short")).join(", ")}. Se muestra solo la versión más completa de cada día.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <SummaryTile label="Venta mes" value={money(monthTotal)} tone={GOLD} />
          <SummaryTile label="Forecast mes" value={money(monthMeta)} />
          <SummaryTile 
            label="Diferencia mes" 
            value={monthDiff == null ? "-" : `${monthDiff >= 0 ? "+" : ""}${((monthDiff / monthMeta!) * 100).toFixed(1)}% / ${monthDiff >= 0 ? "+" : ""}${money(monthDiff)}`} 
            tone={monthDiff == null || monthDiff >= 0 ? GREEN : RED} 
          />
          <SummaryTile label="Cortes del mes" value={String(monthRuns.length)} />
        </div>

        <section>
          <div className="mb-3 font-semibold">Semanas</div>
          <WeekSelector weeks={weeks.length ? weeks : [selectedWeek]} selected={selectedWeek} unit={selectedUnit} month={selectedMonth} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div>
            <div className="mb-3 font-semibold">Días</div>
            {weekRuns.length > 0 ? (
              <DayList runs={weekRuns} selectedId={selectedRun?.id} unit={selectedUnit} month={selectedMonth} week={selectedWeek} />
            ) : (
              <div className="rounded-md border p-5 text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>No hay cortes en esta semana.</div>
            )}
          </div>
          {selectedRun ? (
            <DetailPanel run={selectedRun} month={selectedMonth} returnTo={returnTo} />
          ) : (
            <div className="rounded-md border p-8 text-center text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>Elegí un día para ver el corte.</div>
          )}
        </section>
      </div>
    </main>
  );
}
