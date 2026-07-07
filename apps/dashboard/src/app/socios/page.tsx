import { getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailyForecastMeta, dailySales, dedupeRunsByDay, getMonthlyTotals, getOutstandingThroughDate } from "@/lib/corte-dashboard-utils";
import Link from "next/link";
import Image from "next/image";
import { SociosChart } from "./SociosChart";
import { SociosAiBox } from "./SociosAiBox";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ unit?: string; month?: string; week?: string; day?: string; year?: string }>;

/* ── helpers ─────────────────────────────────────────────────────────── */

function money(v: number | undefined | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v);
}

function moneyFull(v: number | undefined | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(v);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
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
    weekday: mode === "long" ? "long" : "short",
    day: "2-digit",
    month: mode === "long" ? "long" : "short",
    year: mode === "long" ? "numeric" : undefined,
  }).format(parsed);
}

function isBankValidated(run: ReconciliationRun) {
  return run.status === "completed" || run.status === "bank_validated" || run.documents.some(d => d.document_type === "amex_statement" || d.document_type === "banorte_statement");
}

function statusLabel(run: ReconciliationRun) {
  if (isBankValidated(run)) return "Validado";
  if (run.status === "requires_review") return "Revisión";
  if (run.status === "waiting_for_input") return "Pendiente";
  if (run.status === "completed") return "Cargado";
  if (run.status === "pending_corte") return "En curso";
  return run.status;
}

function getUnit(run: ReconciliationRun) {
  return (run.revision?.unidad || run.revision?.restaurant_key || "SANTO").toUpperCase();
}

/* ── colors ──────────────────────────────────────────────────────────── */

const C = {
  bg: "#000000",
  surface: "#0a0a0a",
  surfaceHover: "#141414",
  border: "rgba(255,255,255,0.06)",
  borderActive: "rgba(232,70,59,0.5)",
  ink: "#ffffff",
  dim: "#a3a3a3",
  faint: "#525252",
  santo: "#e8463b",
  santoGlow: "rgba(232,70,59,0.15)",
  green: "#4ade80",
  greenDim: "rgba(74,222,128,0.12)",
  red: "#f87171",
  redDim: "rgba(248,113,113,0.12)",
  amber: "#fbbf24",
  amberDim: "rgba(251,191,36,0.12)",
};

/* ── page ────────────────────────────────────────────────────────────── */

