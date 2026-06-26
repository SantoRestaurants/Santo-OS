import {
  AlertTriangle,
  CalendarDays,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";

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
      </div>
    </main>
  );
}
