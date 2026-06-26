import {
  AlertTriangle,
  CalendarDays,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";

import { CorteAiBox } from "@/app/(dashboard)/cortes/CorteAiBox";

import { APPROVAL_REVIEW_KEY, getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailyForecastMeta, dailySales, dedupeRunsByDay, duplicateRunsByDay, hasForecastSourceForMonth, getMonthlyTotals } from "@/lib/corte-dashboard-utils";

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

function yearKey(date: string | null | undefined) {
  return date ? date.slice(0, 4) : "sin-ano";
}

function getUnit(run: ReconciliationRun) {
  return (run.revision?.unidad || run.revision?.restaurant_key || "SANTO").toUpperCase();
}

function runTotal(run: ReconciliationRun) { return dailySales(run); }

export default async function TestPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData();

  if (data.status === "auth_required") {
    return <main className="flex min-h-screen items-center justify-center" style={{ background: PAPER, color: INK }}><Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Iniciar sesion</Link></main>;
  }

  if (data.status === "unauthorized") {
    return <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: PAPER, color: INK }}><div className="text-xl font-bold">Acceso Denegado</div></main>;
  }

  const allRuns = data.runs.filter((run) => run.business_date);
  const runs = dedupeRunsByDay(allRuns);
  const duplicateDates = duplicateRunsByDay(allRuns);
  const units = Array.from(new Set(runs.map(getUnit))).sort();
  const selectedUnit = params.unit && units.includes(params.unit) ? params.unit : units[0] ?? "SANTO";
  const unitRuns = runs.filter((run) => getUnit(run) === selectedUnit);
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
  const forecastReady = hasForecastSourceForMonth(monthRuns, selectedMonth);
  const { monthTotal, monthMeta } = getMonthlyTotals(monthRuns, selectedMonth);
  const monthDiff = monthMeta == null ? null : monthTotal - monthMeta;

  // Step 2: JSX with UnitSelector, YearSelector, MonthSelector, and KPIs
  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pl-10 lg:pl-0">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Control</div>
            <h1 className="mt-1 text-3xl font-semibold">Cortes de Caja</h1>
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

        {/* Step 2a: UnitSelector */}
        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4" /> Unidad</div>
          <div className="flex flex-wrap gap-2">
            {units.map((unit) => (
              <Link
                key={unit}
                href={`/test-auth?unit=${unit}&year=${selectedYear}&month=${selectedMonth}&week=${selectedWeek}`}
                className="rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: unit === selectedUnit ? GOLD : LINE, background: unit === selectedUnit ? "#fdf2f2" : PANEL, color: unit === selectedUnit ? GOLD : INK }}
              >
                {unit}
              </Link>
            ))}
          </div>
        </section>

        {/* Step 2b: YearSelector */}
        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Año</div>
          <div className="flex gap-2">
            {years.map((year) => (
              <Link
                key={year}
                href={`/test-auth?unit=${selectedUnit}&year=${year}`}
                className="shrink-0 rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: year === selectedYear ? GOLD : LINE, background: year === selectedYear ? "#fdf2f2" : PANEL, color: year === selectedYear ? GOLD : INK }}
              >
                {year}
              </Link>
            ))}
          </div>
        </section>

        {/* Step 2c: MonthSelector */}
        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Mes</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {months.map((month) => (
              <Link
                key={month}
                href={`/test-auth?unit=${selectedUnit}&year=${selectedYear}&month=${month}`}
                className="shrink-0 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: month === selectedMonth ? GOLD : LINE, background: month === selectedMonth ? "#fdf2f2" : PANEL, color: month === selectedMonth ? GOLD : INK }}
              >
                {monthLabel(month)}
              </Link>
            ))}
          </div>
        </section>

        {/* Step 2d: KPI Cards */}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Venta mes</div>
            <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl" style={{ color: GOLD }}>{money(monthTotal)}</div>
          </div>
          <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Forecast mes</div>
            <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{money(monthMeta)}</div>
          </div>
          <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Diferencia mes</div>
            <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl" style={{ color: monthDiff == null || monthDiff >= 0 ? GREEN : RED }}>
              {monthDiff == null ? "-" : `${monthDiff >= 0 ? "+" : ""}${((monthDiff / monthMeta!) * 100).toFixed(1)}% / ${monthDiff >= 0 ? "+" : ""}${money(monthDiff)}`}
            </div>
          </div>
          <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Cortes del mes</div>
            <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{monthRuns.length}</div>
          </div>
        </div>

        {/* Debug */}
        <div className="text-xs" style={{ color: MUTED }}>
          Runs: {runs.length} | UnitRuns: {unitRuns.length} | MonthRuns: {monthRuns.length} | Weeks: {weeks.length}
        </div>

        {/* Step 3: WeekSelector */}
        <section>
          <div className="mb-3 font-semibold">Semanas</div>
          <div className="grid gap-2 md:grid-cols-4">
            {weeks.map((week, index) => (
              <Link
                key={week}
                href={`/test-auth?unit=${selectedUnit}&month=${selectedMonth}&week=${week}`}
                className="rounded-md border px-3 py-3 text-sm"
                style={{ borderColor: week === selectedWeek ? GOLD : LINE, background: week === selectedWeek ? "#fdf2f2" : PANEL, color: INK }}
              >
                <span className="block text-[11px] font-semibold uppercase" style={{ color: MUTED }}>Semana {index + 1}</span>
                <span className="mt-1 block font-semibold">{dateLabel(week, "short")}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Step 4: ForecastMissingPanel */}
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

        {/* Step 5: Duplicate warning */}
        {duplicateDates.length > 0 && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: AMBER }}>
            Hay cortes duplicados para {duplicateDates.map(([date]) => dateLabel(date, "short")).join(", ")}. Se muestra solo la versión más completa de cada día.
          </div>
        )}

        {/* Step 6: DayList + DetailPanel - minimal version */}
        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div>
            <div className="mb-3 font-semibold">Días</div>
            {weekRuns.length > 0 ? (
              <div className="rounded-md border" style={{ borderColor: LINE, background: PANEL }}>
                {weekRuns.map((run) => {
                  const selected = run.id === selectedRun?.id;
                  return (
                    <Link
                      key={run.id}
                      href={`/test-auth?unit=${selectedUnit}&month=${selectedMonth}&week=${selectedWeek}&day=${run.id}`}
                      className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
                      style={{ borderColor: LINE, background: selected ? "#fdf2f2" : PANEL, color: INK }}
                    >
                      <div>
                        <div className="font-semibold">{dateLabel(run.business_date, "short")}</div>
                        <div className="mt-1 text-xs" style={{ color: MUTED }}>{run.status}</div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="text-base font-bold tracking-tight">{money(runTotal(run))}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border p-5 text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>No hay cortes en esta semana.</div>
            )}
          </div>
          <div className="rounded-md border p-5 text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>
            Panel de detalle (simplificado)
          </div>
        </section>

        {/* Step 7: DetailPanel content if run selected */}
        {selectedRun && (
          <section className="grid gap-4 lg:grid-cols-[1fr_360px] overflow-hidden mt-4">
            <div className="space-y-4 min-w-0">
              <div className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>{getUnit(selectedRun)}</div>
                    <h2 className="mt-1 text-3xl font-bold tracking-tight" style={{ color: INK }}>{dateLabel(selectedRun.business_date)}</h2>
                    <div className="mt-2 text-sm" style={{ color: MUTED }}>Status: {selectedRun.status}</div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Venta real</div>
                    <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl" style={{ color: GOLD }}>{money(runTotal(selectedRun))}</div>
                  </div>
                  <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Meta forecast</div>
                    <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{money(dailyForecastMeta(selectedRun))}</div>
                  </div>
                  <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Total real</div>
                    <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{money(selectedRun.revision?.reconciliation_totals?.total_real)}</div>
                  </div>
                  <div className="rounded-md border px-4 py-3 min-w-0" style={{ background: PANEL, borderColor: LINE }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: MUTED }}>Total sistema</div>
                    <div className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">{money(selectedRun.revision?.reconciliation_totals?.total_sistema)}</div>
                  </div>
                </div>
              </div>
            </div>
            <aside className="space-y-4">
              <CorteAiBox runId={selectedRun.id} />
              <div className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
                <div className="font-semibold" style={{ color: INK }}>Archivos</div>
                <p className="mt-2 text-sm" style={{ color: MUTED }}>{selectedRun.documents.length} documentos</p>
              </div>
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}
