import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  FileSpreadsheet,
  FolderOpen,
  MessageSquareText,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";

import { getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailyForecastMeta, dailySales, dedupeRunsByDay, getLatestSaldos, hasForecastSourceForMonth, getMonthlyTotals, getOutstandingThroughDate } from "@/lib/corte-dashboard-utils";
import { RESTAURANT_OPTIONS } from "@/lib/restaurant-options";
import { CorteAiBox } from "./CorteAiBox";
import { InlineEditTable } from "./InlineEditTable";

type SearchParams = Promise<{ unit?: string; year?: string; month?: string; week?: string; day?: string }>;

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

function outstandingChannelLabel(channel: string) {
  const labels: Record<string, string> = {
    amex: "AMEX",
    banorte: "Banorte (crédito + débito)",
    uber: "Uber Eats",
    rappi: "Rappi",
  };
  return labels[channel] ?? channel;
}

function cxcLabel(channel: string) {
  return channel.includes("—") ? channel.split("—").slice(1).join("—").trim() : "Otro";
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

type AdditionalExpense = {
  amount: number;
  description: string;
  detail?: string | null;
};

function additionalExpensesForRun(run: ReconciliationRun | null): AdditionalExpense[] {
  if (!run) return [];
  const day = run.business_date;
  const payload = run.output_payload ?? {};
  const bank = payload.bank_reconciliation as Record<string, unknown> | undefined;
  const bankExpenses = Array.isArray(bank?.additional_expenses) ? bank.additional_expenses : [];
  const revisionExpenses = Array.isArray(run.revision?.gastos_adicionales) ? run.revision.gastos_adicionales : [];
  const source = bankExpenses.length > 0 ? bankExpenses : revisionExpenses;

  return source
    .filter((raw): raw is Record<string, unknown> => Boolean(raw && typeof raw === "object" && !Array.isArray(raw)))
    .filter((raw) => {
      const operationDate = typeof raw.operation_date === "string" ? raw.operation_date : null;
      if (!day || !operationDate) return true;
      const [dd, mm, yyyy] = operationDate.split("/");
      const normalized = yyyy && mm && dd ? `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` : operationDate;
      return normalized === day;
    })
    .map((raw) => ({
      amount: Number(raw.amount ?? raw.importe ?? 0),
      description: String(raw.description ?? raw.concepto ?? "Gasto adicional"),
      detail: typeof raw.detail === "string" ? raw.detail : typeof raw.observaciones === "string" ? raw.observaciones : null,
    }))
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
}

function monthLabel(key: string) {
  const date = parseDate(`${key}-01`);
  if (!date) return key;
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function yearKey(date: string | null | undefined) {
  return date ? date.slice(0, 4) : "sin-ano";
}

function getUnit(run: ReconciliationRun) {
  return (run.revision?.unidad || run.revision?.restaurant_key || "SANTO").toUpperCase();
}

function statusText(run: ReconciliationRun) {
  const bankValidated = isBankValidated(run);
  if (bankValidated) return "Validado con bancos";
  if (run.status === "requires_review") return "Necesita revision";
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

function runTotal(run: ReconciliationRun) { return dailySales(run); }

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CortesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData();

  if (data.status === "auth_required") {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: PAPER, color: INK }}>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Iniciar sesion</Link>
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
  const units = Array.from(new Set(runs.map(getUnit))).sort();
  const restaurantOptions = Array.from(new Set([...RESTAURANT_OPTIONS, ...units]));
  const selectedUnit = params.unit && units.includes(params.unit) ? params.unit : units[0] ?? "SANTO";
  const unitAllRuns = allRuns.filter((run) => getUnit(run) === selectedUnit);
  const unitRuns = runs.filter((run) => getUnit(run) === selectedUnit);
  const todayMexico = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const unitReceivables = data.receivables.filter((r) => {
    const rs = (r as any).restaurants;
    const rawKey = Array.isArray(rs) ? rs[0]?.restaurant_key : rs?.restaurant_key;
    const key = rawKey === "default_restaurant_confirm" ? "SANTO" : rawKey?.toUpperCase();
    return key === selectedUnit;
  });
  const outstanding = getOutstandingThroughDate(unitAllRuns, unitReceivables, todayMexico);
  const latestBalance = getLatestSaldos(unitAllRuns);
  const years = Array.from(new Set(unitRuns.map((run) => yearKey(run.business_date)))).sort().reverse();
  const selectedYear = params.year && years.includes(params.year) ? params.year : years[0] ?? new Date().toISOString().slice(0, 4);
  const yearRuns = unitRuns.filter((run) => yearKey(run.business_date) === selectedYear);
  const months = Array.from(new Set(yearRuns.map((run) => monthKey(run.business_date)))).sort().reverse();
  const selectedMonth = params.month && months.includes(params.month) ? params.month : months[0] ?? `${selectedYear}-01`;
  const monthRuns = yearRuns.filter((run) => monthKey(run.business_date) === selectedMonth);
  const weeks = Array.from(new Set(monthRuns.map((run) => weekKey(run.business_date)))).sort();
  const selectedWeek = params.week && weeks.includes(params.week) ? params.week : weeks[weeks.length - 1] ?? "sin-semana";
  const weekRuns = monthRuns.filter((run) => weekKey(run.business_date) === selectedWeek).sort((a, b) => String(a.business_date).localeCompare(String(b.business_date)));
  const selectedRun = weekRuns.find((run) => run.id === params.day) ?? weekRuns[weekRuns.length - 1] ?? monthRuns[0] ?? null;
  const returnTo = `/cortes?unit=${selectedUnit}&year=${selectedYear}&month=${selectedMonth}&week=${selectedWeek}${selectedRun ? `&day=${selectedRun.id}` : ""}`;
  const forecastReady = hasForecastSourceForMonth(monthRuns, selectedMonth, data.forecastDocuments);
  let { monthTotal, monthMeta, monthMetaToDate } = getMonthlyTotals(monthRuns, selectedMonth, data.forecastDocuments);

  function runMeta(run: ReconciliationRun) {
    const direct = dailyForecastMeta(run, data.forecastDocuments);
    if (direct != null || !run.business_date) return direct;
    for (const carrier of monthRuns) {
      const row = carrier.revision?.vta_por_dia?.find((item) => item.fecha === run.business_date);
      if (typeof row?.meta_vta === "number") return row.meta_vta;
    }
    return null;
  }

  function runDiff(run: ReconciliationRun) {
    const meta = runMeta(run);
    return meta == null ? null : runTotal(run) - meta;
  }

  function cortesDayVenta(run: ReconciliationRun) {
    return runTotal(run);
  }

  const monthDiff = monthMetaToDate != null ? monthTotal - monthMetaToDate : monthMeta != null ? monthTotal - monthMeta : null;

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK, overflowX: "hidden" }}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pl-10 lg:pl-0">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Control</div>
            <h1 className="mt-1 text-3xl font-semibold">Cortes de Caja</h1>
            <p className="mt-2 max-w-3xl text-sm" style={{ color: MUTED }}>
              Vista simple para revisar el corte, compararlo contra forecast y subir bancos cuando este aprobado.
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
          </div>
        </header>

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
          <div className="flex flex-wrap gap-2">
            {restaurantOptions.map((unit) => {
              const hasData = units.includes(unit);
              const className = "rounded-md border px-4 py-2 text-sm font-semibold";
              const style = { borderColor: unit === selectedUnit ? GOLD : LINE, background: unit === selectedUnit ? "#fdf2f2" : PANEL, color: unit === selectedUnit ? GOLD : INK };
              return hasData ? (
                <Link
                  key={unit}
                  href={`/cortes?unit=${unit}&year=${selectedYear}&month=${selectedMonth}&week=${selectedWeek}${selectedRun ? `&day=${selectedRun.id}` : ""}`}
                  className={className}
                  style={style}
                >
                  {unit}
                </Link>
              ) : (
                <span key={unit} className={`${className} cursor-not-allowed opacity-45`} style={style} aria-disabled="true" title="Próximamente">
                  {unit}
                </span>
              );
            })}
          </div>
        </section>

        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Ano</div>
          <div className="flex gap-2">
            {(years.length ? years : [selectedYear]).map((year) => (
              <Link
                key={year}
                href={`/cortes?unit=${selectedUnit}&year=${year}`}
                className="shrink-0 rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: year === selectedYear ? GOLD : LINE, background: year === selectedYear ? "#fdf2f2" : PANEL, color: year === selectedYear ? GOLD : INK }}
              >
                {year}
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Mes</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(months.length ? months : [selectedMonth]).map((month) => (
              <Link
                key={month}
                href={`/cortes?unit=${selectedUnit}&year=${selectedYear}&month=${month}`}
                className="shrink-0 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: month === selectedMonth ? GOLD : LINE, background: month === selectedMonth ? "#fdf2f2" : PANEL, color: month === selectedMonth ? GOLD : INK }}
              >
                {monthLabel(month)}
              </Link>
            ))}
          </div>
        </section>

        {!forecastReady && (
          <div className="rounded-md border p-4" style={{ borderColor: "#e4c58f", background: "#fff8ec" }}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5" style={{ color: AMBER }} />
              <div>
                <div className="font-semibold" style={{ color: INK }}>Falta forecast de {monthLabel(selectedMonth)}</div>
                <p className="mt-1 text-sm" style={{ color: MUTED }}>Subilo una vez y queda registrado para todo el mes.</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Venta mes</div>
            <div className="mt-0.5 text-base font-bold tracking-tight truncate">{money(monthTotal)}</div>
          </div>
          <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Forecast mes</div>
            <div className="mt-0.5 text-base font-bold tracking-tight truncate">{money(monthMeta)}</div>
          </div>
          <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Diferencia mes</div>
            <div className="mt-0.5 text-sm font-bold tracking-tight truncate" style={{ color: monthDiff == null || monthDiff >= 0 ? GREEN : RED }}>
              {monthDiff == null ? "-" : `${monthDiff >= 0 ? "+" : ""}${((monthDiff / monthMeta!) * 100).toFixed(1)}% / ${monthDiff >= 0 ? "+" : ""}${money(monthDiff)}`}
            </div>
          </div>
          <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Cortes del mes</div>
            <div className="mt-0.5 text-base font-bold tracking-tight truncate">{monthRuns.length}</div>
          </div>
        </div>

        <section>
          <div className="mb-3 font-semibold">Semanas</div>
          <div className="grid gap-2 md:grid-cols-4">
            {(weeks.length ? weeks : [selectedWeek]).map((week, index) => (
              <Link
                key={week}
                href={`/cortes?unit=${selectedUnit}&month=${selectedMonth}&week=${week}`}
                className="rounded-md border px-3 py-3 text-sm"
                style={{ borderColor: week === selectedWeek ? GOLD : LINE, background: week === selectedWeek ? "#fdf2f2" : PANEL, color: INK }}
              >
                <span className="block text-[11px] font-semibold uppercase" style={{ color: MUTED }}>Semana {index + 1}</span>
                <span className="mt-1 block font-semibold">{dateLabel(week, "short")}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div>
            <div className="mb-3 font-semibold">Dias</div>
            {weekRuns.length > 0 ? (
              <div className="rounded-md border" style={{ borderColor: LINE, background: PANEL }}>
                {weekRuns.map((run) => {
                  const selected = run.id === selectedRun?.id;
                  const diff = runDiff(run);
                  return (
                    <Link
                      key={run.id}
                      href={`/cortes?unit=${selectedUnit}&month=${selectedMonth}&week=${selectedWeek}&day=${run.id}`}
                      className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
                      style={{ borderColor: LINE, background: selected ? "#fdf2f2" : PANEL, color: INK }}
                    >
                      <div>
                        <div className="font-semibold">{dateLabel(run.business_date, "short")}</div>
                        <div className="mt-1 text-xs" style={{ color: statusColor(run) }}>{statusText(run)}</div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="text-base font-bold tracking-tight">{money(cortesDayVenta(run))}</div>
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
            ) : (
              <div className="rounded-md border p-5 text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>No hay cortes en esta semana.</div>
            )}
          </div>
          {selectedRun ? (
            <section className="grid gap-4 lg:grid-cols-[1fr_360px] overflow-hidden">
              <div className="space-y-4 min-w-0">
                <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>{getUnit(selectedRun)}</div>
                      <h2 className="mt-1 text-2xl font-bold tracking-tight" style={{ color: INK }}>{dateLabel(selectedRun.business_date)}</h2>
                      <div className="mt-2 inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold" style={{ borderColor: statusColor(selectedRun), color: statusColor(selectedRun), background: `${statusColor(selectedRun)}12` }}>
                        {statusText(selectedRun)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-2 md:grid-cols-4">
                    <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Venta real</div>
                      <div className="mt-0.5 text-base font-bold tracking-tight truncate" style={{ color: GOLD }}>{money(cortesDayVenta(selectedRun))}</div>
                    </div>
                    <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Meta forecast</div>
                      <div className="mt-0.5 text-base font-bold tracking-tight truncate">{money(runMeta(selectedRun))}</div>
                    </div>
                    <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Diferencia</div>
                      <div className="mt-0.5 text-sm font-bold tracking-tight truncate" style={{ color: (() => { const d = runDiff(selectedRun); const m = runMeta(selectedRun); return d == null || d >= 0 ? GREEN : RED; })() }}>
                        {(() => {
                          const d = runDiff(selectedRun);
                          const m = runMeta(selectedRun);
                          return d == null || m == null ? "-" : `${d >= 0 ? "+" : ""}${((d / m) * 100).toFixed(1)}% / ${d >= 0 ? "+" : ""}${money(d)}`;
                        })()}
                      </div>
                    </div>
                    <div className="rounded-md border px-3 py-2 min-w-0 overflow-hidden" style={{ background: PANEL, borderColor: LINE }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Total sistema</div>
                      <div className="mt-0.5 text-base font-bold tracking-tight truncate">{money(selectedRun.revision?.reconciliation_totals?.total_sistema)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="mb-2 flex items-center gap-2 font-semibold text-sm" style={{ color: INK }}>
                    <FileSpreadsheet className="h-4 w-4" />
                    Datos principales
                  </div>
                  <div className="grid gap-1.5 md:grid-cols-2 text-xs">
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: LINE, color: INK }}>
                      <span className="shrink-0" style={{ color: MUTED }}>Total real</span>
                      <span className="min-w-0 truncate text-right font-semibold">{money(selectedRun.revision?.reconciliation_totals?.total_real)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: LINE, color: INK }}>
                      <span className="shrink-0" style={{ color: MUTED }}>Venta real</span>
                      <span className="min-w-0 truncate text-right font-semibold">{money(cortesDayVenta(selectedRun))}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: LINE, color: INK }}>
                      <span className="shrink-0" style={{ color: MUTED }}>Forecast dia</span>
                      <span className="min-w-0 truncate text-right font-semibold">{money(runMeta(selectedRun))}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: LINE, color: MUTED }}>
                      <span className="shrink-0">Diferencia</span>
                      <span className="min-w-0 truncate text-right font-semibold">{(() => { const d = runDiff(selectedRun); return d == null ? "-" : `${d >= 0 ? "+" : ""}${money(d)}`; })()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: LINE, color: INK }}>
                      <span className="shrink-0" style={{ color: MUTED }}>Formato</span>
                      <span className="min-w-0 truncate text-right font-semibold">{selectedRun.revision?.formato_corte ?? "-"}</span>
                    </div>
                    <div className="rounded-md border px-2.5 py-2" style={{ borderColor: LINE }}>
                      <div className="mb-1 text-xs font-semibold" style={{ color: MUTED }}>Falta entrar</div>
                      {(() => {
                        // Bypass revision extraction, read directly from output_payload
                        if (!outstanding) return <div className="text-xs" style={{ color: MUTED }}>Nada pendiente</div>;
                        return <>
                          <div className="mb-1 text-[10px]" style={{ color: MUTED }}>Conciliado hasta {dateLabel(outstanding.asOfDate, "short")}</div>
                          {outstanding.entries.filter(({ channel }) => !channel.startsWith("CXC")).map(({ channel, amount }) => (
                            <div key={channel} className="flex justify-between text-xs py-1" style={{ color: INK }}>
                              <span style={{ color: MUTED }}>{outstandingChannelLabel(channel)}</span>
                              <span className="font-medium">{money(amount)}</span>
                            </div>
                          ))}
                          {outstanding.entries.some(({ channel }) => channel.startsWith("CXC")) && (
                            <div className="mt-2 border-t pt-2" style={{ borderColor: LINE }}>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Cuentas por cobrar</div>
                              {outstanding.entries.filter(({ channel }) => channel.startsWith("CXC")).map(({ channel, amount }) => (
                                <div key={channel} className="flex justify-between gap-3 py-1 text-xs" style={{ color: INK }}>
                                  <span className="min-w-0 truncate" style={{ color: MUTED }}>{cxcLabel(channel)}</span>
                                  <span className="shrink-0 font-medium">{money(amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>;
                      })()}
                    </div>
                    <div className="rounded-md border px-2.5 py-2 md:col-span-2" style={{ borderColor: LINE }}>
                      <div className="mb-1 text-xs font-semibold" style={{ color: MUTED }}>Gastos adicionales</div>
                      {(() => {
                        const expenses = additionalExpensesForRun(selectedRun);
                        if (expenses.length === 0) {
                          return <div className="text-xs" style={{ color: MUTED }}>Sin gastos adicionales para este dia</div>;
                        }
                        return (
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs py-0.5" style={{ color: INK }}>
                              <span style={{ color: MUTED }}>Total del dia</span>
                              <span className="font-semibold" style={{ color: RED }}>{money(expenses.reduce((sum, item) => sum + item.amount, 0))}</span>
                            </div>
                            {expenses.map((expense, index) => (
                              <div key={`${expense.description}-${index}`} className="rounded border px-2 py-1 text-xs" style={{ borderColor: LINE }}>
                                <div className="flex justify-between gap-3" style={{ color: INK }}>
                                  <span className="min-w-0 truncate" style={{ color: MUTED }}>{expense.description}</span>
                                  <span className="shrink-0 font-medium">{money(expense.amount)}</span>
                                </div>
                                {expense.detail && expense.detail !== "-" && (
                                  <div className="mt-1 line-clamp-2" style={{ color: MUTED }}>{expense.detail}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="mb-2 flex items-center gap-2 font-semibold text-sm" style={{ color: INK }}>
                    <FileSpreadsheet className="h-4 w-4" />
                    Venta Bruta (Excel)
                  </div>
                  {(() => {
                    const reg = (selectedRun.output_payload?.income_register ?? {}) as Record<string, number>;
                    const ch = (selectedRun.output_payload?.income_channels ?? {}) as Record<string, number>;
                    const daily = (selectedRun.output_payload?.daily_record ?? {}) as Record<string, number>;
                    const totalBruto = Number(daily.total_bruto ?? selectedRun.revision?.daily_financial_record?.total_bruto ?? 0);
                    return <InlineEditTable
                      runId={selectedRun.id} returnTo={returnTo}
                      amex={Number(daily.amex ?? reg.amex ?? ch.amex ?? 0)} debito={Number(daily.debito ?? reg.debito ?? ch.debito ?? 0)}
                      credito={Number(daily.credito ?? reg.credito ?? ch.credito ?? 0)} efectivo={Number(daily.efectivo ?? reg.efectivo ?? ch.efectivo ?? 0)}
                      transferencia={Number(daily.transferencia ?? reg.transferencia ?? ch.transferencia ?? 0)} paypal={Number(daily.paypal ?? reg.paypal ?? ch.paypal ?? 0)}
                      uber={Number(daily.uber_eats ?? reg.uber ?? ch.uber ?? 0)} rappi={Number(daily.rappi ?? reg.rappi ?? ch.rappi ?? 0)}
                      propinas={Number(daily.propinas ?? reg.propinas ?? ch.propinas ?? 0)} totalBruto={totalBruto}
                      ventaBruta={Number(daily.venta_bruta ?? selectedRun.revision?.daily_financial_record?.venta_bruta ?? cortesDayVenta(selectedRun))}
                    />;
                  })()}
                </div>

                <CorteAiBox runId={selectedRun.id} />

                <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
                    <MessageSquareText className="h-4 w-4" />
                    Comentarios y correcciones
                  </div>
                  {(() => {
                    const hasReviews = selectedRun.reviews && selectedRun.reviews.length > 0;
                    const hasExceptions = selectedRun.exceptions && selectedRun.exceptions.length > 0;
                    if (!hasReviews && !hasExceptions) {
                      return <p className="text-sm" style={{ color: MUTED }}>Sin comentarios ni correcciones</p>;
                    }
                    return (
                      <div className="space-y-2">
                        {selectedRun.reviews?.map((r) => (
                          <div key={r.id} className="rounded border px-3 py-2 text-xs" style={{ borderColor: LINE }}>
                            <span className="font-medium" style={{ color: INK }}>{r.review_key}:</span>{" "}
                            <span style={{ color: MUTED }}>{r.review_notes || "Sin notas"} — {r.status}</span>
                          </div>
                        ))}
                        {selectedRun.exceptions?.map((e) => (
                          <div key={e.id} className="rounded border px-3 py-2 text-xs" style={{ borderColor: "#fde68a", background: "#fefce8" }}>
                            <span className="font-medium" style={{ color: "#92400e" }}>{e.exception_key}</span>
                            <span className="ml-2" style={{ color: MUTED }}>({e.exception_type}) — {e.status}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="flex items-center gap-2 font-semibold" style={{ color: INK }}>
                    Bancos
                  </div>
                  {(() => {
                    const bankDocs = selectedRun.documents.filter((doc) =>
                      ["amex_statement", "banorte_statement"].includes(doc.document_type)
                    );
                    if (bankDocs.length === 0) {
                      return (
                        <div className="mt-3 rounded-md border px-3 py-2 text-xs" style={{ borderColor: "#fde68a", background: "#fefce8", color: "#92400e" }}>
                          Pendiente — subir AMEX y Banorte desde{" "}
                          <a href="/conciliacion" className="underline font-medium">Conciliación</a>
                        </div>
                      );
                    }
                    return (
                      <div className="mt-2 space-y-1">
                        {bankDocs.map((doc) => (
                          <a key={doc.id} href={doc.source_uri ?? "#"} className="flex items-center justify-between rounded border px-3 py-1.5 text-xs" style={{ borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>
                            <span>{doc.document_type === "amex_statement" ? "AMEX" : "Banorte"} — {String(doc.metadata?.original_filename ?? doc.metadata?.name ?? "archivo")}</span>
                            <ChevronRight className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                  <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
                    <FolderOpen className="h-4 w-4" />
                    Archivos de este dia
                  </div>
                  {["Corte", "Bancos"].map((group) => {
                    const docs = group === "Corte"
                      ? selectedRun.documents.filter((doc) => ["corte_excel", "daily_sales_report", "revision_report"].includes(doc.document_type))
                      : group === "Bancos"
                        ? selectedRun.documents.filter((doc) => ["amex_statement", "banorte_statement"].includes(doc.document_type))
                        : [];
                    return (
                      <div key={group} className="mb-3">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{group}</div>
                        {docs.length === 0 ? (
                          <div className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: LINE, color: MUTED }}>Sin archivos registrados</div>
                        ) : docs.slice(0, 4).map((doc) => (
                          <a key={doc.id} href={doc.source_uri ?? "#"} className="mb-1 flex items-center justify-between rounded-md border px-3 py-2 text-xs" style={{ borderColor: LINE, color: INK, pointerEvents: doc.source_uri ? "auto" : "none" }}>
                            <span>{String(doc.metadata?.name ?? doc.metadata?.original_filename ?? doc.document_type)}</span>
                            <ChevronRight className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    );
                  })}
                </div>

                {selectedRun.exceptions.filter((item) => item.status !== "resolved").length > 0 && (
                  <div className="rounded-md border p-4" style={{ borderColor: "#e4c58f", background: "#fff8ec" }}>
                    <div className="font-semibold" style={{ color: INK }}>Pendientes por resolver</div>
                    <div className="mt-2 space-y-2">
                      {selectedRun.exceptions.filter((item) => item.status !== "resolved").slice(0, 4).map((item) => (
                        <div key={item.id} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#e4c58f", color: MUTED }}>
                          {item.exception_key}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(latestBalance.saldos).length > 0 && (
                  <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                    <div className="mb-3 font-semibold" style={{ color: INK }}>Saldos al cierre</div>
                    <div className="mb-3 text-xs" style={{ color: MUTED }}>Actualizados manualmente al {dateLabel(latestBalance.businessDate, "short")}</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }}>
                        <span className="shrink-0">Banorte</span>
                        <span className="min-w-0 truncate text-right font-semibold">{money(latestBalance.saldos.banorte)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }}>
                        <span className="shrink-0">AMEX</span>
                        <span className="min-w-0 truncate text-right font-semibold">{money(latestBalance.saldos.amex)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }}>
                        <span className="shrink-0">Efectivo</span>
                        <span className="min-w-0 truncate text-right font-semibold">{money(latestBalance.saldos.efectivo)}</span>
                      </div>
                      <div className="pt-2 mt-2 border-t" style={{ borderColor: LINE }}>
                        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }}>
                          <span className="shrink-0">Aguinaldos</span>
                          <span className="min-w-0 truncate text-right font-semibold">{money(latestBalance.saldos.aguinaldos)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK }}>
                          <span className="shrink-0">Utilidades</span>
                          <span className="min-w-0 truncate text-right font-semibold">{money(latestBalance.saldos.utilidades)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Link href={`/archivos?month=${selectedMonth}`} className="flex items-center justify-between rounded-md border px-4 py-3 text-sm font-semibold" style={{ borderColor: LINE, background: PANEL, color: INK }}>
                  Ver archivos del mes
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </aside>
            </section>
          ) : (
            <div className="rounded-md border p-8 text-center text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>Elegi un dia para ver el corte.</div>
          )}
        </section>
      </div>
    </main>
  );
}