export default async function SociosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData(["supervisor", "socio"]);

  if (data.status === "auth_required") {
    return <main style={{ background: C.bg, color: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><Link href="/auth/sign-in">Iniciar sesión</Link></main>;
  }
  if (data.status === "unauthorized") {
    return <main style={{ background: C.bg, color: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>No tenés acceso al panel de socios.</main>;
  }

  if (data.status === "requires_config") {
    return (
      <main style={{ background: C.bg, color: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-geist-mono), monospace" }}>
        <div style={{ textAlign: "center", opacity: 0.5 }}>Configuración pendiente</div>
      </main>
    );
  }

  const allRuns = data.runs.filter(r => r.business_date);
  const runs = dedupeRunsByDay(allRuns);
  const units = Array.from(new Set(runs.map(getUnit))).sort();

  /* navigation state */
  const todayMonth = new Date().toISOString().slice(0, 7);
  const selectedUnit = params.unit && units.includes(params.unit) ? params.unit : units[0] ?? "SANTO";
  const unitAllRuns = allRuns.filter(r => getUnit(r) === selectedUnit);
  const unitRuns = runs.filter(r => getUnit(r) === selectedUnit);
  const todayMexico = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const unitReceivables = data.receivables.filter((r) => {
    const rs = (r as any).restaurants;
    const key = Array.isArray(rs) ? rs[0]?.restaurant_key : rs?.restaurant_key;
    return key === selectedUnit;
  });
  const outstanding = getOutstandingThroughDate(unitAllRuns, unitReceivables, todayMexico);

  const allMonths = Array.from(new Set(unitRuns.map(r => monthKey(r.business_date)))).sort().reverse();

  // Also include months from forecast documents (even without workflow runs)
  const forecastMonths = data.forecastDocuments
    .map(doc => (doc.metadata as Record<string, unknown>).month as string | undefined)
    .filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m));
  for (const fm of forecastMonths) {
    if (!allMonths.includes(fm)) allMonths.push(fm);
  }
  allMonths.sort().reverse();

  if (!allMonths.includes(todayMonth)) allMonths.unshift(todayMonth);

  // Year-first navigation
  const yearsArr = Array.from(new Set(allMonths.map(m => m.slice(0, 4)))).sort().reverse();
  const selectedYear = params.year && yearsArr.includes(params.year) ? params.year : yearsArr[0];
  const monthsForYear = allMonths.filter(m => m.startsWith(selectedYear));

  const selectedMonth = params.month && monthsForYear.includes(params.month) ? params.month : monthsForYear[0];
  const monthRuns = unitRuns.filter(r => monthKey(r.business_date) === selectedMonth);

  /* Forecast extraction */
  const runForecasts = monthRuns
    .map((run) => run.revision?.vta_por_dia ?? [])
    .filter((rows) => rows.some((row) => row.fecha?.startsWith(`${selectedMonth}-`)));
  let forecastArray: Array<{ fecha?: string | null; meta_vta?: number | null; venta_real?: number | null }> = runForecasts
    .sort((a, b) => {
      const total = (rows: typeof a) => rows
        .filter((row) => row.fecha?.startsWith(`${selectedMonth}-`))
        .reduce((sum, row) => sum + (typeof row.meta_vta === "number" ? row.meta_vta : 0), 0);
      return total(b) - total(a);
    })[0] ?? [];

  // If no run carries forecast rows for this month, fall back to the registered
  // forecast document. When both exist, keep the run forecast so the chart and
  // KPI cards use the same target basis.
  if (selectedMonth && forecastArray.length === 0) {
    const forecastDoc = data.forecastDocuments.find(doc => {
      const meta = doc.metadata as Record<string, unknown>;
      return meta.month === selectedMonth;
    });
    if (forecastDoc) {
      const docVta = (forecastDoc.metadata as Record<string, unknown>).vta_por_dia;
      if (Array.isArray(docVta) && docVta.length > 0) {
        // Merge: use doc's meta_vta and venta_real (doc is source of truth from Excel)
        forecastArray = docVta.map((docItem: Record<string, unknown>) => {
          const fecha = docItem.fecha as string | undefined;
          return {
            fecha: fecha ?? null,
            meta_vta: (typeof docItem.meta_vta === "number" ? docItem.meta_vta : null) as number | null,
            venta_real: (typeof docItem.venta_real === "number" ? docItem.venta_real : null) as number | null,
          };
        }) as typeof forecastArray;
      }
    }
  }

  function dayVenta(run: ReconciliationRun) {
    return dailySales(run);
  }

  let { monthTotal, monthMeta, monthMetaToDate } = getMonthlyTotals(monthRuns, selectedMonth || "", data.forecastDocuments);

  // Recalculate monthTotal from actual Corte runs
  monthTotal = monthRuns.reduce((sum, run) => sum + dailySales(run), 0);

  // If no forecast from runs, compute meta from forecast documents
  if (monthMeta == null && forecastArray.length > 0) {
    const latestDate = monthRuns.length > 0
      ? monthRuns.reduce((latest, r) => (r.business_date && (!latest || r.business_date > latest) ? r.business_date : latest), null as string | null)
      : null;

    monthMeta = forecastArray
      .reduce((sum, item) => sum + (typeof item.meta_vta === "number" ? item.meta_vta : 0), 0);

    monthMetaToDate = forecastArray
      .filter(item => !latestDate || !item.fecha || item.fecha <= latestDate)
      .reduce((sum, item) => sum + (typeof item.meta_vta === "number" ? item.meta_vta : 0), 0);
  } else if (monthMetaToDate == null) {
    monthMetaToDate = monthMeta;
  }

  const monthDiff = monthMetaToDate != null ? monthTotal - monthMetaToDate : monthMeta != null ? monthTotal - monthMeta : null;
  const monthProgress = monthMeta ? Math.min((monthTotal / monthMeta) * 100, 100) : 0;

  const weeks = Array.from(new Set(monthRuns.map(r => weekKey(r.business_date)))).sort();
  const selectedWeek = params.week && weeks.includes(params.week) ? params.week : weeks[weeks.length - 1] ?? "sin-semana";
  const weekRuns = monthRuns.filter(r => weekKey(r.business_date) === selectedWeek).sort((a, b) => String(a.business_date).localeCompare(String(b.business_date)));

  const selectedRun = weekRuns.find(r => r.id === params.day) ?? weekRuns[weekRuns.length - 1] ?? null;

  const getMetaForDay = (date: string | null) => {
    if (!date) return 0;
    const item = forecastArray.find(f => f.fecha === date);
    return typeof item?.meta_vta === "number" ? item.meta_vta : 0;
  };

  /* Chart data generation */
  const weekChartData = weekRuns.map(r => {
    const vta = dayVenta(r);
    const meta = dailyForecastMeta(r) ?? getMetaForDay(r.business_date);
    const dateStr = r.business_date ? r.business_date.slice(8) : "";
    return {
      fecha: r.business_date || "",
      label: dateStr,
      venta: vta,
      meta: meta,
      hasVenta: vta > 0 || r.status === "completed" || r.status === "bank_validated",
    };
  });

  const monthChartData = forecastArray.map(f => {
    const date = f.fecha;
    if (!date) return null;
    const run = monthRuns.find(r => r.business_date === date);
    // Forecast workbooks provide targets only. Actual sales must come from a
    // real Corte/canonical daily record, never from a rebased prior month.
    const vta = run ? dayVenta(run) : 0;
    const meta = typeof f.meta_vta === "number" ? f.meta_vta : 0;
    return {
      fecha: date,
      label: date.slice(8),
      venta: vta,
      meta: meta,
      hasVenta: vta > 0 || (run && (run.status === "completed" || run.status === "bank_validated"))
    };
  }).filter(Boolean) as { fecha: string; label: string; venta: number; meta: number; hasVenta: boolean }[];

  if (monthChartData.length === 0) {
    monthRuns.forEach(r => {
      const vta = dayVenta(r);
      const meta = dailyForecastMeta(r) ?? getMetaForDay(r.business_date);
      if (r.business_date) {
        monthChartData.push({
          fecha: r.business_date,
          label: r.business_date.slice(8),
          venta: vta,
          meta: meta,
          hasVenta: vta > 0 || r.status === "completed" || r.status === "bank_validated"
        });
      }
    });
    monthChartData.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  /* Saldos from any run that has data */
  const runWithSaldos = data.runs.find((run) => {
    const s = (run.output_payload?.saldos as Record<string, number> | undefined);
    return s && Object.values(s).some((v) => Number(v) > 0);
  });
  const saldos: Record<string, number> = (runWithSaldos?.output_payload?.saldos as Record<string, number> | undefined) ?? {};

  /* Week and month context for AI */
  const weekContext = {
    totalVendido: weekRuns.reduce((sum, r) => sum + dayVenta(r), 0),
    totalMeta: weekRuns.reduce((sum, r) => sum + (dailyForecastMeta(r) ?? getMetaForDay(r.business_date) ?? 0), 0),
    diasConCorte: weekRuns.filter(r => r.status !== "pending_corte").length,
    cortes: weekRuns.map(r => ({
      fecha: r.business_date || "",
      venta: dayVenta(r),
      meta: dailyForecastMeta(r) ?? getMetaForDay(r.business_date),
      status: r.status,
    })),
  };
  const monthContext = {
    totalVendido: monthTotal,
    totalMeta: monthMeta ?? 0,
    progressPct: monthProgress,
  };

  const hp = (p: Record<string, string>) => {
    const u = new URLSearchParams({ unit: selectedUnit, ...p });
    return `/socios?${u.toString()}`;
  };

  const hpYear = (year: string) => hp({ year });
  const hpMonth = (month: string) => hp({ year: selectedYear, month });
  const hpUnit = (unit: string) => hp({ unit, year: selectedYear, month: selectedMonth || "" });

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700;800&display=swap');
        
        body { background: ${C.bg} !important; color: ${C.ink} !important; margin: 0; }
        .socios-root { font-family: var(--font-geist-sans), -apple-system, sans-serif; min-height: 100vh; }
        .socios-root * { box-sizing: border-box; }
        a { text-decoration: none; color: inherit; }

        .display-font { font-family: 'Big Shoulders Display', var(--font-geist-sans), sans-serif; }

        .grain { position: fixed; inset: 0; pointer-events: none; opacity: 0.04; z-index: 100; mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .month-pill { display: inline-block; padding: 6px 14px; font-size: 13px; font-weight: 600;
          border: 1px solid ${C.border}; background: ${C.surface}; color: ${C.dim};
          transition: all 0.15s ease; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; }
        .month-pill:hover { background: ${C.surfaceHover}; color: ${C.ink}; }
        .month-pill.active { background: ${C.santoGlow}; border-color: ${C.borderActive}; color: ${C.santo}; }

        .year-pill, .unit-pill { display: inline-block; padding: 6px 14px; font-size: 13px; font-weight: 600;
          border: 1px solid ${C.border}; background: ${C.surface}; color: ${C.dim};
          transition: all 0.15s ease; cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em; }
        .year-pill:hover, .unit-pill:hover { background: ${C.surfaceHover}; color: ${C.ink}; }
        .year-pill.active, .unit-pill.active { background: ${C.santoGlow}; border-color: ${C.borderActive}; color: ${C.santo}; }

        .selector-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px;
          padding: 12px 16px; background: ${C.surface}; border: 1px solid ${C.border}; }
        .selector-label { font-size: 9px; font-weight: 600; color: ${C.faint}; text-transform: uppercase;
          letter-spacing: 0.1em; margin-right: 8px; white-space: nowrap; }

        .week-card { padding: 12px 16px; border: 1px solid ${C.border}; background: ${C.surface};
          transition: all 0.15s ease; cursor: pointer; }
        .week-card:hover { background: ${C.surfaceHover}; border-color: rgba(255,255,255,0.12); }
        .week-card.active { border-color: ${C.borderActive}; background: ${C.santoGlow}; }

        .day-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
          border-bottom: 1px solid ${C.border}; transition: all 0.12s ease; cursor: pointer; }
        .day-row:last-child { border-bottom: none; }
        .day-row:hover { background: ${C.surfaceHover}; }
        .day-row.active { background: ${C.surfaceHover}; border-left: 2px solid ${C.santo}; }

        .kpi-card { padding: 20px; background: ${C.surface}; border: 1px solid ${C.border}; }
        .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${C.dim}; margin-bottom: 6px; }
        .kpi-value { font-size: 32px; font-weight: 700; letter-spacing: -0.01em; color: ${C.ink}; font-variant-numeric: tabular-nums; }
        .kpi-value.santo { color: ${C.santo}; }

        .data-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0;
          border-bottom: 1px solid ${C.border}; font-size: 13px; }
        .data-row:last-child { border-bottom: none; }
        .data-row-label { color: ${C.dim}; }
        .data-row-value { font-weight: 600; color: ${C.ink}; font-variant-numeric: tabular-nums; }

        .status-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
          font-weight: 600; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

        .progress-track { height: 2px; background: ${C.faint}; position: relative; overflow: hidden; }
        .progress-fill { position: absolute; left: 0; top: 0; bottom: 0; background: ${C.santo};
          transition: width 0.6s ease; box-shadow: 0 0 10px ${C.santo}; }

        @media (max-width: 768px) {
          .socios-grid { grid-template-columns: 1fr !important; }
          .detail-grid { grid-template-columns: 1fr !important; }
          .kpi-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}} />

      <div className="grain" />

      <div className="socios-root relative z-10">
        {/* ── HEADER ─────────────────────────────────────── */}
        <header style={{ padding: "20px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Image src="/logo.png" alt="Santo" width={32} height={32} />
            <div>
              <div className="display-font" style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "0.1em", lineHeight: 1, textTransform: "uppercase" }}>Santo</div>
              <div style={{ fontSize: "9px", color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: "2px" }}>Panel de Socios</div>
            </div>
          </div>
          <div style={{ fontSize: "11px", color: C.faint, fontVariantNumeric: "tabular-nums", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
        </header>

        <div style={{ maxWidth: "1600px", margin: "0 auto", padding: "32px" }}>

          {/* ── UNIT SELECTOR ──────────────────────────── */}
          <div className="selector-bar">
            <span className="selector-label">Restaurante</span>
            {units.map(u => (
              <Link key={u} href={hpUnit(u)} className={`unit-pill ${u === selectedUnit ? "active" : ""}`}>
                {u}
              </Link>
            ))}
          </div>

          {/* ── YEAR SELECTOR ────────────────────────────── */}
          <div className="selector-bar">
            <span className="selector-label">Año</span>
            {yearsArr.map(y => (
              <Link key={y} href={hpYear(y)} className={`year-pill ${y === selectedYear ? "active" : ""}`}>
                {y}
              </Link>
            ))}
          </div>

          {/* ── MONTH SELECTOR ───────────────────────────── */}
          <div className="selector-bar" style={{ flexWrap: "wrap" }}>
            <span className="selector-label">Mes</span>
            {monthsForYear.map(m => {
              const d = parseDate(`${m}-01`);
              const label = d ? new Intl.DateTimeFormat("es-MX", { month: "long" }).format(d) : m;
              return (
                <Link key={m} href={hpMonth(m)} className={`month-pill ${m === selectedMonth ? "active" : ""}`}>
                  {label}
                </Link>
              );
            })}
          </div>

          {/* ── MONTH KPIs ───────────────────────────────── */}
          <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1px", background: C.border, border: `1px solid ${C.border}`, marginBottom: "20px" }}>
            <div className="kpi-card" style={{ border: "none" }}>
              <div className="kpi-label">Meta / Forecast</div>
              <div className="kpi-value display-font">{money(monthMeta)}</div>
            </div>
            <div className="kpi-card" style={{ border: "none" }}>
              <div className="kpi-label">Venta Real</div>
              <div className="kpi-value display-font santo">{money(monthTotal)}</div>
            </div>
            <div className="kpi-card" style={{ border: "none" }}>
              <div className="kpi-label">Diferencia</div>
              <div className="kpi-value display-font" style={{ color: monthDiff == null ? C.dim : monthDiff >= 0 ? C.green : C.red }}>
                {monthDiff == null ? "—" : `${monthDiff >= 0 ? "+" : ""}${moneyFull(monthDiff)}`}
              </div>
            </div>
            <div className="kpi-card" style={{ border: "none" }}>
              <div className="kpi-label">% Diferencia</div>
              <div className="kpi-value display-font" style={{ color: monthDiff == null || !monthMeta ? C.dim : monthDiff >= 0 ? C.green : C.red }}>
                {monthDiff == null || !monthMeta ? "—" : `${monthDiff >= 0 ? "+" : ""}${((monthDiff / monthMeta) * 100).toFixed(1)}%`}
              </div>
            </div>
          </div>

          {/* ── progress bar ─ */}
          <div style={{ marginBottom: "32px", padding: "0" }}>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${monthProgress}%` }} />
            </div>
          </div>

          {/* ── WEEK SELECTOR ────────────────────────────── */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: C.dim, marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Desglose Semanal</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length || 1}, 1fr)`, gap: "1px", background: C.border, border: `1px solid ${C.border}` }}>
              {weeks.length === 0 ? (
                <div className="week-card" style={{ color: C.faint, border: "none" }}>Sin semanas</div>
              ) : weeks.map((w, i) => {
                const wRuns = monthRuns.filter(r => weekKey(r.business_date) === w);
                const wTotal = wRuns.reduce((sum, r) => sum + dayVenta(r), 0);
                return (
                  <Link key={w} href={hp({ year: selectedYear, month: selectedMonth || "", week: w })} className={`week-card ${w === selectedWeek ? "active" : ""}`} style={{ border: "none" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>Semana {i + 1}</div>
                    <div className="display-font" style={{ fontSize: "24px", fontWeight: 700, marginTop: "6px" }}>{money(wTotal)}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── DAY LIST + DETAIL + CHART ────────────────── */}
          <div className="socios-grid" style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "24px" }}>

            {/* day list */}
            <div style={{ border: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ padding: "16px", borderBottom: `1px solid ${C.border}`, fontSize: "11px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Días de la semana
              </div>
              {weekRuns.length === 0 ? (
                <div style={{ padding: "24px 16px", fontSize: "13px", color: C.faint, textAlign: "center" }}>Sin cortes esta semana</div>
              ) : weekRuns.map(run => {
                const dMeta = dailyForecastMeta(run) ?? getMetaForDay(run.business_date);
                const dTotal = dayVenta(run);
                const diff = dMeta > 0 ? dTotal - dMeta : null;
                const active = selectedRun?.id === run.id;
                const validated = isBankValidated(run);
                return (
                  <Link key={run.id} href={hp({ year: selectedYear, month: selectedMonth || "", week: selectedWeek, day: run.id })} className={`day-row ${active ? "active" : ""}`}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>{dateLabel(run.business_date, "short")}</div>
                      <div style={{ marginTop: "6px" }}>
                        <span className="status-badge" style={{
                          background: validated ? C.greenDim : C.surfaceHover,
                          color: validated ? C.green : C.dim,
                        }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }} />
                          {statusLabel(run)}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(dTotal)}</div>
                      {diff != null && dTotal > 0 && (
                        <div style={{ fontSize: "11px", fontWeight: 600, color: diff >= 0 ? C.green : C.red, marginTop: "4px" }}>
                          {diff >= 0 ? "+" : ""}{((diff / dMeta) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* main content (detail + chart) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

              {/* Chart */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px" }}>
                <SociosChart monthData={monthChartData} weekData={weekChartData} />
              </div>

              {/* detail panel */}
              {selectedRun && (() => {
                const srMeta = dailyForecastMeta(selectedRun) ?? getMetaForDay(selectedRun.business_date);
                const srTotal = dayVenta(selectedRun);
                const srDiff = srMeta > 0 ? srTotal - srMeta : null;

                return (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>

                    {/* venta bruta y KPIs del dia */}
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: C.santo, textTransform: "uppercase", letterSpacing: "0.1em" }}>Venta del Día</div>
                          <div className="display-font" style={{ fontSize: "32px", fontWeight: 700, marginTop: "4px", color: C.ink }}>{dateLabel(selectedRun.business_date)}</div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                        <div>
                          <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Total Real</div>
                          <div className="display-font" style={{ fontSize: "28px", color: C.santo }}>{moneyFull(srTotal)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Meta Forecast</div>
                          <div className="display-font" style={{ fontSize: "28px", color: C.ink }}>{moneyFull(srMeta)}</div>
                        </div>
                        {srDiff != null && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Diferencia</div>
                            <div className="display-font" style={{ fontSize: "24px", color: srDiff >= 0 ? C.green : C.red }}>
                              {srDiff >= 0 ? "+" : ""}{((srDiff / srMeta) * 100).toFixed(1)}% ({srDiff >= 0 ? "+" : ""}{moneyFull(srDiff)})
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: "11px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "12px", paddingTop: "16px", borderTop: `1px solid ${C.border}` }}>Desglose por canal</div>
                      {(() => {
                        const reg = (selectedRun.output_payload?.income_register ?? {}) as Record<string, number>;
                        const ch = (selectedRun.output_payload?.income_channels ?? {}) as Record<string, number>;
                        const channels = [
                          { key: "amex", label: "AMEX" },
                          { key: "debito", label: "Débito" },
                          { key: "credito", label: "Crédito" },
                          { key: "efectivo", label: "Efectivo" },
                          { key: "paypal", label: "PayPal" },
                          { key: "uber", label: "Uber Eats" },
                          { key: "rappi", label: "Rappi" },
                          { key: "propinas", label: "Propinas" },
                        ];
                        let hasData = false;
                        return (
                          <div>
                            {channels.map(c => {
                              const val = reg[c.key] ?? ch[c.key] ?? 0;
                              if (val === 0) return null;
                              hasData = true;
                              return (
                                <div key={c.key} className="data-row" style={{ padding: "8px 0" }}>
                                  <span className="data-row-label">{c.label}</span>
                                  <span className="data-row-value">{moneyFull(val)}</span>
                                </div>
                              );
                            })}
                            {!hasData && (
                              <div style={{ fontSize: "12px", color: C.faint, padding: "12px 0" }}>Aún no hay desglose cargado.</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* falta por entrar */}
                    {outstanding && (() => {
                      return (
                        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px", display: "flex", flexDirection: "column" }}>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: C.santo, textTransform: "uppercase", letterSpacing: "0.1em" }}>Falta por entrar hasta hoy</div>
                          <div style={{ color: C.faint, fontSize: "11px", marginTop: "4px", marginBottom: "16px" }}>Conciliado hasta {dateLabel(outstanding.asOfDate, "short")}</div>
                          <div className="display-font" style={{ color: C.red, fontSize: "30px", fontWeight: 700, marginBottom: "12px" }}>{moneyFull(outstanding.total)}</div>
                          {outstanding.entries.map(({ channel, amount }) => (
                            <div key={channel} className="flex justify-between" style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                              <span style={{ color: C.dim, fontSize: "13px" }}>{channel}</span>
                              <span style={{ color: C.red, fontWeight: 600, fontSize: "14px" }}>{moneyFull(amount)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* saldos */}
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px", display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "20px" }}>Posición de Efectivo y Saldos</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ marginBottom: "24px" }}>
                          <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Fondo Fijo Banorte</div>
                          <div className="display-font" style={{ fontSize: "32px", color: C.ink }}>{money(saldos.banorte)}</div>
                        </div>
                        <div style={{ marginBottom: "24px" }}>
                          <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Posición AMEX</div>
                          <div className="display-font" style={{ fontSize: "28px", color: C.ink }}>{money(saldos.amex)}</div>
                        </div>
                        <div style={{ marginBottom: "24px" }}>
                          <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Efectivo Disponible</div>
                          <div className="display-font" style={{ fontSize: "28px", color: C.ink }}>{money(saldos.efectivo)}</div>
                        </div>
                      </div>

                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "20px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 600, color: C.santo, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px" }}>Reservas Acumuladas</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                          <div>
                            <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Utilidades</div>
                            <div className="display-font" style={{ fontSize: "24px", color: C.ink }}>{money(saldos.utilidades)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: "10px", color: C.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Aguinaldos</div>
                            <div className="display-font" style={{ fontSize: "24px", color: C.ink }}>{money(saldos.aguinaldos)}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* AI Box */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <SociosAiBox runId={selectedRun.id} unit={selectedUnit} weekContext={weekContext} monthContext={monthContext} selectedMonth={selectedMonth} businessDate={selectedRun.business_date ?? undefined} />
                    </div>

                  </div>
                );
              })()}
            </div>
          </div>

          {/* footer */}
          <div style={{ marginTop: "40px", paddingTop: "20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <span>Santo OS · Módulo Analítico</span>
            <span>Acceso Seguro de Solo Lectura</span>
          </div>
        </div>
      </div>
    </>
  );
}
