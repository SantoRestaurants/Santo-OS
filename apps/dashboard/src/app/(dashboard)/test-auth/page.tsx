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

type SearchParams = Promise<{ unit?: string; year?: string; month?: string; week?: string; day?: string; success?: string; error?: string }>;

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

function isBankValidated(run: ReconciliationRun) {
  return run.status === "completed" || run.status === "bank_validated" || run.documents.some((doc) => doc.document_type === "amex_statement" || doc.document_type === "banorte_statement");
}

function hasApproval(run: ReconciliationRun) {
  return run.reviews.some((review) => review.review_key === APPROVAL_REVIEW_KEY && review.status === "approved");
}

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

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6">
        <h1>Cortes de Caja</h1>
        <p>Unidad: {selectedUnit} | Año: {selectedYear} | Mes: {selectedMonth} | Semanas: {weeks.length} | Runs: {runs.length} | Total mes: {money(monthTotal)}</p>
        <p>Status: {data.status}</p>
      </div>
    </main>
  );
}
